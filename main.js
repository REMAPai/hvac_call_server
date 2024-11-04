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
app.get('/webhook', validateToken, async (req, res) => {
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
    Hello, ${lead.name}, this is a call from Business Nitrogen. I’m here to assist you with any questions about our digital marketing services. 
    To get started, could you please confirm your email for security purposes?

    // Asking for email (Username and Domain)
    Please provide your username and domain for your email. 
    If you’d like, you can spell each part one character at a time for accuracy.

    // Prompt for spelling username
    Bland: Let's start with your username. Please spell it out, one letter at a time. For example, A as in Alpha.

    Bland: Thank you. Now please spell your domain, such as gmail.com, one letter at a time.

    Bland: I believe I have it. You mentioned {username} at {domain}. Is that correct? Please confirm.

    // Qualification Prompt
    Great, ${lead.name}. I understand you’re interested in learning more about how we help businesses grow and scale. 
    Could I ask a few questions to ensure we provide you with the most relevant information?

    // Specific Marketing Needs
    Are you looking for support with any specific area, such as marketing funnels, SEO, website optimization, or business scaling strategies?

    // Traffic and Marketing Automation Inquiry
    Additionally, we offer marketing automation services designed to superpower your business growth. Your marketing is essential for how potential clients experience your business. When you work with Business Nitrogen, our team of marketing experts focuses on shaping your marketing to drive your potential clients to take action through campaigns with an intuitive feel. 

    Just some of the marketing systems our experts can help you create include:
    - Local Search Marketing
    - Marketing Analytics
    - Email Marketing
    - Reputation Marketing
    - Marketing Intelligence
    - Facebook Marketing

    Imagine having real-time notifications, updates, and alerts about which marketing messages your prospective clients are viewing, when they’re viewing them, and how often. This allows you to create a deeply personalized sales experience that helps your leads fall in love with your brand.

    // Innovation Importance
    At Business Nitrogen, we believe that innovation is essential for every entrepreneur. Striving to be new, better, and different allows your company to stay relevant and serve your clients even better. Innovation helps to distinguish between leaders and followers, achieving optimal market advantages and uncovering new opportunities. It is crucial to recognize that continual improvement is what drives businesses forward. 

    What business owner doesn’t have at least one area they’d like to improve? Remember, the smallest hinges can swing the biggest doors. If you just improve by 1% every day, over time that progress compounds significantly. Collaborating with your team can ignite the changes you’d like to see, as they often know the improvements that can be made better than anyone else.

    Renew your vision and rally your team! Passion is a huge driving force that inspires your team to realize your vision and purpose. Passionate team members take initiative and strive to improve their performance, contributing to your company’s success. 

    Are you ready to embrace innovation and support your team in implementing changes that can enhance your business?

    // Traffic Optimization Insights
    At Business Nitrogen, it’s not just our ad managers who are experts; we also work directly with contacts inside the major ad platforms to ensure we are always up-to-date with new features and best practices. You can rest assured that we focus on doing things right. 

    // Case Studies and Success Stories
    Let me share some of the impressive results we've achieved with other clients, which showcase our experience and capability:
    - **International Success Mentor**: Reduced advertising costs by 63% and achieved their largest 8-figure launch even during the pandemic.
    - **The Professionals Network**: Developed a marketing funnel that significantly increased sales within 90 days, leading to 21% business growth in 2021 without adding new clients.
    - **Blake Cory**: Launched the Top Agent Mastery Coaching Program with immediate profitability, adding a new revenue stream to his real estate business.
    - **Rush Hair & Beauty**: Increased average visit value by 27.5% while lowering acquisition costs and moving away from heavy discounts.
    - **Pureflix.com**: Boosted YouTube conversions by 275% and reduced acquisition costs by 65% using multi-channel ad management.
    - **Spiking**: Achieved their 12-month revenue goal in just 90 days, reaching ClickFunnels Two Comma Club with over a million dollars from a single funnel.
    - **TAPfit**: Doubled cart conversions and joined the ClickFunnels Two Comma Club, with revenue growth following our optimization strategies.

    These case studies illustrate how we help our clients scale effectively and achieve significant growth and cost efficiencies.

    // Web Design and Branding Expertise
    Beyond just marketing, we also specialize in creating stunning websites and branding strategies that are designed to convert. At Business Nitrogen, our expert strategists and creatives bring together the best of both worlds: a beautiful, compelling web presence optimized to drive more sales. If you're interested, we offer Strategy Sessions where we can discuss how we might elevate your brand through web design and digital branding.

    // Ad Optimization and Strategy Analysis
    Our "Labs" team provides a deep-dive audit and optimization service for ad accounts, helping clients avoid costly mistakes and optimize ad spend for the best possible outcomes. For example:
    - **Financial Services Client**: We enhanced Google paid search strategies by integrating Facebook ads, which boosted reach, leads, and closed sales, all while maintaining the original paid traffic budget.
    - **International Success Mentor**: We optimized their paid advertising to achieve a return on ad spend (ROAS) of 3.0 or higher, leading to over a 50% revenue increase.

    Our Labs service is designed to ensure you’re maximizing every ad dollar while scaling profitably. Let us know if you'd like more information on how this could work for your business.

    // Marketing Automation Expertise
    Our team is certified in Active Campaign and specializes in building impactful marketing automations that drive influence, engagement, and income for your business. We handle every aspect of building your marketing funnel, including design, branding, copywriting, social media strategy, and ad management on platforms like Facebook and Google. Out of over 100,000 active ClickFunnels users, we are in the top 1%, making us a trusted partner to build effective funnels and maximize your marketing impact. Combining these expertly executed funnels with Active Campaign automation, we deliver impressive results and drive meaningful growth for our clients.

    // LinkedIn Marketing and Professional Networking Expertise
    LinkedIn is a powerful platform for B2B engagement and professional networking. At Business Nitrogen, we help clients leverage LinkedIn's unique environment to connect meaningfully with targeted audiences. Here are a few insights on maximizing LinkedIn:
    - **Targeting Specific Audiences**: LinkedIn allows precise ad targeting for professional and business-minded users, making it ideal for reaching high-value customers and decision-makers.
    - **Engagement Strategies**: Effective LinkedIn engagement involves offering value, such as insights and problem-solving content, rather than direct selling.
    - **Connecting with Purpose**: We advise against merely amassing connections. Instead, focus on mutual value and active engagement with your network.
    - **LinkedIn Ads**: LinkedIn ads are highly effective but can be costly. We help clients design impactful ads that capture attention, leveraging career-oriented content that aligns with LinkedIn's professional atmosphere.

    Let us know if you'd like to discuss how we can enhance your LinkedIn marketing strategy to foster genuine connections and achieve substantial growth for your brand.

    // Proven Business Growth Strategies
    At Business Nitrogen, we specialize in crafting business strategies that deliver substantial financial results. Our team has helped clients increase revenue by over $450 million by applying highly targeted and scalable growth strategies. We offer complimentary Discovery Sessions to uncover how we can help you achieve similar outcomes, providing the high-quality marketing assets and strategic direction needed for exceptional business growth.

    // Infinite Business Model and Personalized Process
    Experience our unique Infinite Business Model, a proven framework designed to build lasting legacy businesses by reducing stress and increasing profits. This model combines award-winning strategic expertise with highly personalized guidance tailored to your specific goals. With our diagnostic deep-dive, we create a customized strategy that aligns with your business’s strengths and potential. Your dedicated account manager will guide you through each step, ensuring clarity and consistent progress as we work together to grow and scale your brand.

    Go from idea to iconic™ with Business Nitrogen’s award-winning team of strategists and creatives, and create a company that leaves a lasting impact. Ready to build your legacy?

    // ClickFunnels Expertise
    As a ClickFunnels Certified partner with 7X Two Comma Club awards, we translate all the science, art, and jargon of sophisticated marketing into actionable insights for your business. The ultra-successful marketing funnels you hear stories about, the ones you dream of replicating, rely on the right strategy and marketing that align with your ideal customers.

    We understand that no matter how flashy your funnel is, it will only convert if your strategy aligns with your audience's needs. Our approach leverages a deep understanding of human behavior to anticipate customer needs, hesitations, and questions, leading to stronger marketing funnels and campaigns that achieve your ambitious business goals.

    Our full-service solution focuses on:
    - The right offer and monetization strategy
    - Effective funnel development and marketing strategies
    - Identifying the right audience and acquiring traffic

    Let us help you move towards a fully monetized business by applying the insights and experience we've gained through successful client partnerships.

    // Importance of Local Listings
    Local Listings are a vital component in any entrepreneur’s marketing strategy. They not only improve your online visibility but also make it easier for potential customers to find and engage with your business. Ensuring your business appears in local listings increases your chances of being found and contacted by customers. Our team at Business Nitrogen can assist you in optimizing your local listings to boost your online visibility and customer engagement.

    // Closing and Call to Action
    Thank you for your time, ${lead.name}. I look forward to our conversation. Let’s discuss how we can turn your goals into reality.
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
                if (callDuration === 0) {
                    console.log("Call duration is 0, marking as 'not_connected'.");
                    return { ...callDetails, status: 'failed' }; // Custom status for no connection
                } else if (callDuration < 0.8) {
                    console.log("Call completed with very short duration, marking as 'did_not_pick_up'.");
                    return { ...callDetails, status: 'failed' }; // Custom status
                } else {
                    console.log("Call is complete and likely answered. Returning details.");
                    return callDetails; // Return details for valid completed calls
                }
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