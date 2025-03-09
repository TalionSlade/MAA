const express = require('express');
const jsforce = require('jsforce');
const { OpenAI } = require('openai');
require('dotenv').config();
const cors = require('cors');
const session = require('express-session');

const app = express();
app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 3600000
  }
}));

const STATIC_USERNAME = process.env.STATIC_USERNAME || 'Jack Rogers';
const STATIC_PASSWORD = process.env.STATIC_PASSWORD || 'password123';
const SALESFORCE_ACCESS_TOKEN = process.env.SALESFORCE_ACCESS_TOKEN;
const SALESFORCE_INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL;
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const getSalesforceConnection = () => {
  console.log('Attempting to establish Salesforce connection');
  if (!SALESFORCE_ACCESS_TOKEN || !SALESFORCE_INSTANCE_URL) {
    console.error('Salesforce credentials missing in environment');
    throw new Error('Salesforce credentials not configured in environment');
  }
  const conn = new jsforce.Connection({
    instanceUrl: SALESFORCE_INSTANCE_URL,
    accessToken: SALESFORCE_ACCESS_TOKEN,
  });
  console.log('Salesforce connection established successfully');
  return conn;
};

// Helper function to format ISO 8601 date/time into a readable format
function formatDateTimeForDisplay(isoDateTime) {
  console.log('Formatting date/time for display:', isoDateTime);
  if (!isoDateTime) return 'Not specified';

  const date = new Date(isoDateTime);
  const options = {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };
  let formatted = date.toLocaleString('en-US', options);
  formatted = formatted.replace(/(\d+),/, '$1th,');
  console.log('Formatted date/time:', formatted);
  return formatted;
}

function extractJSON(str) {
  console.log('Extracting JSON from string:', str);
  const codeBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
  const codeBlockMatch = str.match(codeBlockRegex);
  
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      console.log('Successfully parsed JSON from code block:', parsed);
      return codeBlockMatch[1];
    } catch (e) {
      console.error('Error parsing JSON from code block:', e.message);
    }
  }
  
  const jsonRegex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g;
  const matches = str.match(jsonRegex);
  
  if (matches) {
    for (const match of matches) {
      try {
        const parsed = JSON.parse(match);
        console.log('Successfully parsed JSON from regex match:', parsed);
        return match;
      } catch (e) {
        console.error('Error parsing JSON from regex match:', e.message);
      }
    }
  }
  
  console.log('No valid JSON found, returning empty object');
  return '{}';
}

function initGuidedFlowSession(req) {
  if (!req.session.guidedFlow) {
    req.session.guidedFlow = {
      reason: null,
      date: null,
      time: null,
      location: null
    };
  }
}

function getMostFrequent(arr) {
  console.log('Calculating most frequent value in array:', arr);
  if (!arr.length) {
    console.log('Array is empty, returning null');
    return null;
  }
  const counts = arr.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  const result = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  console.log('Most frequent value:', result);
  return result;
}

