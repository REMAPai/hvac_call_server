// const express = require('express');
// const bodyParser = require('body-parser');
// const path = require('path');
// // const twilio = require('twilio');

// // Twilio credentials
// const accountSid = ''; 
// const authToken = ''; 
// // const client = twilio(accountSid, authToken);

// const app = express();
// const port = 3000;

// app.use(bodyParser.urlencoded({ extended: true })); 
// app.use(bodyParser.json());

// // Serve static HTML files from the public directory
// app.use(express.static(path.join(__dirname, 'public')));

// // POST endpoint to handle conditions
// app.post('/check-conditions', (req, res) => {
//     let { conditionType, userData } = req.body;

//     // Ensure conditionType is always an array
//     if (!Array.isArray(conditionType)) {
//         conditionType = [conditionType];  // Convert to array if it's a single value
//     }

//     // Process each condition type
//     conditionType.forEach(type => {
//         if (type === 'reminder') {
//             console.log('Reminder condition triggered for:', userData.name);
//             sendReminderSMS(userData.phone, 'This is a reminder for your upcoming appointment!');
//         } else if (type === 'scheduling') {
//             console.log('Scheduling condition triggered for:', userData.name);
//             handleScheduling(userData);
//         } else if (type === 'call') {
//             console.log('AI call condition triggered for:', userData.name);
//             initiateOutboundCall(userData);
//         } else {
//             console.log('Unknown condition type:', type);
//         }
//     });

//     res.status(200).send('Condition(s) processed');
// });

// // Function to send an SMS reminder using Twilio
// function sendReminderSMS(toPhone, message) {
//     client.messages
//         .create({
//             body: message,
//             from: '+61483957967', // Twilio number
//             to: toPhone
//         })
//         .then(message => console.log('Reminder SMS sent:', message.sid))
//         .catch(error => console.error('Error sending SMS:', error));
// }

// // Simulated scheduling function
// function handleScheduling(userData) {
//     console.log(`Scheduling an appointment for ${userData.name} at ${userData.preferredTime}`);
    
//     // Simulate scheduling logic
//     const appointmentDate = '2024-10-20'; // Replace this with dynamic data if needed
//     const appointmentTime = userData.preferredTime || '10:00 AM';
//     console.log(`Appointment scheduled for ${appointmentDate} at ${appointmentTime}`);
    
//     // Send SMS confirmation after scheduling
//     sendReminderSMS(userData.phone, `Your appointment is scheduled for ${appointmentDate} at ${appointmentTime}`);
// }

// // Function to initiate an outbound call using Twilio
// function initiateOutboundCall(userData) {
//     const toPhone = userData.phone; // The number to call
//     const message = `Hello ${userData.name}, this is a call from our service. Please respond with your username and domain.`;
    
//     client.calls
//         .create({
//             url: 'http://demo.twilio.com/docs/voice.xml', // TwiML URL
//             to: toPhone,
//             from: '+61483957967' // Twilio number
//         })
//         .then(call => console.log('Outbound call initiated:', call.sid))
//         .catch(error => console.error('Error initiating call:', error));
// }

// // Start the Express server
// app.listen(port, () => {
//     console.log(`Server running on port ${port}`);
// });
