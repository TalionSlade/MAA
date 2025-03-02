const express = require('express');
const jsforce = require('jsforce');
const { OpenAI } = require('openai');
require('dotenv').config();
const cors = require('cors');
const session = require('express-session');

const app = express();
app.use(express.json());

// Update CORS configuration to allow your frontend origin and credentials
app.use(cors({
  origin: 'http://localhost:4173', // Match your frontend's origin (port 4173)
  credentials: true, // Allow cookies, authorization headers, etc.
}));

app.use(session({
  secret: process.env.SESSION_SECRET, // Use the environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    maxAge: 3600000 // 1 hour (adjust as needed)
  }
}));


// Constants
const STATIC_USERNAME = process.env.STATIC_USERNAME || 'Jack Rogers';
const STATIC_PASSWORD = process.env.STATIC_PASSWORD || 'password123';
const SALESFORCE_ACCESS_TOKEN = process.env.SALESFORCE_ACCESS_TOKEN;
const SALESFORCE_INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL;
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Utility Functions
const getSalesforceConnection = () => {
  if (!SALESFORCE_ACCESS_TOKEN || !SALESFORCE_INSTANCE_URL) {
    throw new Error('Salesforce credentials not configured in environment');
  }
  return new jsforce.Connection({
    instanceUrl: SALESFORCE_INSTANCE_URL,
    accessToken: SALESFORCE_ACCESS_TOKEN,
  });
};

// Helper Functions
function extractJSON(str) {
  const codeBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
  const codeBlockMatch = str.match(codeBlockRegex);
  
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      JSON.parse(codeBlockMatch[1]);
      return codeBlockMatch[1];
    } catch (e) {}
  }
  
  const jsonRegex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g;
  const matches = str.match(jsonRegex);
  
  if (matches) {
    for (const match of matches) {
      try {
        JSON.parse(match);
        return match;
      } catch (e) {}
    }
  }
  
  return '{}';
}

function getMostFrequent(arr) {
  if (!arr.length) return null;
  const counts = arr.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

// Convert AM/PM time to 24-hour HH:MM:SS for Salesforce DateTime
function convertTo24HourTime(timeStr) {
  if (!timeStr) return null;
  const [time, modifier] = timeStr.trim().split(' ');
  if (!modifier || !['AM', 'PM'].includes(modifier.toUpperCase())) {
    return time + ':00'; // Assume it's already in 24-hour format (e.g., "10:00")
  }

  let [hours, minutes] = time.split(':').map(Number);
  if (modifier.toUpperCase() === 'PM' && hours !== 12) hours += 12;
  else if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}

// Combine date and time into ISO 8601 format for Salesforce
function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const time24 = convertTo24HourTime(timeStr);
  if (!time24) return null;
  return `${dateStr}T${time24}Z`; // e.g., "2025-02-27T10:00:00Z"
}

// Middleware for session-based authentication (for bankers)
const authenticate = (req, res, next) => {
  if (!req.session.user || req.session.user.username !== STATIC_USERNAME) {
    return res.status(401).json({ message: 'Unauthorized: Please log in as Jack Rogers' });
  }
  next();
};

// Optional authentication (allowing guests or authenticated users)
const optionalAuthenticate = (req, res, next) => {
  if (!req.session.user) {
    // Don't automatically set req.user here - we'll use the customerType from the request body
    req.user = { username: 'guest' }; // This should be used as a fallback only
  } else {
    req.user = req.session.user;
  }
  next();
};

// Routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Missing username or password' });
  }
  if (username !== STATIC_USERNAME || password !== STATIC_PASSWORD) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  req.session.user = { username };
  res.json({ message: 'Login successful', username });
});


// New route to check session status
app.get('/api/auth/check-session', (req, res) => {
  if (req.session.user && req.session.user.username === STATIC_USERNAME) {
    res.json({ username: req.session.user.username });
  } else {
    res.status(401).json({ message: 'Not logged in' });
  }
});

// In your backend file, after session middleware but before routes
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ message: 'Failed to log out' });
    }
    res.clearCookie('connect.sid'); // Clear the session cookie (default name for express-session)
    res.json({ message: 'Logged out successfully' });
  });
});

// ... (rest of your routes and code remain the same)

