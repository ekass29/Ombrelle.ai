console.log("Starting server...");

// --- NEW IMPORTS START ---
require('dotenv').config();
const multer = require('multer'); // For file uploads
const { GoogleGenerativeAI } = require("@google/generative-ai");
// --- NEW IMPORTS END ---

const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');
const cron = require('node-cron');

// Initialize Express app
const app = express();
app.use(bodyParser.json()); // To parse JSON request bodies
app.use(cors()); // Enable CORS for all routes

// Serve static files (for assets like HTML, CSS, JS, etc.)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// --- NEW CONFIGURATION START ---
// Configure Multer (For analyzing reports)
const upload = multer({ storage: multer.memoryStorage() });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("❌ CRITICAL ERROR: API Key is missing. Check your .env file.");
}
const genAI = new GoogleGenerativeAI(apiKey);
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const client = new twilio(accountSid, authToken);

// Create MySQL database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', // Your MySQL Workbench username
    password: 'root', // Your MySQL Workbench password
    database: 'health_management',
    port: 3307 // If you're using port 3307
});

// Connect to the database
db.connect(err => {
    if (err) {
        console.error('Database connection failed:', err.stack);
        return;
    }
    console.log('Connected to MySQL database.');
});

cron.schedule('* * * * *', () => {
    const now = new Date();
    // Format current time to match HH:mm (e.g., "14:30") and YYYY-MM-DD
    const currentTime = now.toTimeString().slice(0, 5);
    const currentDate = now.toISOString().slice(0, 10);

    const query = `SELECT * FROM reminders WHERE reminder_date = ? AND reminder_time = ?`;
    
    db.query(query, [currentDate, currentTime], (err, results) => {
        if (err) return console.error('Cron error:', err);

        results.forEach(reminder => {
            // 1. Send SMS
            if (reminder.phone_number) {
                client.messages.create({
                    body: `⏰ Ombrelle Reminder: ${reminder.task}. Notes: ${reminder.notes || 'None'}`,
                    from: twilioPhoneNumber,
                    to: reminder.phone_number
                }).then(message => console.log(`Reminder sent to ${reminder.phone_number}`))
                  .catch(e => console.error('Twilio Error:', e));
            }

            // 2. Handle Repetition
            if (reminder.repetition && reminder.repetition !== 'None') {
                let nextDate = new Date(reminder.reminder_date);
                if (reminder.repetition === 'Daily') {
                    nextDate.setDate(nextDate.getDate() + 1);
                } else if (reminder.repetition === 'Weekly') {
                    nextDate.setDate(nextDate.getDate() + 7);
                } else if (reminder.repetition === 'Monthly') {
                    nextDate.setMonth(nextDate.getMonth() + 1);
                }
                
                // Update the reminder with the new date
                const updateQuery = `UPDATE reminders SET reminder_date = ? WHERE id = ?`;
                db.query(updateQuery, [nextDate.toISOString().slice(0, 10), reminder.id]);
            }
        });
    });
});

// Login route
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Correct SQL query definition
    const query = `SELECT * FROM users WHERE username = ? AND password = SHA2(?, 256)`;

    db.query(query, [username, password], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
            return;
        }

        if (result.length > 0) {
            res.json({ success: true, message: 'Login successful!' });
        } else {
            res.json({ success: false, message: 'Invalid username or password.' });
        }
    });
});


// Route to serve the login.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html')); // Path to your login.html file
});

// Route to serve the index.html file
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Serve the index page
});

// Route to serve the doctors.html page
app.get('/doctors.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'doctors.html')); // Serve the doctors page
});
app.get('/reminder.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'reminder.html')); // Serve the doctors page
});
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html')); // Serve the doctors page
});
app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'profile.html')); // Serve the doctors page
});
app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html')); // Serve the doctors page
});
app.get('/ombrello.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'ombrello.html'));
});
app.get('/mental-health.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'mental-health.html'));
});

// --- NEW ROUTE FOR REPORT PAGE ---
app.get('/analyze-report.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'analyze-report.html'));
});

