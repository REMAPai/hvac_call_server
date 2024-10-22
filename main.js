const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');

// Load environment variables from .env file
require('dotenv').config();

// Bland.AI credentials (replace with your actual Bland.AI API key)
const blandApiKey = process.env.BLAND_API_KEY; // Use your .env variable

const app = express();

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inbound and Outbound Webhook handler
app.post('/webhook', async (req, res) => {
    const { webhookType, data } = req.body;

    // Validate webhookType and data
    if (!webhookType || !data) {
        return res.status(400).json({ message: 'webhookType and data are required' });
    }

    try {
        let responseMessage;

        // Handle inbound webhook
        if (webhookType === 'inbound') {
            responseMessage = await handleInboundWebhook(data);
        }
        // Handle outbound webhook
        else if (webhookType === 'outbound') {
            responseMessage = await handleOutboundWebhook(data);
        } else {
            return res.status(400).json({ message: 'Invalid webhookType' });
        }

        res.status(200).json({ message: responseMessage });
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({ message: 'Failed to process webhook', error: error.message });
    }
});

// Handle inbound webhook logic
async function handleInboundWebhook(data) {
    const { phoneNumber, name, email } = data;

    // Validate required fields
    if (!phoneNumber || !name || !email) {
        throw new Error('Phone number, name, and email are required');
    }

    // Trigger a Bland.AI call to the provided phone number
    const lead = { phone: phoneNumber, name: name, email: email };
    const result = await initiateOutboundCall(lead);
    return result;
}

// Handle outbound webhook logic
async function handleOutboundWebhook(data) {
    const { callId } = data;

    // Validate call ID
    if (!callId) {
        throw new Error('Call ID is required');
    }

    // Get call details from Bland.AI using the call ID
    const callDetails = await getCallDetails(callId);

    // Structure filtered data to send to the endpoint
    const filteredData = {
        call_id: callDetails.call_id,
        call_to: callDetails.to,
        call_from: callDetails.from,
        call_tag: callDetails.status, // e.g., answered, no answer
        call_status: callDetails.status,
        call_duration: callDetails.call_length,
        call_transcript: callDetails.concatenated_transcript,
        call_summary: callDetails.summary,
        call_recording: callDetails.recording_url
    };

    return filteredData;
}

// Initiate AI call function with improved error handling
async function initiateOutboundCall(lead, retries = 3) {
    const phoneNumber = lead.phone;

    const task = `
        Hello ${lead.name}, this is a call from our service. Please respond with your username and domain for your email.
        If we don't understand, you can spell each part one character at a time.

        Bland: Let's start with your username. Please spell it out, one letter at a time. For example, A as in Alpha.

        Wait for user input...

        Bland: Thank you. Now please spell your domain, such as gmail.com, one letter at a time.

        Wait for user input...

        Bland: I think I have it. You said {username} at {domain}. Is that correct? Please confirm.
    `;

    const data = {
        phone_number: phoneNumber,
        task: task
    };

    while (retries > 0) {
        try {
            const response = await axios.post("https://api.bland.ai/call", data, {
                headers: {
                    authorization: `Bearer ${blandApiKey}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
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

// Helper function to get call details from Bland.AI
async function getCallDetails(callId) {
    const url = `https://api.bland.ai/logs`;

    // Data payload
    const data = { call_id: callId };

    try {
        const response = await axios.post(url, data, {
            headers: {
                authorization: `Bearer ${blandApiKey}`,
                'Content-Type': 'application/json',
            }
        });

        // Return the call details
        return response.data;
    } catch (error) {
        console.error('Error fetching call details:', error.response?.data || error.message);
        throw new Error('Failed to retrieve call details');
    }
}

// Function to send call details to GHL
async function sendCallDetailsToGHL(ghlData) {
    const ghlWebhookUrl = 'https://ghl-webhook-url.com'; // Replace with actual GHL webhook URL

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

//Start the Express server
// app.listen(process.env.PORT || 3091, () => {
//     console.log(`Server running...`); 
// });

const port = process.env.PORT || 3091;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
