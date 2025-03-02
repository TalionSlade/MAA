// Enhanced chat API endpoint for appointment booking
app.post('/api/chat', optionalAuthenticate, async (req, res) => {
  try {
    const { query, customerType } = req.body;
    if (!query || !customerType) {
      return res.status(400).json({ message: 'Missing query or customerType' });
    }

    // Initialize connection to Salesforce
    let conn;
    try {
      conn = await getSalesforceConnection();
    } catch (error) {
      console.error('Error connecting to Salesforce:', error.message);
      return res.status(500).json({ message: 'Salesforce connection failed' });
    }

    // Prepare context based on user type
    let contextData = '';
    let previousAppointments = [];
    let availableSlots = [];

    // For logged-in users, get their appointment history
    if (customerType === 'Regular' && req.user && req.user.username !== 'guest') {
      try {
        // Get appointment history
        const result = await conn.query(
          'SELECT Id, Reason_for_Visit__c, Appointment_Date__c, Appointment_Time__c, Location__c, CreatedDate ' +
          'FROM Appointment__c ' +
          'WHERE Customer_Name__c = $1 ' +
          'ORDER BY CreatedDate DESC LIMIT 3',
          [req.user.username]
        );
        
        if (result.records.length > 0) {
          previousAppointments = result.records;
          
          // Format the most recent appointment for context
          const mostRecent = result.records[0];
          contextData = `Last Appointment Details:
Reason: ${mostRecent.Reason_for_Visit__c || 'Not specified'}
Date: ${mostRecent.Appointment_Date__c || 'Not specified'}
Time: ${mostRecent.Appointment_Time__c || 'Not specified'}
Location: ${mostRecent.Location__c || 'Not specified'}`;
          
          // Add preferred branch if available
          if (result.records.some(r => r.Location__c)) {
            const branches = result.records.map(r => r.Location__c).filter(Boolean);
            const preferredBranch = getMostFrequent(branches);
            if (preferredBranch) {
              contextData += `\nPreferred Branch: ${preferredBranch}`;
            }
          }
        }
        
        // Get available appointment slots
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 14); // Look 2 weeks ahead
        
        const availableSlotsResult = await conn.query(
          'SELECT Date__c, Time__c, Branch__c ' +
          'FROM Available_Slot__c ' +
          'WHERE Date__c >= TODAY AND Date__c <= NEXT_N_DAYS:14 ' +
          'AND Is_Available__c = true ' +
          'ORDER BY Date__c ASC, Time__c ASC LIMIT 10'
        );
        
        if (availableSlotsResult.records.length > 0) {
          availableSlots = availableSlotsResult.records;
          contextData += '\n\nAvailable slots:';
          availableSlotsResult.records.slice(0, 5).forEach(slot => {
            contextData += `\n- ${slot.Date__c} at ${slot.Time__c}, ${slot.Branch__c} branch`;
          });
        }
      } catch (error) {
        console.warn('Error fetching customer context data:', error.message);
        // Continue without context if there's an error - not critical
      }
    }

    // Get branch information for all users
    try {
      const branchesResult = await conn.query(
        'SELECT Name, Address__c, Services__c ' +
        'FROM Branch__c ' +
        'WHERE IsActive__c = true ' +
        'ORDER BY Name ASC'
      );
      
      if (branchesResult.records.length > 0) {
        contextData += '\n\nAvailable branches:';
        branchesResult.records.forEach(branch => {
          contextData += `\n- ${branch.Name}: ${branch.Address__c}`;
        });
      }
    } catch (error) {
      console.warn('Error fetching branch data:', error.message);
      // Continue without branch data if there's an error - not critical
    }

    // Prepare the LLM prompt with enhanced context
    const prompt = `
You are a virtual assistant for booking appointments at a bank. Your task is to extract appointment details from the user query and suggest the best options.

User Query: ${query}

User Type: ${customerType}
${customerType === 'Regular' ? 'The user is a returning customer.' : 'The user is a guest and has not provided login credentials.'}

${contextData ? `Context Information:\n${contextData}` : ''}

Based on the user query and context, extract or infer the following appointment details:
- Reason for the visit (Salesforce field: Reason_for_Visit__c)
- Appointment Date (Salesforce field: Appointment_Date__c) - use YYYY-MM-DD format
- Appointment Time (Salesforce field: Appointment_Time__c) - use HH:MM AM/PM format
- Location/Branch (Salesforce field: Location__c)
- Customer Type (Salesforce field: Customer_Type__c) - should be "${customerType}"

If ANY detail is missing or unclear, set it to null. DO NOT make up information that wasn't explicitly stated or implied by the user.

IMPORTANT: Return ONLY the JSON object with NO markdown formatting, NO code blocks, and NO backticks. Your entire response should be valid JSON that can be parsed directly.

Example of correct response format:
{"Reason_for_Visit__c": "Account Opening", "Appointment_Date__c": "2025-03-01", "Appointment_Time__c": "10:00 AM", "Location__c": "Downtown Branch", "Customer_Type__c": "Regular"}
`;

    // Call the LLM
    // Call the LLM
const openaiResponse = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful appointment booking assistant that returns ONLY valid JSON with no markdown or code formatting.' },
    { role: 'user', content: prompt },
  ],
  max_tokens: 500,
  temperature: 0.3, // Lower temperature for more deterministic extraction
});

