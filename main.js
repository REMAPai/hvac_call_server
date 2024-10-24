const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken'); // For Bearer Token generation
require('dotenv').config();

const blandApiKey = process.env.BLAND_API_KEY; // Use your .env variable
const jwtSecret = process.env.JWT_SECRET; // JWT secret for signing token

console.log("JWT Secret:", jwtSecret); // Debugging line, can be removed later

const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Bearer Token generation function
const generateBearerToken = () => {
    const payload = { service: 'blandAI' }; // Payload for token, modify as needed
    const options = { expiresIn: '1h' }; // Token valid for 1 hour
    return jwt.sign(payload, jwtSecret, options); // Sign the token using the secret key
};

// Middleware to validate JWT
const validateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Get the token from the Authorization header

    if (!token) {
        return res.status(403).send('Token is required for authentication');
    }

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).send('Invalid token');
        }
        req.user = { token }; // Attach the token to the request object
        next();
    });
};

// API endpoint to generate a Bearer Token
app.get('/token', (req, res) => {
    try {
        const token = generateBearerToken();
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: 'Failed to generate token', error: error.message });
    }
});

// Inbound and Outbound Webhook handler (POST)
app.post('/webhook', validateToken, async (req, res) => {
    const { data } = req.body;

    if (!data) {
        console.log("Request missing 'data'");
        return res.status(400).json({ message: 'Data is required' });
    }

    try {
        let inboundResponse;
        let outboundResponse;

        // First, handle inbound webhook
        inboundResponse = await handleInboundWebhook(data, req.user.token); // Pass token to handleInboundWebhook

        console.log("inboundResponse", inboundResponse);

        // Pass the result of handleInboundWebhook to handleOutboundWebhook
        outboundResponse = await handleOutboundWebhook(inboundResponse);

        console.log("outboundResponse", outboundResponse);

        // Respond with the outbound webhook result
        console.log('Webhook data processed:', outboundResponse);
        res.send({ message: outboundResponse });
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({ message: 'Failed to process webhook', error: error.message });
    }
});

// GET handler for testing purposes
app.get('/webhook', (req, res) => {
    res.status(200).send('Webhook endpoint is working. Please use POST for webhooks.');
});

// Handle inbound webhook logic
async function handleInboundWebhook(data, bearerToken) {
    const { phoneNumber, name, email } = data;

    // Validate required fields
    if (!phoneNumber || !name || !email) {
        console.log("Missing required fields in 'data':", data);
        throw new Error('Phone number, name, and email are required');
    }

    console.log("Inbound webhook received:", data);

    // Trigger a Bland.AI call to the provided phone number
    const lead = { phone: phoneNumber, name: name, email: email };
    const result = await initiateOutboundCall(lead, bearerToken); // Pass token to initiateOutboundCall

    console.log("result", result);

    return result; // Ensure this includes the callId
}

// Handle outbound webhook logic
async function handleOutboundWebhook(data) {
    // Access the call_id from the data
    const callId = data.call_id;

    // Check if call_id exists
    if (callId) {
        console.log("Call ID:", callId);
        // You can now use the callId for any further logic or actions, such as saving to a database, etc.
    } else {
        console.log("No call_id found in the received data.");
    }

    console.log("Outbound webhook received:", data);

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

    console.log("Filtered call details:", filteredData);
    return filteredData; // Return the structured call details
}

// Initiate AI call function using the passed Bearer Token
async function initiateOutboundCall(lead, bearerToken, retries = 1) {
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
            console.log("Initiating outbound call to:", phoneNumber);

            console.log("Bearer Token:", bearerToken);

            const response = await axios.post("https://api.bland.ai/call", data, {
                 headers: {
                    authorization: `Bearer ${blandApiKey}`,
                    "Content-Type": "application/json",
                },
            });
            console.log("Outbound call initiated successfully:", response.data);

            return response.data; // Return the response data that includes callId
        } catch (error) {
            console.error("Error dispatching phone call:", error.response?.data || error.message);
            retries--;
            console.log(`Retrying... Attempts left: ${retries}`);
        }

        retries--;
    }
}

// Helper function to get call details from Bland.AI and wait until the call status is 'Complete'
async function getCallDetails(callId) {
    const url = `https://api.bland.ai/logs`;
    const data = { call_id: callId };

    try {
        let callStatus = '';
        let retries = 10; // Maximum number of attempts before stopping
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        // Polling the API until the call status becomes 'Complete'
        while (retries > 0) {
            console.log("Fetching call details for call ID:", callId);
            const response = await axios.post(url, data, {
                headers: {
                    authorization: `Bearer ${blandApiKey}`,
                    'Content-Type': 'application/json',
                }
            });

            const callDetails = response.data;
            callStatus = callDetails.queue_status; // Assuming 'status' holds the call status

            console.log("Current call status:", callStatus);

            if (callStatus === 'complete' || callStatus === 'completed') {
                console.log("Call is complete, returning details.");
                return callDetails; // Return the call details once it's 'Complete'
            }

            // Wait for some time before the next status check
            await delay(15000); // Wait for 15 seconds before checking again
            retries--;
        }

        throw new Error('Call did not complete within the allowed attempts');
    } catch (error) {
        console.error('Error fetching call details:', error.response?.data || error.message);
        throw new Error('Failed to retrieve call details');
    }
}

// Start the Express server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