app.get('/api/salesforce/appointments', authenticate, async (req, res) => {
  try {
    const conn = getSalesforceConnection();
    const result = await conn.query(
      'SELECT Id, Reason_for_Visit__c, Appointment_Date__c, Appointment_Time__c, Location__c ' +
      'FROM Appointment__c WHERE Contact__c = \'003dM000005H5A7QAK\''
    );
    res.json(result.records);
  } catch (error) {
    console.error('Error fetching appointments:', error.message);
    res.status(500).json({ message: 'Failed to fetch appointments', error: error.message });
  }
});

app.post('/api/salesforce/appointments', authenticate, async (req, res) => {
  try {
    const conn = getSalesforceConnection();
    const appointmentData = {
      ...req.body,
      Contact__c: '003dM000005H5A7QAK'
    };
    const result = await conn.sobject('Appointment__c').create(appointmentData);
    if (result.success) {
      res.json({ message: 'Appointment created', id: result.id });
    } else {
      res.status(500).json({ message: 'Failed to create appointment' });
    }
  } catch (error) {
    console.error('Error creating appointment:', error.message);
    res.status(500).json({ message: 'Failed to create appointment', error: error.message });
  }
});

// In the /api/chat route
app.post('/api/chat', optionalAuthenticate, async (req, res) => {
  try {
    const { query, customerType } = req.body;
    if (!query || !customerType) {
      return res.status(400).json({ message: 'Missing query or customerType' });
    }

    let conn;
    try {
      conn = getSalesforceConnection();
    } catch (error) {
      console.error('Error connecting to Salesforce:', error.message);
      return res.status(500).json({ message: 'Salesforce connection failed' });
    }

    if (!req.session.chatHistory) {
      req.session.chatHistory = [
        { 
          role: 'system', 
          content: 'You are a friendly, proactive bank appointment assistant. Use natural language to guide the user, suggest appointment details based on context, and ask for clarification only when needed. Return responses in JSON with "response" (natural language) and "appointmentDetails" (structured data).' 
        }
      ];
    }

    let contextData = '';
    let previousAppointments = [];
    let preferredBankerId = ''; // Store banker ID instead of name
    const isRegularCustomer = customerType === 'Regular' || customerType === 'customer';
    console.log('Customer type:', customerType, 'Is regular:', isRegularCustomer);

    if (isRegularCustomer) {
      const result = await conn.query(
        'SELECT Id, Reason_for_Visit__c, Appointment_Date__c, Appointment_Time__c, Location__c, Banker__c, CreatedDate ' +
        'FROM Appointment__c WHERE Contact__c = \'003dM000005H5A7QAK\' ORDER BY CreatedDate DESC'
      );
      previousAppointments = result.records;

      if (previousAppointments.length > 0) {
        contextData = 'Previous Appointments:\n' + previousAppointments.map((r, i) => {
          return `Appointment ${i + 1}:
Reason: ${r.Reason_for_Visit__c || 'Not specified'}
Date: ${r.Appointment_Date__c || 'Not specified'}
Time: ${r.Appointment_Time__c || 'Not specified'}
Location: ${r.Location__c || 'Not specified'}
Banker ID: ${r.Banker__c || 'Not specified'}`; // Display ID for clarity
        }).join('\n\n');

        const bankers = previousAppointments.map(r => r.Banker__c).filter(Boolean);
        if (bankers.length > 0) {
          // Get most frequent banker ID
          contextData += `\nPreferred Banker ID: a0AdM000002ZcsUUAS`;
          contextData += `\nPreferred Banker Name : George`;
        }

        const locations = previousAppointments.map(r => r.Location__c).filter(Boolean);
        if (locations.length > 0) {
          contextData += `\nPreferred Location use only : Brooklyn`;
        }
      }
    }
    if (!req.session) {
      return res.status(401).json({ message: 'Session not available, please refresh and try again' });
    }

    const { query, customerType } = req.body;
    if (!query || !customerType) {
      return res.status(400).json({ message: 'Missing query or customerType' });
    }

    req.session.chatHistory.push({ role: 'user', content: query });

    const prompt = `
You are a bank appointment booking assistant. Based on the user's query and context, suggest appointment details and respond naturally. Maintain conversational flow using the chat history.

Current Date: ${new Date().toISOString().split('T')[0]}
User Query: ${query}
User Type: ${customerType}
${contextData ? `Context Information:\n${contextData}` : 'No prior context available.'}

Extract or suggest:
- Reason_for_Visit__c
- Appointment_Date__c (YYYY-MM-DD)
- Appointment_Time__c (HH:MM AM/PM)
- Location__c ( Brooklyn, Manhattan, or New York)
- Banker__c (use the Preferred Banker ID from context if available, otherwise omit it unless specified)

Rules:
- If details are missing, suggest reasonable defaults (e.g., next business day, 9 AM–5 PM, preferred location/banker ID if available).
- Your suggestrions should be in a  suggestive language and it shouldnt be explicit, also ask for time or date  or reason if not provided done make it by yourself
- For Banker__c, only include it in appointmentDetails if it’s a valid Salesforce ID (e.g., starts with "005" for User records).
- Use prior appointments to infer preferences for Regular customers.
- Respond in natural language under "response" and provide structured data under "appointmentDetails".
- Return JSON like: {"response": "Here’s a suggestion...", "appointmentDetails": {...}}

Example:
{"response": "How about a loan consultation next Tuesday at 10:00 AM at Brooklyn with your preferred banker?", "appointmentDetails": {"Reason_for_Visit__c": "Loan Consultation", "Appointment_Time__c": " "2025-03-04, 13:00:00", "Location__c": "Brooklyn", "Banker__c": "005dM000000XyZaQAK"}}
`;

    req.session.chatHistory.push({ role: 'system', content: prompt });

    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: req.session.chatHistory,
      max_tokens: 500,
      temperature: 0.5,
    });

    const llmOutput = openaiResponse.choices[0].message.content.trim();
    req.session.chatHistory.push({ role: 'assistant', content: llmOutput });

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(llmOutput);
    } catch (error) {
      parsedResponse = JSON.parse(extractJSON(llmOutput));
    }

    const { response, appointmentDetails } = parsedResponse;
    let appointmentId = null;

    const requiredFields = ['Reason_for_Visit__c', 'Appointment_Date__c', 'Appointment_Time__c', 'Location__c'];
    const missingFields = requiredFields.filter(field => !appointmentDetails[field]);

    if (missingFields.length === 0) {
      const dateTime = combineDateTime(appointmentDetails.Appointment_Date__c, appointmentDetails.Appointment_Time__c);
      if (dateTime) {
        const fullAppointmentData = {
          ...appointmentDetails,
          Contact__c: '003dM000005H5A7QAK',
          Appointment_Time__c: dateTime
        };
        delete fullAppointmentData.Appointment_Date__c;
        delete fullAppointmentData.Appointment_Time__c;

        // Only include Banker__c if it’s a valid ID (e.g., starts with "005" for User)
        if (fullAppointmentData.Banker__c && !fullAppointmentData.Banker__c.match(/^005/)) {
          delete fullAppointmentData.Banker__c; // Remove if not a valid ID
        }

        const createResult = await conn.sobject('Appointment__c').create(fullAppointmentData);
        if (createResult.success) {
          appointmentId = createResult.id;
          appointmentDetails.Id = appointmentId;
        } else {
          console.error('Salesforce create failed:', createResult);
          throw new Error('Failed to create appointment in Salesforce');
        }
      }
    }

    res.json({
      response,
      appointmentDetails,
      missingFields,
      previousAppointments: previousAppointments.length > 0 ? previousAppointments : undefined
    });
  } catch (error) {
    console.error('Error processing chat request:', error.message);
    res.status(500).json({ message: 'Error processing chat request', error: error.message });
  }
});

// Optional: Add a route to fetch current chat state without a new query
app.get('/api/chat/state', optionalAuthenticate, (req, res) => {
  if (!req.session.chatHistory) {
    return res.json({ messages: [], appointmentDetails: null });
  }
  const lastAssistantMessage = req.session.chatHistory.find(msg => msg.role === 'assistant');
  const parsed = lastAssistantMessage ? JSON.parse(lastAssistantMessage.content) : { response: '', appointmentDetails: null };
  res.json({
    messages: req.session.chatHistory.filter(msg => msg.role !== 'system'),
    appointmentDetails: parsed.appointmentDetails || null
  });
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});