const llmOutput = openaiResponse.choices[0].message.content.trim();

// Parse the LLM output and handle potential JSON parsing errors
let appointmentDetails;
try {
  // First try direct parsing
  appointmentDetails = JSON.parse(llmOutput);
} catch (error) {
  // If direct parsing fails, use extractJSON helper
  try {
    appointmentDetails = JSON.parse(extractJSON(llmOutput));
  } catch (innerError) {
    console.error('Error parsing LLM output as JSON:', innerError.message);
    console.log('Raw LLM output:', llmOutput);
    return res.status(500).json({ 
      message: 'Failed to process natural language input',
      error: 'Invalid response format' 
    });
  }
}

    const llmOutput = openaiResponse.choices[0].message.content.trim();
    
    // Parse the LLM output and handle potential JSON parsing errors
    let appointmentDetails;
    try {
      appointmentDetails = JSON.parse(extractJSON(llmOutput));
    } catch (error) {
      console.error('Error parsing LLM output as JSON:', error.message);
      console.log('Raw LLM output:', llmOutput);
      return res.status(500).json({ 
        message: 'Failed to process natural language input',
        error: 'Invalid response format' 
      });
    }

    // Validate the required fields
    const requiredFields = [
      'Reason_for_Visit__c',
      'Appointment_Date__c',
      'Appointment_Time__c',
      'Location__c',
      'Customer_Type__c',
    ];
    
    const missingFields = requiredFields.filter(field => !appointmentDetails[field]);

    // If all required fields are present, attempt to create the appointment
    let appointmentId = null;
    if (missingFields.length === 0) {
      try {
        // Check if the requested slot is available
        const isSlotAvailable = await checkAppointmentAvailability(
          conn,
          appointmentDetails.Appointment_Date__c,
          appointmentDetails.Appointment_Time__c,
          appointmentDetails.Location__c
        );

        if (isSlotAvailable) {
          // Create the appointment
          const fullAppointmentData = { 
            ...appointmentDetails, 
            Customer_Name__c: req.user ? req.user.username : 'guest_user' 
          };
          
          const createResult = await conn.sobject('Appointment__c').create(fullAppointmentData);
          
          if (createResult.success) {
            appointmentId = createResult.id;
            appointmentDetails.Id = appointmentId;
            
            // Update availability of the slot
            await updateSlotAvailability(
              conn,
              appointmentDetails.Appointment_Date__c,
              appointmentDetails.Appointment_Time__c,
              appointmentDetails.Location__c,
              false
            );
          }
        } else {
          // Slot not available, add to missing fields
          missingFields.push('slot_availability');
          // Suggest alternative times
          appointmentDetails.suggested_alternatives = await getSuggestedAlternatives(
            conn,
            appointmentDetails.Appointment_Date__c,
            appointmentDetails.Location__c
          );
        }
      } catch (error) {
        console.error('Error creating appointment:', error.message);
        return res.status(500).json({ 
          message: 'Failed to create appointment', 
          error: error.message 
        });
      }
    }

    // Return the appointment details, missing fields, and any other context
    res.json({
      appointmentDetails,
      missingFields,
      previousAppointments: previousAppointments.length > 0 ? previousAppointments : undefined,
      availableSlots: availableSlots.length > 0 ? availableSlots : undefined
    });
    
  } catch (error) {
    console.error('Error processing chat request:', error.message);
    res.status(500).json({ 
      message: 'Error processing chat request', 
      error: error.message 
    });
  }
});

// Helper Functions