function convertTo24HourTime(timeStr) {
  console.log('Converting time to 24-hour format:', timeStr);
  if (!timeStr) {
    console.log('No time string provided, returning null');
    return null;
  }

  const isoRegex = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d{3}Z$/;
  const isoMatch = timeStr.match(isoRegex);
  if (isoMatch) {
    console.log('Time is already in ISO 8601 format, returning:', isoMatch[1]);
    return isoMatch[1];
  }

  const trimmedTimeStr = timeStr.trim();
  const timeRegex = /^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i;
  const match = trimmedTimeStr.match(timeRegex);

  if (!match) {
    console.log('Invalid time format, expected HH:MM AM/PM or HH:MM:', trimmedTimeStr);
    return null;
  }

  let [_, hours, minutes, modifier] = match;
  hours = parseInt(hours, 10);
  minutes = minutes ? parseInt(minutes, 10) : 0;

  if (hours > 23 || hours < 0 || minutes > 59 || minutes < 0) {
    console.log('Time out of range:', { hours, minutes });
    return null;
  }

  if (modifier) {
    modifier = modifier.toUpperCase();
    if (modifier === 'PM' && hours !== 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
  }

  const result = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
  console.log('Converted to 24-hour format:', result);
  return result;
}

function combineDateTime(dateStr, timeStr) {
  console.log('Combining date and time:', { dateStr, timeStr });
  if (!dateStr || !timeStr) {
    console.log('Missing date or time, returning null');
    return null;
  }

  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (isoRegex.test(timeStr)) {
    console.log('Time is already in ISO 8601 format, returning:', timeStr);
    return timeStr;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    console.log('Invalid date format, expected YYYY-MM-DD:', dateStr);
    return null;
  }

  const time24 = convertTo24HourTime(timeStr);
  if (!time24) {
    console.log('Invalid time format, returning null');
    return null;
  }

  const result = `${dateStr}T${time24}.000Z`;
  console.log('Combined DateTime:', result);
  return result;
}

function parseDateTimeString(dateTimeStr) {
  console.log('Parsing date/time string:', dateTimeStr);
  if (!dateTimeStr) return { date: null, time: null };

  // Example format: "October 27, 2023, 09:30 AM"
  const parts = dateTimeStr.match(/(\w+ \d{1,2}, \d{4}), (\d{1,2}:\d{2} [AP]M)/i);
  if (!parts) {
    console.log('Invalid date/time format:', dateTimeStr);
    return { date: null, time: null };
  }

  const [, datePart, timePart] = parts;

  // Parse the date part (e.g., "October 27, 2023") into YYYY-MM-DD
  const dateObj = new Date(datePart);
  if (isNaN(dateObj.getTime())) {
    console.log('Invalid date part:', datePart);
    return { date: null, time: null };
  }

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  return { date: dateStr, time: timePart };
}

const authenticate = (req, res, next) => {
  console.log('Authenticating request, session user:', req.session.user);
  if (!req.session.user || req.session.user.username !== STATIC_USERNAME) {
    console.log('Authentication failed: Unauthorized');
    return res.status(401).json({ message: 'Unauthorized: Please log in as Jack Rogers' });
  }
  console.log('Authentication successful');
  next();
};

const optionalAuthenticate = (req, res, next) => {
  console.log('Optional authentication, session user:', req.session.user);
  if (!req.session.user) {
    req.user = { username: 'guest' };
    console.log('No session user, setting as guest');
  } else {
    req.user = req.session.user;
    console.log('Using session user:', req.user);
  }
  next();
};

app.post('/api/auth/login', (req, res) => {
  console.log('Login request received:', req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log('Missing username or password');
    return res.status(400).json({ message: 'Missing username or password' });
  }
  if (username !== STATIC_USERNAME || password !== STATIC_PASSWORD) {
    console.log('Invalid credentials');
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  req.session.user = { username };
  console.log('User logged in, session updated:', req.session.user);
  res.json({ message: 'Login successful', username });
});

app.get('/api/session-health', (req, res) => {
  console.log('Checking session health');
  if (req.session && req.session.id) {
    console.log('Session is healthy:', req.session.id);
    res.status(200).json({ status: 'healthy' });
  } else {
    console.log('Session is unhealthy or expired');
    res.status(401).json({ status: 'unhealthy', error: 'SESSION_EXPIRED' });
  }
});

app.get('/api/auth/check-session', (req, res) => {
  console.log('Checking session status');
  if (req.session.user && req.session.user.username === STATIC_USERNAME) {
    console.log('Session active for user:', req.session.user.username);
    res.json({ username: req.session.user.username });
  } else {
    console.log('No active session found');
    res.status(401).json({ message: 'Not logged in' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  console.log('Logout request received');
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ message: 'Failed to log out' });
    }
    console.log('Session destroyed, clearing cookie');
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/salesforce/appointments', authenticate, async (req, res) => {
  console.log('Fetching Salesforce appointments for Contact__c: 003dM000005H5A7QAK');
  try {
    const conn = getSalesforceConnection();
    const query = 'SELECT Id, Reason_for_Visit__c, Appointment_Date__c, Appointment_Time__c, Location__c ' +
                  'FROM Appointment__c WHERE Contact__c = \'003dM000005H5A7QAK\'';
    console.log('Executing Salesforce query:', query);
    const result = await conn.query(query);
    console.log('Salesforce data retrieved:', JSON.stringify(result.records, null, 2));
    res.json(result.records);
  } catch (error) {
    console.error('Error fetching appointments:', error.message);
    res.status(500).json({ message: 'Failed to fetch appointments', error: error.message });
  }
});

app.post('/api/salesforce/appointments', authenticate, async (req, res) => {
  console.log('Received request to create appointment:', JSON.stringify(req.body, null, 2));
  try {
    const conn = getSalesforceConnection();
    const appointmentData = {
      ...req.body,
      Contact__c: '003dM000005H5A7QAK'
    };
    console.log('Salesforce appointment data to create:', JSON.stringify(appointmentData, null, 2));
    const result = await conn.sobject('Appointment__c').create(appointmentData);
    if (result.success) {
      console.log('Appointment created successfully with ID:', result.id);
      res.json({ message: 'Appointment created', id: result.id });
    } else {
      console.error('Failed to create appointment:', result);
      res.status(500).json({ message: 'Failed to create appointment' });
    }
  } catch (error) {
    console.error('Error creating appointment:', error.message);
    res.status(500).json({ message: 'Failed to create appointment', error: error.message });
  }
});

app.post('/api/guidedFlow', async (req, res) => {
  try {
    const { query, customerType, guidedStep } = req.body;
    if (!query || !customerType || !guidedStep) {
      return res.status(400).json({ message: 'Missing query, customerType, or guidedStep' });
    }

    if (!req.session) {
      return res.status(401).json({ message: 'Session expired or invalid', error: 'SESSION_EXPIRED' });
    }

    // Initialize the guided flow data if not present
    initGuidedFlowSession(req);

    // We'll store the partial data in session so we can finalize at the "confirmation" step
    const flowData = req.session.guidedFlow;  // { reason, date, time, location }

    // We'll build a specialized system prompt based on the guidedStep
    let systemInstructions = '';
    switch (guidedStep) {
      case 'reasonSelection':
        // LLM can propose times based on the reason
        flowData.reason = query;  // store the reason in session
        systemInstructions = `
User selected a reason: ${flowData.reason}.
Please suggest 3 possible appointment date/time slots in ISO 8601 format (e.g., "2025-03-10T16:00:00.000Z").
Return them under "timeSlots" array in JSON.
Include a "response" that politely offers those slots, plus an "alternateDatesOption" if you wish.
        `;
        break;

      case 'timeSelection':
        // The user presumably picks from the LLM-suggested times
        flowData.time = query;  // store the chosen time in session (should be in ISO 8601 format)
        systemInstructions = `
User selected the time slot: ${flowData.time}.
Now we must gather the location. Provide 3 location options in "locationOptions": ["Brooklyn","Manhattan","New York"].
Return them in a JSON array. Also provide a "response" to ask the user to choose a location.
        `;
        break;

      case 'locationSelection':
        // The user picks a location
        flowData.location = query;  // store the chosen location in session
        systemInstructions = `
User selected location: ${flowData.location}.
Now we have reason = ${flowData.reason}, time = ${flowData.time}, location = ${flowData.location}.
Return a "response" summarizing these choices and ask for confirmation. 
Include something like "Please confirm your appointment."
        `;
        break;

      case 'confirmation':
        // The user confirms the final details. Now we create the appointment in Salesforce.
        systemInstructions = `
The user confirmed the appointment with reason = ${flowData.reason}, time = ${flowData.time}, location = ${flowData.location}.
Return a short "response" that the appointment is being booked. 
        `;
        break;

      default:
        systemInstructions = 'No recognized guided step.';
        break;
    }

    // Add system prompt
    if (!req.session.chatHistory) {
      req.session.chatHistory = [];
    }
    req.session.chatHistory.push({ role: 'system', content: systemInstructions });
    req.session.chatHistory.push({ role: 'user', content: query });

    // Call OpenAI with your messages
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: req.session.chatHistory,
      max_tokens: 500,
      temperature: 0.7,
    });

    const llmOutput = openaiResponse.choices[0].message.content.trim();
    req.session.chatHistory.push({ role: 'assistant', content: llmOutput });
    req.session.save(() => {});

    // Attempt to parse the LLM JSON
    let parsed;
    try {
      parsed = JSON.parse(llmOutput);
    } catch (err) {
      parsed = JSON.parse(extractJSON(llmOutput));
    }

    // Format timeSlots for display
    let formattedTimeSlots = [];
    if (parsed.timeSlots && Array.isArray(parsed.timeSlots)) {
      formattedTimeSlots = parsed.timeSlots.map(slot => ({
        display: formatDateTimeForDisplay(slot),
        raw: slot
      }));
    }

    // If we're at confirmation, create the record in Salesforce
    let appointmentDetails = null;
    if (guidedStep === 'confirmation') {
      try {
        // Since flowData.time is already in ISO 8601 format (e.g., "2023-10-27T16:00:00.000Z")
        const dateTime = flowData.time;
        if (!dateTime) {
          console.error('Missing date/time in confirmation step');
          throw new Error('Invalid date/time format');
        }

        // Create the record in SF
        const conn = getSalesforceConnection();
        const newAppointment = {
          Reason_for_Visit__c: flowData.reason,
          Appointment_Time__c: dateTime,
          Location__c: flowData.location,
          Contact__c: '003dM000005H5A7QAK'
        };
        const result = await conn.sobject('Appointment__c').create(newAppointment);

        if (result.success) {
          appointmentDetails = {
            Id: result.id,
            Reason_for_Visit__c: flowData.reason,
            Appointment_Time__c: dateTime,
            Location__c: flowData.location
          };
        } else {
          console.error('SF creation failed:', result);
          throw new Error('Failed to create appointment in Salesforce');
        }

        // Clear the session data
        req.session.guidedFlow = { reason: null, date: null, time: null, location: null };
      } catch (error) {
        console.error('Error creating appointment in SF:', error);
        return res.status(500).json({ message: 'Failed to create appointment', error: error.message });
      }
    }

    // Return the LLM's response plus any additional data
    const responsePayload = {
      response: parsed.response || '...',
      appointmentDetails: appointmentDetails || parsed.appointmentDetails || null,
      timeSlots: formattedTimeSlots,
      locationOptions: parsed.locationOptions || [],
      alternateDatesOption: parsed.alternateDatesOption || null
    };

    return res.json(responsePayload);

  } catch (error) {
    console.error('Error in /api/guidedFlow:', error);
    return res.status(500).json({ message: 'Error in guidedFlow', error: error.message });
  }
});

