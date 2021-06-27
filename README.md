# Accept payments via twilio and stripe, complete server less solution (AWS LAMBDA, API Gateway, Cognito)

Twilio has default payment gateway integration with stripe, But we did bit customization to double confirm the credit card number, amount to be collected.

https://www.twilio.com/docs/voice/tutorials/how-capture-your-first-payment-using-pay

Users can send voice mail if they have any queries regarding payment.

Lambda project to process Voice mail of AWS contact center 

Idea is to forward calls from aws contact centre to twilio and twilio api will record and transcribe the voice recording
