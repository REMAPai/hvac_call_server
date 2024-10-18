const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const twilio = require('twilio');
const axios = require('axios');

// Load environment variables from .env file
require('dotenv').config();

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID; // Use your .env variable
const authToken = process.env.TWILIO_AUTH_TOKEN; // Use your .env variable
const client = twilio(accountSid, authToken);

// Bland.ai credentials (replace with your actual Bland.ai API key)
const blandApiKey = process.env.BLAND_API_KEY; // Use your .env variable

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inbound Webhook to trigger a call (towards Sababa)
app.post('/inbound-webhook', async (req, res) => {
    const { phoneNumber, name, email } = req.body;
    
    // Validate the required fields
    if (!phoneNumber || !name || !email) {
        return res.status(400).json({ message: 'Phone number, name, and email are required' });
    }

    try {
        // Trigger a Bland.AI call to the provided phone number
        const lead = { phone: phoneNumber, name: name, email: email };
        await initiateOutboundCall(lead);

        res.status(200).json({ message: 'Call triggered successfully' });
    } catch (error) {
        console.error('Error triggering the call:', error);
        res.status(500).json({ message: 'Failed to trigger the call' });
    }
});

// Outbound Webhook (towards GHL, sends call details after completion)
app.post('/outbound-webhook', async (req, res) => {
    const { callId } = req.body;
      
    if (!callId) {
        return res.status(400).json({ message: 'Call ID is required' });
    }

    try {
        // Get call details from Bland.AI using the call ID
        const callDetails = await getCallDetails(callId);
        
        // Structure data to send to GHL, including logs
        const ghlData = {
            call_id: callDetails.call_id,
            call_to: callDetails.to,
            call_from: callDetails.from,
            call_tag: callDetails.status, // e.g., answered, no answer, voicemail
            call_status: callDetails.status,
            call_duration: callDetails.call_length,
            call_transcript: callDetails.concatenated_transcript,
            call_summary: callDetails.summary,
            call_recording: callDetails.recording_url
        };

        // Send call details to GHL system
        //await sendCallDetailsToGHL(ghlData);
        
        // Respond to the client after sending details to GHL
        res.status(200).json({ message: 'Call details and logs', ghlData });
    } catch (error) {
        console.error('Error sending call details and logs to GHL:', error);
        res.status(500).json({ message: 'Failed to send call details and logs to GHL' });
    }
});

// Initiate AI call function with improved error handling
async function initiateOutboundCall(lead, retries = 1) {
    const phoneNumber = lead.phone; 
    const task = `Hello ${lead.name}, this is a call from our service. If we don't understand your email correctly, we will send you a confirmation link via SMS. Please respond with your username and domain.`;

    const data = {
        phone_number: phoneNumber,  
        task: task                  
    };

    while (retries > 0) {
        try {
            const response = await axios.post("https://api.bland.ai/call", data, {
                headers: {
                    authorization: blandApiKey,
                    "Content-Type": "application/json",
                },
            });

            const { status, username, domain } = response.data;

            // Check if username and domain are present
            if (!username || !domain) {
                console.error("Error: Missing username or domain in the response:", response.data);
                throw new Error("Username or domain is undefined.");
            }

            console.log("Phone call dispatched successfully");

            const recognizedEmail = `${username}@${domain}`;
            if (!validateEmail(recognizedEmail)) {
                console.log(`Invalid email recognized: ${recognizedEmail}. Asking user to confirm.`);
                await sendEmailConfirmationSMS(lead, 'It seems we couldn’t capture your email. Please confirm your email using the link.');
            } else {
                console.log(`Successfully recognized email: ${recognizedEmail}`);
                lead.email = recognizedEmail;
                await sendConfirmationEmail(lead.email, new Date());
                await sendReminderSMS(lead.phone, `Your confirmed email is: ${lead.email}`);
            }
            return;
        } catch (error) {
            console.error("Error dispatching phone call:", error.response?.data || error.message);
            retries--;
            if (retries === 0) {
                throw new Error("Failed to dispatch phone call after multiple attempts");
            }
            console.log(`Retrying... Attempts left: ${retries}`);
        }
    }
}

// Function to get logs from Bland.AI using the call_id
async function getLogs(callId) {
    const url = 'https://api.bland.ai/logs'; // Bland.AI logs API endpoint

    const data = {
        call_id: callId,
    };

    const headers = {
        Authorization: `Bearer ${blandApiKey}`,
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios.post(url, data, { headers });
        return response.data; // Return the logs from the response
    } catch (error) {
        console.error('Error fetching logs:', error.response?.data || error.message);
        throw new Error('Failed to retrieve logs');
    }
}

// Helper function to get call details from Bland.AI
async function getCallDetails(callId) {
    const url = `https://api.bland.ai/logs`;

    // Data payload
    const data = { call_id: callId };

    try {
        // Make the API call using POST
        const response = await axios.post(url, data, {
            headers: {
                authorization: blandApiKey,
                'Content-Type': 'application/json',
            }
        });

        // Return the call details
        return response.data;
    } catch (error) {
        console.error('Error fetching call details:', error.response?.data || error.message);
        // Add logic to handle 502 Bad Gateway errors gracefully
        if (error.response?.status === 502) {
            throw new Error('Bland.AI service is currently unavailable. Please try again later.');
        }
        throw new Error('Failed to retrieve call details');
    }
}

// Function to send SMS with email confirmation link using Twilio
async function sendEmailConfirmationSMS(lead, message) {
    const confirmationLink = `https://yourdomain.com/confirm-email?name=${encodeURIComponent(lead.name)}&phone=${encodeURIComponent(lead.phone)}`;
    const smsMessage = `${message} Click here to confirm your email: ${confirmationLink}`;
    
    try {
        await sendReminderSMS(lead.phone, smsMessage);
        console.log('SMS for email confirmation sent successfully.');
    } catch (error) {
        console.error('Error sending SMS for email confirmation:', error);
    }
}

// Function to send an SMS reminder using Twilio
function sendReminderSMS(toPhone, message) {
    client.messages
        .create({
            body: message,
            from: '+61483957967', // Twilio number
            to: toPhone
        })
        .then(message => console.log('Reminder SMS sent:', message.sid))
        .catch(error => console.error('Error sending SMS:', error));
}

// Helper function to validate email format
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Function to send email confirmation
async function sendConfirmationEmail(email, scheduledTime) {
    console.log(`Sending confirmation email to ${email} for demo at ${scheduledTime}`);
    // Send email logic here (e.g., using SendGrid, etc.)
}

// Function to send call details to GHL
async function sendCallDetailsToGHL(ghlData) {
    const ghlWebhookUrl = 'https://ghl-webhook-url.com';

    try {
        await axios.post(ghlWebhookUrl, ghlData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Call details sent to GHL successfully');
    } catch (error) {
        console.error('Error sending call details to GHL:', error.response?.data || error.message);
        throw new Error('Failed to send call details to GHL');
    }
}

// Start the Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