// Extract JSON from a string (handles cases where the LLM might add text before/after the JSON)
// Enhanced JSON extraction function
function extractJSON(str) {
  // First attempt: Try to find JSON between code blocks
  const codeBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
  const codeBlockMatch = str.match(codeBlockRegex);
  
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      // Validate it's actual JSON
      JSON.parse(codeBlockMatch[1]);
      return codeBlockMatch[1];
    } catch (e) {
      // Not valid JSON, continue to other methods
    }
  }
  
  // Second attempt: Find anything that looks like a JSON object
  const jsonRegex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g;
  const matches = str.match(jsonRegex);
  
  if (matches) {
    // Try each match to find valid JSON
    for (const match of matches) {
      try {
        // Validate it's actual JSON
        JSON.parse(match);
        return match;
      } catch (e) {
        // Continue to next match
      }
    }
  }
  
  // If we can't find valid JSON, return empty object
  return '{}';
}

// Get most frequent item in an array
function getMostFrequent(arr) {
  if (!arr.length) return null;
  const counts = arr.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

// Check if an appointment slot is available
async function checkAppointmentAvailability(conn, date, time, location) {
  try {
    // First check if the slot exists in Available_Slot__c
    const slotResult = await conn.query(
      'SELECT Id, Is_Available__c FROM Available_Slot__c ' +
      'WHERE Date__c = $1 AND Time__c = $2 AND Branch__c = $3',
      [date, time, location]
    );
    
    // If slot exists, check if it's available
    if (slotResult.records.length > 0) {
      return slotResult.records[0].Is_Available__c;
    }
    
    // If slot doesn't exist, check if there's an existing appointment
    const apptResult = await conn.query(
      'SELECT Id FROM Appointment__c ' +
      'WHERE Appointment_Date__c = $1 AND Appointment_Time__c = $2 AND Location__c = $3',
      [date, time, location]
    );
    
    // If no appointments exist for this slot, it's available
    return apptResult.records.length === 0;
  } catch (error) {
    console.error('Error checking appointment availability:', error.message);
    // Default to available if there's an error checking
    return true;
  }
}

// Update the availability of a slot
async function updateSlotAvailability(conn, date, time, location, isAvailable) {
  try {
    // Check if slot exists
    const slotResult = await conn.query(
      'SELECT Id FROM Available_Slot__c ' +
      'WHERE Date__c = $1 AND Time__c = $2 AND Branch__c = $3',
      [date, time, location]
    );
    
    if (slotResult.records.length > 0) {
      // Update existing slot
      await conn.sobject('Available_Slot__c').update({
        Id: slotResult.records[0].Id,
        Is_Available__c: isAvailable
      });
    } else {
      // Create new slot
      await conn.sobject('Available_Slot__c').create({
        Date__c: date,
        Time__c: time,
        Branch__c: location,
        Is_Available__c: isAvailable
      });
    }
    return true;
  } catch (error) {
    console.error('Error updating slot availability:', error.message);
    return false;
  }
}

// Get suggested alternative slots
async function getSuggestedAlternatives(conn, date, location) {
  try {
    const queryDate = new Date(date);
    const startDate = new Date(queryDate);
    startDate.setDate(startDate.getDate() - 1);
    
    const endDate = new Date(queryDate);
    endDate.setDate(endDate.getDate() + 3);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Find available slots around the requested date
    const slotsResult = await conn.query(
      'SELECT Date__c, Time__c, Branch__c FROM Available_Slot__c ' +
      'WHERE Date__c >= $1 AND Date__c <= $2 ' +
      'AND Branch__c = $3 ' +
      'AND Is_Available__c = true ' +
      'ORDER BY Date__c ASC, Time__c ASC LIMIT 5',
      [startDateStr, endDateStr, location]
    );
    
    if (slotsResult.records.length > 0) {
      return slotsResult.records;
    }
    
    // If no slots found at the same branch, check other branches
    const otherBranchResult = await conn.query(
      'SELECT Date__c, Time__c, Branch__c FROM Available_Slot__c ' +
      'WHERE Date__c >= $1 AND Date__c <= $2 ' +
      'AND Is_Available__c = true ' +
      'ORDER BY Date__c ASC, Time__c ASC LIMIT 5',
      [startDateStr, endDateStr]
    );
    
    return otherBranchResult.records;
  } catch (error) {
    console.error('Error getting suggested alternatives:', error.message);
    return [];
  }
}