app.post('/api/chat', optionalAuthenticate, async (req, res) => {
  console.log('Received chat request:', JSON.stringify(req.body, null, 2));
  try {
    const { query, customerType } = req.body;
    if (!query || !customerType) {
      console.log('Missing query or customerType');
      return res.status(400).json({ message: 'Missing query or customerType' });
    }

    if (!req.session) {
      console.error('No session object found');
      return res.status(401).json({ message: 'Session expired or invalid', error: 'SESSION_EXPIRED', recovery: true });
    }

    if (!req.session.chatHistory) {
      req.session.chatHistory = [
        { 
          role: 'system', 
          content: 'You are a friendly, proactive bank appointment assistant. Use natural language to guide the user, suggest appointment details based on context, and ask for clarification only when needed. Return responses in JSON with "response" (natural language) and "appointmentDetails" (structured data).' 
        }
      ];
      console.log('Initialized chat history:', JSON.stringify(req.session.chatHistory, null, 2));
    }

    // Predefined response for "Find me a branch within 5 miles with 24hrs Drive-thru ATM service" as a future capability
    const branchQuery = "Find me a branch within 5 miles with 24hrs Drive-thru ATM service";
    if (query.toLowerCase().includes(branchQuery.toLowerCase())) {
      console.log('Detected predefined branch query');
      const predefinedResponse = {
        response: "I found a branch that meets your criteria. It's located at 123 Main St, Brooklyn, NY 11201. If you would like to Naviage there here is the link: https://goo.gl/maps/12345",
        appointmentDetails: null,
        missingFields: []
      };
      req.session.chatHistory.push({ role: 'user', content: query });
      req.session.chatHistory.push({ role: 'assistant', content: JSON.stringify(predefinedResponse) });
      console.log('Updated chat history with predefined response:', JSON.stringify(req.session.chatHistory, null, 2));
      req.session.save((err) => {
        if (err) console.error('Error saving session:', err);
        else console.log('Session saved successfully');
      });
      return res.json(predefinedResponse);
    }

    let conn;
    try {
      conn = getSalesforceConnection();
    } catch (error) {
      console.error('Error connecting to Salesforce:', error.message);
      return res.status(500).json({ message: 'Salesforce connection failed' });
    }

    let contextData = '';
    let previousAppointments = [];
    const isRegularCustomer = customerType === 'Regular' || customerType === 'customer';
    console.log('Customer type:', customerType, 'Is regular:', isRegularCustomer);

    if (isRegularCustomer) {
      const query = 'SELECT Id, Reason_for_Visit__c, Appointment_Date__c, Appointment_Time__c, Location__c, Banker__c, CreatedDate ' +
                    'FROM Appointment__c WHERE Contact__c = \'003dM000005H5A7QAK\' ORDER BY CreatedDate DESC';
      console.log('Executing Salesforce query for previous appointments:', query);
      const result = await conn.query(query);
      previousAppointments = result.records;
      console.log('Retrieved previous appointments:', JSON.stringify(previousAppointments, null, 2));

      if (previousAppointments.length > 0) {
        contextData = 'Previous Appointments:\n' + previousAppointments.map((r, i) => {
          return `Appointment ${i + 1}:
Reason: ${r.Reason_for_Visit__c || 'Not specified'}
Date: ${r.Appointment_Date__c || 'Not specified'}
Time: ${r.Appointment_Time__c || 'Not specified'}
Location: ${r.Location__c || 'Not specified'}
Banker ID: ${r.Banker__c || 'Not specified'}`;
        }).join('\n\n');

        const bankers = previousAppointments.map(r => r.Banker__c).filter(Boolean);
        if (bankers.length > 0) {
          contextData += `\nPreferred Banker ID: a0AdM000002ZcsUUAS`;
          contextData += `\nPreferred Banker Name: George`;
        }

        const locations = previousAppointments.map(r => r.Location__c).filter(Boolean);
        if (locations.length > 0) {
          contextData += `\nPreferred Location use only: Brooklyn`;
        }
        console.log('Generated context data:', contextData);
      }
    }

    req.session.chatHistory.push({ role: 'user', content: query });
    console.log('Added user query to chat history:', JSON.stringify(req.session.chatHistory, null, 2));

    const prompt = `
You are a bank appointment booking assistant. Based on the user's query and context, suggest appointment details and respond naturally. Maintain conversational flow using the chat history.

Current Date: ${new Date().toISOString().split('T')[0]}
User Query: ${query}
User Type: ${customerType}
${contextData ? `Context Information:\n${contextData}` : 'No prior context available.'}

Extract or suggest:
- Reason_for_Visit__c (Ask customer if not mentioned, suggest from the previous bookings if available)
- Appointment_Date__c (YYYY-MM-DD)
- Appointment_Time__c (HH:MM AM/PM)
- Location__c (Brooklyn, Manhattan, or New York)
- Banker__c (use the Preferred Banker ID from context if available, otherwise omit it unless specified)

Rules:
- If details are missing, suggest reasonable defaults (e.g., next business day, 9 AM–5 PM, preferred location/banker ID if available), but do not assume a purpose unless the user specifies it.
- Reason_for_Visit__c should be inferred from the user's query and if not provided, ask the user for the reason.
- Your suggestions should be in a suggestive language and not overly explicit; also ask for time, date, or reason if not provided.
- For Banker__c, only include it in appointmentDetails if it's a valid Salesforce ID (e.g., starts with "005" for User records).
- Use prior appointments to infer preferences for Regular customers.
- Respond in natural language under "response" and provide structured data under "appointmentDetails".
- Return JSON like: {"response": "Here's a suggestion...", "appointmentDetails": {...}}

Additional Slot Availability Check:
- Before finalizing the appointment details, check if the suggested appointment slot (combination of Appointment_Date__c and Appointment_Time__c) is already booked in the previous appointments.
- If the slot is not available, indicate that the slot is taken and suggest alternative times or ask the user for a different preferred time, rather than proceeding to create a duplicate appointment.
`;
    console.log('Generated prompt for OpenAI:', prompt);

    const systemPrompt = { role: 'system', content: prompt };
    const tempMessages = [...req.session.chatHistory, systemPrompt];
    console.log('Messages sent to OpenAI:', JSON.stringify(tempMessages, null, 2));

    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: tempMessages,
      max_tokens: 500,
      temperature: 0.5,
    });
    const llmOutput = openaiResponse.choices[0].message.content.trim();
    console.log('Received response from OpenAI:', llmOutput);

    req.session.chatHistory.push({ role: 'assistant', content: llmOutput });
    console.log('Updated chat history with assistant response:', JSON.stringify(req.session.chatHistory, null, 2));
    
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
      } else {
        console.log('Session saved successfully');
      }
    });

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(llmOutput);
      console.log('Parsed OpenAI response successfully:', parsedResponse);
    } catch (error) {
      console.error('Failed to parse OpenAI response as JSON:', error.message);
      parsedResponse = JSON.parse(extractJSON(llmOutput));
      console.log('Extracted and parsed JSON from OpenAI response:', parsedResponse);
    }

    const { response, appointmentDetails } = parsedResponse;
    let appointmentId = null;

    const requiredFields = ['Reason_for_Visit__c', 'Appointment_Date__c', 'Appointment_Time__c', 'Location__c'];
    const missingFields = requiredFields.filter(field => !appointmentDetails[field]);
    console.log('Missing fields in appointment details:', missingFields);

    if (missingFields.length === 0) {
      const dateTime = combineDateTime(appointmentDetails.Appointment_Date__c, appointmentDetails.Appointment_Time__c);
      if (!dateTime) {
        console.error('Invalid dateTime format, cannot create appointment');
        return res.status(400).json({ 
          message: 'Unable to create appointment due to invalid date or time format',
          error: 'INVALID_DATETIME'
        });
      }
    
      const fullAppointmentData = {
        Reason_for_Visit__c: appointmentDetails.Reason_for_Visit__c,
        Appointment_Time__c: dateTime,
        Location__c: appointmentDetails.Location__c,
        Contact__c: '003dM000005H5A7QAK',
        ...(appointmentDetails.Banker__c && appointmentDetails.Banker__c.match(/^005/) && { Banker__c: appointmentDetails.Banker__c }),
      };
    
      console.log('Creating appointment in Salesforce with data:', JSON.stringify(fullAppointmentData, null, 2));
      const createResult = await conn.sobject('Appointment__c').create(fullAppointmentData);
      if (createResult.success) {
        appointmentId = createResult.id;
        appointmentDetails.Id = appointmentId;
        appointmentDetails.Appointment_Time__c = dateTime;
        console.log('Appointment created in Salesforce with ID:', appointmentId);
      } else {
        console.error('Failed to create appointment in Salesforce:', createResult);
        throw new Error('Failed to create appointment in Salesforce: ' + JSON.stringify(createResult.errors));
      }
    }

    const responseData = {
      response,
      appointmentDetails,
      missingFields,
      previousAppointments: previousAppointments.length > 0 ? previousAppointments : undefined
    };
    console.log('Sending response to client:', JSON.stringify(responseData, null, 2));
    res.json(responseData);
  } catch (error) {
    console.error('Error processing chat request:', error.message);
    const isSessionError = error.message && (
      error.message.includes('session') || 
      error.message.includes('Session')
    );
    if (isSessionError) {
      console.log('Session-related error detected');
      return res.status(401).json({ 
        message: 'Session expired or invalid', 
        error: 'SESSION_EXPIRED',
        recovery: true
      });
    }
    res.status(500).json({ 
      message: 'Error processing chat request', 
      error: error.message 
    });
  }
});

app.get('/api/chat/state', optionalAuthenticate, (req, res) => {
  console.log('Fetching current chat state');
  if (!req.session.chatHistory) {
    console.log('No chat history available');
    return res.json({ messages: [], appointmentDetails: null });
  }
  const lastAssistantMessage = req.session.chatHistory.find(msg => msg.role === 'assistant');
  const parsed = lastAssistantMessage ? JSON.parse(lastAssistantMessage.content) : { response: '', appointmentDetails: null };
  const responseData = {
    messages: req.session.chatHistory.filter(msg => msg.role !== 'system'),
    appointmentDetails: parsed.appointmentDetails || null
  };
  console.log('Sending chat state to client:', JSON.stringify(responseData, null, 2));
  res.json(responseData);
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});