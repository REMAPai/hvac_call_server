const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');

// Bland.ai credentials
const blandApiKey = ''; // Replace with your Bland.ai API key

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true })); // To parse form data
app.use(bodyParser.json());

// Serve static HTML files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// POST endpoint to handle conditions
app.post('/check-conditions', async (req, res) => {
    let { conditionType, userData } = req.body;

    // Ensure conditionType is always an array
    if (!Array.isArray(conditionType)) {
        conditionType = [conditionType];  // Convert to array if it's a single value
    }

    try {
        // Process each condition type
        for (let type of conditionType) {
            if (type === 'reminder') {
                console.log('Reminder condition triggered for:', userData.name);
                await sendReminderSMS(userData.phone, 'This is a reminder for your upcoming appointment!');
            } else if (type === 'scheduling') {
                console.log('Scheduling condition triggered for:', userData.name);
                await handleScheduling(userData);
            } else if (type === 'call') {
                console.log('AI call condition triggered for:', userData.name);
                await initiateOutboundCall(userData);  // Bland.ai call integration
                // No SMS is sent when "call" condition is triggered
            } else {
                console.log('Unknown condition type:', type);
            }
        }

        // Send the final response after processing
        res.status(200).send('Condition(s) processed successfully');
    } catch (error) {
        console.error('Error processing condition:', error);
        res.status(500).send('Internal server error');
    }
});

// Function to handle outbound calls using Bland.ai
async function initiateOutboundCall(userData) {
    const phoneNumber = userData.phone; // The number to call
    const task = `Hello ${userData.name}, this is a call from our service. Please respond with your username and domain.`;

    // Data payload to send to Bland.ai
    const data = {
        phone_number: phoneNumber,  
        task: task                  
    };

    // Dispatch the phone call via Bland.ai API
    try {
        const response = await axios.post("https://api.bland.ai/call", data, {
            headers: {
                authorization: blandApiKey,
                "Content-Type": "application/json",
            },
        });

        const { status } = response.data;
        if (status) {
            console.log("Phone call dispatched successfully");
        } else {
            console.log("Error dispatching phone call:", response.data.message);
        }
    } catch (error) {
        console.error("Error dispatching phone call:", error.response?.data || error.message);
        throw new Error("Failed to dispatch phone call");
    }
}

// Function to send an SMS reminder using Bland.ai
async function sendReminderSMS(toPhone, message) {
    try {
        const response = await axios.post('https://api.bland.ai/sms', {
            apiKey: blandApiKey,
            to: toPhone,
            message: message
        });
        console.log('Reminder SMS sent:', response.data);
    } catch (error) {
        console.error('Error sending SMS via Bland.ai:', error.response?.data || error.message);
        throw new Error("Failed to send reminder SMS");
    }
}

// Simulated scheduling function
async function handleScheduling(userData) {
    const appointmentDate = '2024-10-20'; // Replace with dynamic date if needed
    const appointmentTime = userData.preferredTime || '10:00 AM';
    console.log(`Appointment scheduled for ${userData.name} on ${appointmentDate} at ${appointmentTime}`);

    // Scheduling still sends SMS
    await sendReminderSMS(userData.phone, `Your appointment is scheduled for ${appointmentDate} at ${appointmentTime}`);
}

// Start the Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
