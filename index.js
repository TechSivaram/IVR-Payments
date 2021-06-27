const { exception, Console } = require('console');
const AWS = require('aws-sdk');

const VoiceResponse = require('twilio').twiml.VoiceResponse;
const accountSid = process.env.AccountSid;
const authToken = process.env.AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const stripe = require('stripe')(process.env.StripeKey);
const getResponse = myxml => ({
    statusCode: 200,
    headers: {
        'Content-Type': 'text/xml',
    },
    body: myxml,
});

// when some one calls the IVR payments number twillio will invoke this api
exports.handler = async (event, context, callback) => {

    const response = new VoiceResponse();

    response.say('Due to very high volumes, we require you to please leave a message at the beep with your '
        + 'first name, last name, date of birth, testing date and testing site information. Someone will call you back.\n '
        + 'Please press the star key when finished.');

    //Directing the call to (IVR) api (exports.collectPaymentDetails), this lambda is exposed via api gateway 
    response.record({
        action: process.env.RecordingAPI,
        method: 'GET',
        finishOnKey: '*',
        transcribe: false
    });

    response.say('I did not receive a recording');

    callback(null, getResponse(response.toString()));
};

//Whenever twilio recording is done it will call this lambda to send an email, this is for voice mail recording for payment related issues
exports.recordingHandler = async (event, context, callback) => {

    var qryString = event.querystring.replace('{', '').replace('}', '').replace(/, /g, '&');
    var params = new URLSearchParams(qryString);

    if (!params.has('AccountSid')) {
        throw new Error("Not a valid request");
    }

    if (process.env.AccountSid != params.get('AccountSid')) {
        throw new Error("Not a valid request");
    }

    var from = params.get('From');
    var caller = from.slice(from.length - 10);
    var recordingUrl = process.env.PlayUrl + '?p=' + params.get('RecordingSid') + '&ph=' + caller;

    var emailParams = {
        Destination: {
            ToAddresses: process.env.VoicemailRecipients.split(',')
        },
        Message: {
            Body: {
                Text: {
                    Charset: "UTF-8",
                    Data: recordingUrl
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'Voicemail from :' + caller
            }
        },
        Source: 'admin@techsivaram.com',
    };

    //Please make sure we set lambda environment variables to invoke these aws.ses calls
    var sendPromise = new AWS.SES({ apiVersion: '2010-12-01' }).sendEmail(emailParams).promise();

    sendPromise.then(
        function (data) {
            console.log(data.MessageId);
        }).catch(
            function (err) {
                console.error(err, err.stack);
            });

    const response = new VoiceResponse();

    response.say('Thank you');

    callback(null, getResponse(response.toString()));
};

//this lambda is exposed as api via gateway, this is recurring IVR call, untill hangup twilio will redirect the user to same api again and again
exports.collectPaymentDetails = async (event, context, callback) => {
    if (process.env.AccountSid != event.AccountSid) {
        throw new Error("Not a valid request");
    }

    console.log(event.CallSid);

    const response = new VoiceResponse();
    const gather = response.gather({
        method: 'POST',
        timeout: '10'
    });

    var dbObj = await getDBItem(event);

    if (typeof dbObj === "undefined") {
        await createDBItem({
            "ID": event.CallSid,
            "Phone": unescape(event.Caller)
        });

        dbObj = {
            "Item": {
                "ID": event.CallSid
            }
        }
    }

    if (dbObj.hasOwnProperty('TransactionID')) {
        if (event.hasOwnProperty('Digits')) {
            if (event.Digits == '1') {
                var TID = dbObj.TransactionID.S;
                const sliceId = TID.slice(TID.length - 11).replace('-', '');
                console.log(sliceId);
                const say = response.say('Your confirmation number is ');
                say.sayAs({ 'interpret-as': 'telephone' }, sliceId.substring(0, 4));
                say.break_({ 'time': '2s' });
                say.sayAs({ 'interpret-as': 'telephone' }, sliceId.substring(4, 8));
                say.break_({ 'time': '2s' });
                say.sayAs({ 'interpret-as': 'telephone' }, sliceId.substring(8));
                say.break_({ 'time': '2s' });
                say.addText('Thank you and good bye')
                response.hangup();
            }
            if (event.Digits == '2') {
                response.say('Good bye');
                response.hangup();
            }
        }
    }
    else if (!dbObj.hasOwnProperty('AccountNumber')) {
        if (event.hasOwnProperty('Digits')) {
            await updateAccountNumber(event);
            gather.say('Please enter the Account holder date birth, 2 digits for month, 2 digits for day and 4 digits for year,\n followed by the pound sign');
        } else {
            gather.say('Please enter the Account number as Displayed on Your statement,\n followed by the pound sign');
        }
    }
    else if (!dbObj.hasOwnProperty('DOB')) {
        if (event.hasOwnProperty('Digits')) {
            await updateDOB(event);
            gather.say('Please enter the Amount in dollars and cents,\n followed by the pound sign');
        }
    }
    else if (!dbObj.hasOwnProperty('Amount')) {
        if (event.hasOwnProperty('Digits')) {
            await updateAmount(event);
            gather.say('You entered ' + Math.trunc(event.Digits / 100) + ' Dollars ' + event.Digits % 100 + ' cents. Press 1 to confirm, press 2 to re enter');
        }
    }
    else if (dbObj.hasOwnProperty('Amount') && !dbObj.hasOwnProperty('Card')) {
        if (event.hasOwnProperty('Digits')) {
            if (event.Digits == '1') {
                gather.say('Please enter your card number,\n followed by the pound sign');
            }
            else if (event.Digits == '2') {
                await deleteAmount(event);
                gather.say('Please enter the Amount in dollars and cents,\n followed by the pound sign');
            }
            else {
                await updateCard(event);
                var say = gather.say('you have entered ');
                say.sayAs({ 'interpret-as': 'telephone' }, event.Digits.substring(0, 4));
                say.break_({ 'time': '2s' });
                say.sayAs({ 'interpret-as': 'telephone' }, event.Digits.substring(4, 8));
                say.break_({ 'time': '2s' });
                say.sayAs({ 'interpret-as': 'telephone' }, event.Digits.substring(8, 12));
                say.break_({ 'time': '2s' });
                say.sayAs({ 'interpret-as': 'telephone' }, event.Digits.substring(12));
                say.break_({ 'time': '2s' });
                say.addText('as card number. Press 1 to confirm or Press 2 to re enter');
            }
        }
    }
    else if (dbObj.hasOwnProperty('Amount') && dbObj.hasOwnProperty('Card')) {
        if (event.hasOwnProperty('Digits')) {
            if (event.Digits == '1') {
                gather.say('Please enter your card expiry date 2 digits for month and 2 digits for year,\n followed by the pound sign');
            }
            else if (event.Digits == '2') {
                await removeCard(event);
                gather.say('Please enter your card number,\n followed by the pound sign');
            }
            else if (!dbObj.hasOwnProperty('CardExpiry')) {
                await updateCardExpiry(event);
                gather.say('Please enter your card security code followed by the pound sign. Card security code is a 3 digit number on the back side of your card');
            }
            else if (!dbObj.hasOwnProperty('CVC')) {
                try {
                    await processPayment(event, context, callback, dbObj, event.Digits, gather);
                    gather.say('Press 1 to hear your confirmation number again or press 2 to hangup');
                }
                catch (e) {
                    console.log(e);
                    await deleteAmount(event);
                    await removeCard(event);
                    await removeCardExpiry(event);
                    gather.say('Your payment has been failed, Please enter the Amount in dollars and cents,\n followed by the pound sign');
                }
            }
        }
    }

    response.say('We didn\'t receive any input. Goodbye!');
    callback(null, getResponse(response.toString()));
}

const removeCard = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "REMOVE #Card",
            ExpressionAttributeNames: {
                "#Card": "Card"
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const removeCardExpiry = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "REMOVE #CardExpiry",
            ExpressionAttributeNames: {
                "#CardExpiry": "CardExpiry"
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updateCardExpiry = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #CardExpiry = :CardExpiry",
            ExpressionAttributeValues: {
                ":CardExpiry": {
                    S: event.Digits
                }
            },
            ExpressionAttributeNames: {
                "#CardExpiry": "CardExpiry"
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updateCard = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #Card = :Card",
            ExpressionAttributeValues: {
                ":Card": {
                    S: event.Digits
                }
            },
            ExpressionAttributeNames: {
                "#Card": "Card"
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const processPayment = async (event, context, callback, dbObj, CVC, gather) => {
    if (process.env.AccountSid != event.AccountSid) {
        throw new Error("Not a valid request");
    }

    var amount = dbObj.Amount.S.substring(1);

    const token = await stripe.tokens.create({
        card: {
            number: dbObj.Card.S,
            exp_month: dbObj.CardExpiry.S.substring(0, 2),
            exp_year: dbObj.CardExpiry.S.substring(2),
            cvc: CVC,
        },
    });

    var charge = {};

    try {
        charge = await stripe.charges.create({
            amount: parseFloat(amount) * 100,
            currency: 'usd',
            source: token.id,
        });
    } catch (e) {
        throw e;
    }

    await removeCard(event);
    await removeCardExpiry(event);

    const TID = getUniqueID();
    const sliceId = TID.slice(TID.length - 11).replace('-', '');

    await updateStripePaymentDetails(event, charge, TID);

    await SendSMSWithTransactionIdAndRecipt(event, charge, TID);

    const say = gather.say('Thank you for the payment. We have successfully processed the payment and your confirmation number is ');
    say.sayAs({ 'interpret-as': 'telephone' }, sliceId);
}

const SendSMSWithTransactionIdAndRecipt = async (event, charge, TID) => {
    return new Promise((resolve, reject) => {
        client.messages.create({
            body: 'Your payment for the amount ' + parseFloat(charge.amount_captured) / 100 + ' is successful and transaction Id is : ' + TID.slice(TID.length - 11) + '. Please find the receipt at ' + charge.receipt_url,
            from: unescape(event.To),
            to: unescape(event.Caller)
        }).then(message => {
            console.log(message.sid);
            resolve(message.sid)
        }).catch(err => {
            console.log(err);
            reject(err);
        });
    });
}

//pls ignore this
exports.twilioPaymentHandler = async (event, context, callback) => {

    if (process.env.AccountSid != event.AccountSid) {
        throw new Error("Not a valid request");
    }

    await updatePaymentDetails(event);

    var dbObj = await getDBItem(event);

    await SendSMSWithTransactionId(event, dbObj);

    const response = new VoiceResponse();
    response.say('Thank you');
    callback(null, getResponse(response.toString()));
}

const getUniqueID = () => {

    // create Date object from valid string inputs
    var datetime = new Date();

    // format the output
    var month = datetime.getMonth() + 1;
    var day = datetime.getDate();
    if (day < 10)
        day = "0" + day;
    var year = datetime.getFullYear();

    var hour = datetime.getHours();
    if (hour < 10)
        hour = "0" + hour;

    var min = datetime.getMinutes();
    if (min < 10)
        min = "0" + min;

    var sec = datetime.getSeconds();
    if (sec < 10)
        sec = "0" + sec;
    var mSec = datetime.getMilliseconds();
    if (mSec < 10)
        mSec = "00" + mSec;
    if (mSec >= 10 && mSec < 100)
        mSec = "0" + mSec;


    // put it all togeter
    var dateTimeString = 'T' + month + '-' + day + '-' + year + '-' + hour + '-' + min + '-' + sec + '-' + mSec + '-' + Math.floor(Math.random() * 1000000) + 1;

    return dateTimeString;
}

const updateAccountNumber = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #AccountNumber = :AccountNumber",
            ExpressionAttributeValues: {
                ":AccountNumber": {
                    S: event.Digits
                }
            },
            ExpressionAttributeNames: {
                "#AccountNumber": "AccountNumber"
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updateDOB = async (event) => {
    return new Promise((resolve, reject) => {
        var date = event.Digits.substring(4, 8) + "-" + event.Digits.substring(2, 4) + "-" + event.Digits.substring(0, 2);
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #DOB = :DOB",
            ExpressionAttributeValues: {
                ":DOB": {
                    S: date
                }
            },
            ExpressionAttributeNames: {
                '#DOB': 'DOB'
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updateAmount = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #Amount = :Amount",
            ExpressionAttributeValues: {
                ":Amount": {
                    S: "$" + (event.Digits / 100)
                }
            },
            ExpressionAttributeNames: {
                '#Amount': 'Amount'
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const deleteAmount = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "REMOVE #Amount",
            ExpressionAttributeNames: {
                '#Amount': 'Amount'
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updateStripePaymentDetails = async (event, charge, TID) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #PaymentConfirmationCode = :PaymentConfirmationCode, #Date = :Date, #TransactionID=:TransactionID",
            ExpressionAttributeValues: {
                ":PaymentConfirmationCode": {
                    S: charge.id
                },
                ":Date": {
                    S: new Date().toString()
                },
                ":TransactionID": {
                    S: TID
                }
            },
            ExpressionAttributeNames: {
                '#PaymentConfirmationCode': 'PaymentConfirmationCode',
                '#Date': 'Date',
                '#TransactionID': 'TransactionID'
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const updatePaymentDetails = async (event) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        const TID = getUniqueID();
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            },
            UpdateExpression: "SET #PaymentConfirmationCode = :PaymentConfirmationCode, #Date = :Date, #TransactionID=:TransactionID",
            ExpressionAttributeValues: {
                ":PaymentConfirmationCode": {
                    S: event.PaymentConfirmationCode
                },
                ":Date": {
                    S: new Date().toString()
                },
                ":TransactionID": {
                    S: TID
                }
            },
            ExpressionAttributeNames: {
                '#PaymentConfirmationCode': 'PaymentConfirmationCode',
                '#Date': 'Date',
                '#TransactionID': 'TransactionID'
            },
            ReturnValues: "UPDATED_NEW"
        };

        ddb.updateItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

const SendSMSWithTransactionId = async (event, dbObj) => {
    return new Promise((resolve, reject) => {
        client.messages.create({
            body: 'Your payment for the amount ' + dbObj.Amount.S + ' is successful and transaction Id is : ' + dbObj.TransactionID.S,
            from: unescape(event.To),
            to: unescape(event.Caller)
        }).then(message => {
            console.log(message.sid);
            resolve(message.sid)
        }).catch(err => {
            console.log(err);
            reject(err);
        });
    });
}

const getDBItem = async (event) => {

    return new Promise((resolve, reject) => {

        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var dataJson;

        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Key: {
                "ID": {
                    S: event.CallSid
                }
            }
        };

        ddb.getItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.Item);
            }
        });
    });
}

const createDBItem = async (obj) => {
    return new Promise((resolve, reject) => {
        var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
        var params = {
            TableName: 'HELPDESK-PAYMENTS',
            Item: {
                'Phone': { S: obj.Phone },
                'ID': { S: obj.ID }
            }
        };

        ddb.putItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

exports.transcribeHandler = async (event, context, callback) => {

}

// Exposing this lambda as aws api, as this is highly secured keeping it at lambda and only cognito authenticated users will be able to call and get it
exports.decryptionHandler = async (event, context, callback) => {
    const privateKey = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' +
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    const jsonObj = {
        sid: '123xxxxxxxxxxxxxxxxxxxxxxxxxxx',
        key: privateKey
    };

    const resp = {
        statusCode: 200,
        body: JSON.stringify(jsonObj),
    };

    return resp;
}

//this.twilioPaymentHandler();