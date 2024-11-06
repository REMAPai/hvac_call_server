const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken'); // For Bearer Token generation
require('dotenv').config();
const { stringify } = require('flatted');

const blandApiKey = process.env.BLAND_API_KEY; // Use your .env variable
const openAiApiKey = process.env.OPENAI_API_KEY; // OpenAI API key from .env
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

app.post('/webhook', validateToken, async (req, res) => {
    const { data, outbound_webhook_url } = req.body;

    if (!data) {
        console.log("Request missing 'data'");
        return res.status(400).json({ message: 'Data is required' });
    }

    if (!outbound_webhook_url) {
        console.log("Request missing 'outbound_webhook_url'");
        return res.status(400).json({ message: 'outbound_webhook_url is required' });
    }

    try {
        let inboundResponse;
        let outboundResponse;

        // First, handle inbound webhook
        inboundResponse = await handleInboundWebhook(data);

        // Pass the result of handleInboundWebhook to handleOutboundWebhook
        outboundResponse = await handleOutboundWebhook(inboundResponse, outbound_webhook_url);

        // Respond with the outbound webhook result
        console.log('Webhook data processed:', outboundResponse);
        res.send({ message: outboundResponse });
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({ message: 'Failed to process webhook', error: error.message });
    }
});

// // GET handler for testing purposes
app.get('/webhook', async (req, res) => {
    const { data } = req.body;

    res.send({ message: req });

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


app.get('/status', (req, res) => {
    res.status(200).send('API is running. Use POST /webhook for webhooks.');
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

// New endpoint to fetch call logs directly using callId
app.post('/logs', validateToken, async (req, res) => {
    const { callId } = req.body;  // Get callId from the request body

    console.log("Received callId:", callId);

    if (!callId) {
        return res.status(400).json({ message: 'Call ID is required' });
    }

    try {
        const callDetails = await getCallDetails(callId);

        // Respond with the fetched call details
        res.json({
            call_id: callDetails.call_id,
            call_to: callDetails.to,
            call_from: callDetails.from,
            call_status: callDetails.status,
            call_duration: callDetails.call_length,
            call_transcript: callDetails.concatenated_transcript,
            call_summary: callDetails.summary,
            call_recording: callDetails.recording_url
        });
    } catch (error) {
        console.error('Error fetching call details:', error.message);
        res.status(500).json({ message: 'Failed to fetch call details', error: error.message });
    }
});

async function handleOutboundWebhook(data, outboundWebhookUrl) {
    const callId = data.call_id;

    if (callId) {
        console.log("Call ID:", callId);
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
        call_tag: callDetails.status,
        call_status: callDetails.status,
        call_duration: callDetails.call_length,
        call_transcript: callDetails.concatenated_transcript,
        call_summary: callDetails.summary,
        call_recording: callDetails.recording_url
    };

    console.log("Filtered call details:", stringify(filteredData));
    //res.json({ message: stringify(filteredData) });

    // Send data to the client's outbound webhook URL
    try {
        const response = await axios.post(outboundWebhookUrl, filteredData, {
            headers: {
                "Content-Type": "application/json",
            },
        });
        console.log("Data sent to outbound webhook URL successfully:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error sending data to outbound webhook URL:", error.message);
        throw new Error('Failed to send data to outbound webhook URL');
    }
}

// Handle outbound webhook logic
// async function handleOutboundWebhook(data) {
//     // Access the call_id from the data
//     const callId = data.call_id;

//     // Check if call_id exists
//     if (callId) {
//         console.log("Call ID:", callId);
//         // You can now use the callId for any further logic or actions, such as saving to a database, etc.
//     } else {
//         console.log("No call_id found in the received data.");
//     }

//     console.log("Outbound webhook received:", data);

//     // Get call details from Bland.AI using the call ID
//     const callDetails = await getCallDetails(callId);

//     // Structure filtered data to send to the endpoint
//     const filteredData = {
//         call_id: callDetails.call_id,
//         call_to: callDetails.to,
//         call_from: callDetails.from,
//         call_tag: callDetails.status, // e.g., answered, no answer
//         call_status: callDetails.status,
//         call_duration: callDetails.call_length,
//         call_transcript: callDetails.concatenated_transcript,
//         call_summary: callDetails.summary,
//         call_recording: callDetails.recording_url
//     };

//     console.log("Filtered call details:", filteredData);
//     return filteredData; // Return the structured call details
// }

// Initiate AI call function using the passed Bearer Token
async function initiateOutboundCall(lead, bearerToken, retries = 1) {
    const phoneNumber = lead.phone;

    const task = `
    // Initial Greeting and Verification
    Hello, ${lead.name}, this is a call from Sababa Services. I’m here to assist you with any questions about how our AI-driven services can help your business. 
    To get started, could you please confirm your email for security purposes?

    // Asking for email (Username and Domain)
    Please provide your username and domain for your email. 
    If you’d like, you can spell each part one character at a time for accuracy.

    // Prompt for spelling username
    Bland: Let's start with your username. Please spell it out, one letter at a time. For example, A as in Alpha.

    Bland: Thank you. Now please spell your domain, such as gmail.com, one letter at a time.

    Bland: I believe I have it. You mentioned {username} at {domain}. Is that correct? Please confirm.

    // Qualification Prompt
    Great, ${lead.name}. I understand you’re interested in learning more about how our AI services can streamline operations and improve efficiency for your business. 
    Could I ask a few questions to ensure we provide you with the most relevant information?

    // Industry-Specific Prompts

    // HVAC
    Sababa’s AI service ensures you never miss a hot lead or emergency call. It can handle urgent requests 24/7, scheduling technicians for both routine maintenance and those middle-of-the-night AC breakdowns. Would you like more details on how our system can optimize your HVAC business operations?

    // Plumbing
    For your plumbing business, Sababa's AI triages calls, books appointments, and ensures your team is deployed efficiently, whether it’s for a leaky faucet or a major pipe burst. Would this kind of AI support help streamline your operations?

    // Roofing
    Sababa’s AI service can field inquiries about estimates, schedule inspections, and follow up on quotes, freeing you up to focus on keeping roofs over heads. How would automating these tasks benefit your roofing business?

    // Electrical
    Never miss a call again! Sababa’s AI answers customer questions, books installations, and manages your team’s packed schedule of repairs and upgrades. Would you like to learn more about how our AI can help you scale your electrical services?

    // Pool Maintenance
    Sababa’s AI ensures your pool maintenance business stays on track, handling routine scheduling, chemical inquiries, and emergency calls to keep your customers’ pools crystal clear year-round. Does this sound like something you could benefit from?

    // Coaches
    Sababa empowers your coaching practice by booking sessions, following up with clients, and managing your calendar. This gives you more time to focus on inspiring and guiding your clients to success. Can I show you how this works for your coaching business?

    // Cleaning
    Keep your cleaning business running smoothly while Sababa handles booking, reschedules, and special requests, ensuring your team stays productive and clients’ spaces stay pristine. Would you like to see how we can help you stay organized?

    // Landscaping
    Sababa helps cultivate more business for your landscaping company by nurturing leads, scheduling consultations, and managing recurring appointments. Would this AI service help you focus more on creating beautiful outdoor spaces?

    // Pest Control
    Exterminate communication gaps with Sababa’s AI. It schedules treatments, answers common pest questions, and follows up on recurring service plans, ensuring your customers stay bug-free and satisfied. Does this sound like something that could help grow your pest control business?

    // Interior Design
    Sababa’s AI helps you design a flawless client experience, discussing project needs, scheduling consultations, and managing your calendar of client meetings and site visits. Would you like to learn how this can make your design business more efficient?

    // Contracting
    Build a stronger business foundation with Sababa’s AI, which manages project inquiries, sets up site visits, and keeps your jobs pipeline full and flowing smoothly. How could this help manage your contracting business?

    // Consultants
    Streamline your consulting business with Sababa’s AI that pre-qualifies leads, schedules discovery calls, and manages your availability. Let our AI handle the logistics while you focus on delivering expert solutions to your clients. Would this help you optimize your consulting practice?

    // In Closing
    Thank you for your time, ${lead.name}. It was great speaking with you today. I will send you more information via email regarding the topics we discussed. If you have any questions or would like to dive deeper into any of the areas we've mentioned, feel free to reach out to me directly.

    Looking forward to working with you!
`;

    const data = {
        phone_number: phoneNumber,
        task: task,
        summarize: true,
        record: true
    };

    while (retries > 0) {
        try {
            console.log("Initiating outbound call to:", phoneNumber);

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

            // const callStatus = callDetails.status;
            const callDuration = callDetails.call_length || 0; // Default to 0 if missing

            console.log("Current call status:", callStatus);

            console.log("Current call duration:", callDuration);

            if (callStatus === 'complete' || callStatus === 'completed') {
            //     if (callDuration === 0) {
            //         console.log("Call duration is 0, marking as 'not_connected'.");
            //         return { ...callDetails, status: 'failed' }; // Custom status for no connection
            //     } else if (callDuration < 0.8) {
            //         console.log("Call completed with very short duration, marking as 'did_not_pick_up'.");
            //         return { ...callDetails, status: 'failed' }; // Custom status
            //     } else {
            //         console.log("Call is complete and likely answered. Returning details.");
                     return callDetails; // Return details for valid completed calls
            //     }
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

// API endpoint to generate SMS response
app.post('/generate-sms', validateToken, async (req, res) => {
    const { contactNumber, stage, contactName } = req.body;

    if (!contactNumber || !stage) {
        return res.status(400).json({ message: 'Contact number, name and stage are required' });
    }

    try {
        const smsResponse = await generateSmsResponse(contactNumber, stage, contactName);
        res.json({ sms: smsResponse });
    } catch (error) {
        console.error('Error generating SMS response:', error.message);
        res.status(500).json({ message: 'Failed to generate SMS response', error: error.message });
    }
});

// Generate SMS response using OpenAI based on the interaction stage
async function generateSmsResponse(contactNumber, interactionStage, contactName) {
    const smsTemplates = {
        initialCall: `Dear ${contactName}, we attempted to reach you via phone to discuss your recent inquiry. If we were unable to connect, please let us know a convenient time for a follow-up. Thank you.`,
        followUp: `Dear ${contactName}, this is a follow-up regarding the reminder we sent previously. We would appreciate your feedback or confirmation at your earliest convenience. Thank you for your attention.`,
        escalation: `Dear ${contactName}, we have made several attempts to reach you regarding this matter. Please respond to this message or contact us directly to resolve this matter promptly. Your cooperation is greatly appreciated.`,
        finalCall: `Dear ${contactName}, this is our final attempt to contact you regarding your issue. If we do not hear back from you by the end of the day, we may mark your case as unresponsive. We look forward to your prompt reply.`,
        callClosure: `Dear ${contactName}, thank you for speaking with us today regarding your inquiry. If you have any further questions or require assistance, please do not hesitate to contact us. We appreciate your time.`
    };

    const message = smsTemplates[interactionStage] || "Default message for contacting user.";
    
    // Call OpenAI API to generate SMS response
    const openAiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo", // Specify the model
        messages: [
            { role: "system", content: "You are a helpful assistant that generates formal SMS responses." },
            { role: "user", content: `Generate a formal SMS response for the contact: ${message}` }
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${openAiApiKey}`, // Use OpenAI API key
            'Content-Type': 'application/json'
        }
    });

    const generatedMessage = openAiResponse.data.choices[0].message.content;

    console.log(`SMS to ${contactNumber}: ${generatedMessage}`);

    const smsReponseData = {
        contact_no: contactNumber,
        contact_name: contactName,
        message: generatedMessage
    };

    return smsReponseData;
}

const PORT = process.env.PORT || 80; // Set a default port
app.listen(PORT, () => {
    console.log(`Server is running on http://api.hvac.remap.ai:${PORT}/webhook`); // Updated URL
});