// Fetch available specialties for the dropdown
app.get('/get-specialties', (req, res) => {
    const query = `SELECT DISTINCT specialty FROM doctors`;
    db.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching specialties:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
            return;
        }

        const specialties = result.map(row => row.specialty);
        res.json({ specialties });
    });
});

// Fetch available locations for the dropdown
app.get('/get-locations', (req, res) => {
    const query = `SELECT DISTINCT city FROM doctors`;
    db.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching locations:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
            return;
        }

        const locations = result.map(row => row.city);
        res.json({ locations });
    });
});

// Search doctors based on specialty and location
app.get('/search-doctors', (req, res) => {
    const { specialty, location } = req.query;

    const query = `SELECT * FROM doctors WHERE specialty LIKE ? AND city LIKE ?`;
    db.query(query, [`%${specialty}%`, `%${location}%`], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
            return;
        }

        if (result.length > 0) {
            res.json({ success: true, doctors: result });
        } else {
            res.json({ success: false, message: 'No doctors found.' });
        }
    });
});
// Route to handle setting reminders
app.post('/set-reminder', (req, res) => {
    const { task, date, time, notes, phoneNumber, repetition } = req.body;

    const query = `INSERT INTO reminders (task, reminder_date, reminder_time, notes, phone_number, repetition) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.query(query, [task, date, time, notes, phoneNumber, repetition], (err, result) => {
        if (err) {
            console.error('Error inserting reminder:', err);
            return res.status(500).json({ success: false, message: 'Error saving reminder' });
        }

        // Send Acknowledgment SMS
        if (phoneNumber) {
            client.messages.create({
                body: `✅ Reminder Set: "${task}" for ${date} at ${time}. Repetition: ${repetition}.`,
                from: twilioPhoneNumber,
                to: phoneNumber
            }).catch(e => console.error("Twilio Ack Error:", e));
        }

        res.json({ success: true, message: 'Reminder set successfully! SMS sent.' });
    });
});

app.get('/get-reminders', (req, res) => {
    const query = 'SELECT * FROM reminders ORDER BY reminder_date ASC, reminder_time ASC';
    db.query(query, (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Error fetching reminders' });
        res.json({ success: true, reminders: result });
    });
});

// --- NEW DELETE ROUTE ---
app.delete('/delete-reminder/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM reminders WHERE id = ?';
    db.query(query, [id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Error deleting' });
        res.json({ success: true, message: 'Reminder deleted' });
    });
});
app.get('/get-user-profile', (req, res) => {
    const username = req.query.username;

    const query = `SELECT full_name, email, phone_number FROM users WHERE username = ?`;
    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Error fetching user profile:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
            return;
        }

        if (result.length > 0) {
            res.json({ success: true, user: result[0] });
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    });
});
// Register route
app.post('/register', (req, res) => {
    const { fullName, username, email, phoneNumber, password } = req.body;

    const query = `INSERT INTO users (full_name, username, email, phone_number, password)
                   VALUES (?, ?, ?, ?, SHA2(?, 256))`;

    db.query(query, [fullName, username, email, phoneNumber, password], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            res.status(500).json({ success: false, message: 'Registration failed.' });
            return;
        }

        res.json({ success: true, message: 'Registration successful! Please login.' });
    });
});

// --- NEW API ROUTES (For Gemini Features) ---

// 1. Chat with AI Doctor (Strict Step-by-Step Triage)
app.post('/api/chat', async (req, res) => {
    // We receive 'history' along with the current 'message' to maintain memory
    const { message, history } = req.body; 

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: `
            You are Dr. Ombrelle, a highly professional, empathetic, and serious medical AI doctor.

            ### CORE OPERATING RULE: ONE QUESTION AT A TIME
            You must conduct a step-by-step triage. **NEVER** ask multiple questions in a single message. Ask exactly **ONE** question, wait for the user's response, and then proceed to the next.

            ### PHASE 1: DATA GATHERING (The Triage)
            You need to gather specific data points before diagnosing. Ask for them in this strict order:
            1. **Duration**: "How long have you been experiencing these symptoms?"
            2. **Severity**: "On a scale of 1-10, how severe is the pain or discomfort?"
            3. **History**: "Do you have any known allergies or existing medical conditions?"
            4. **Other Symptoms**: "Are you experiencing any other discomforts or accompanying symptoms?"
            5. **Location**: "Which City are you in?" (Crucial for doctor recommendations).

            *Note: If the user provides multiple answers in one go (e.g., "I have 8/10 pain for 2 days"), skip the questions you already have answers for.*

            ### PHASE 2: THE DIAGNOSIS & PLAN
            **Trigger:** Only provide this analysis AFTER you have gathered the City/Location and all symptom details.
            
            Output Format (Use this STRICT bullet-point structure):
            
            * **Potential Analysis**: [Medical term] (Explanation in simple terms).
            * **Immediate Relief**: [Steps to take now].
            * **Suggested Medicine**: [Generic Name] - [Standard Dosage] (e.g., "Paracetamol 500mg after food"). *Mention: "Use only if not allergic."*
            * **Specialist to Visit**: [Type of doctor, e.g., "ENT Specialist" or "Dermatologist"].
            * **Top 5 Doctors in [User's City]**: 
                1. [Dr. Name/Hospital] - [Rating/Specialty if known]
                2. [Dr. Name/Hospital]
                3. [Dr. Name/Hospital]
                4. [Dr. Name/Hospital]
                5. [Dr. Name/Hospital]
            
            * **⚠️ Medical Disclaimer**: "I am an AI, not a human doctor. Please consult a professional before taking any medication or if symptoms worsen."

            ### SAFETY PROTOCOLS
            - If symptoms suggest a heart attack (chest pain, left arm pain, shortness of breath) or stroke, STOP triage and tell them to call emergency services immediately.
            - Do not guess doctors without a location.
            `
        });

        // Initialize chat with previous history from the frontend
        const chat = model.startChat({
            history: history || [] 
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const text = response.text();
        
        res.json({ success: true, reply: text });
    } catch (error) {
        console.error("❌ Gemini Chat Error:", error);
        res.status(500).json({ success: false, reply: `Server Error: ${error.message}` });
    }
});
// 2. Report Analysis Route
app.post('/api/analyze-report', upload.single('report'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

        const filePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = "Analyze this medical report. Summarize findings, list abnormal values, and explain what they indicate in simple terms.";

        const result = await model.generateContent([prompt, filePart]);
        const response = await result.response;
        const text = response.text();

        res.json({ success: true, analysis: text });
    } catch (error) {
        console.error("❌ Analysis Error:", error);
        res.status(500).json({ success: false, message: `Analysis Error: ${error.message}` });
    }
});
// 2. Mental Health Therapist API (Separate Brain)
app.post('/api/therapist', async (req, res) => {
    const { message, history } = req.body;

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: `
            You are a compassionate, non-judgmental, and supportive AI Mental Health Companion.
            
            ### YOUR ROLE
            - Act as a "Mini Therapist" or supportive friend.
            - Listen actively and validate the user's feelings (e.g., "It sounds like you're going through a tough time.").
            - Ask **one** open-ended question at a time to help the user explore their feelings.
            - Offer simple coping strategies (breathing exercises, mindfulness, grounding techniques) if appropriate.
            
            ### RULES
            1. **Empathy First**: Always acknowledge the emotion before solving the problem.
            2. **Short & Gentle**: Keep responses concise (2-3 sentences max) so it feels like a chat, not a lecture.
            3. **Memory**: Use the conversation history to refer back to what they said earlier.
            
            ### ⚠️ CRITICAL SAFETY PROTOCOL
            - If the user mentions **suicide, self-harm, or hurting others**:
              1. STOP acting as a therapist.
              2. Immediately provide this text: "I care about you, but I am an AI and cannot provide emergency help. Please call a suicide hotline immediately or go to the nearest hospital."
              3. Do not ask follow-up questions in this specific case.
            `
        });

        const chat = model.startChat({
            history: history || []
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const text = response.text();
        
        res.json({ success: true, reply: text });
    } catch (error) {
        console.error("Therapist Error:", error);
        res.status(500).json({ success: false, reply: "I am having trouble connecting right now. Please take deep breaths and try again in a moment." });
    }
});


// Start the server
const PORT = process.env.PORT || 3000; // Default to 3000, or use an environment variable
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});