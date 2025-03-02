const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Salesforce Connected App credentials
const CLIENT_ID = '3MVG9WVXk15qiz1JB2qh2TNaYkexLOxuBu.JlZB8L9NYNJJdyZ7kUJLibukywGoaNK_qO1uc7CUxptlZfwxjD';
const USERNAME = 'sudarssan73@wise-hawk-hdi2dp.com';
const LOGIN_URL = 'https://login.salesforce.com';
const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf8');

function generateJWT() {
  const payload = {
    iss: CLIENT_ID,
    sub: USERNAME,
    aud: LOGIN_URL,
    exp: Math.floor(Date.now() / 1000) + 60 * 3, // 3 minutes expiration
    iat: Math.floor(Date.now() / 1000) // Issued now
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'RS256' });
}

// Get Salesforce access token
async function getAccessToken() {
  const jwtToken = generateJWT();
  try {
    const response = await axios.post(`${LOGIN_URL}/services/oauth2/token`, null, {
      params: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtToken
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error.response.data);
    throw error;
  }
}

async function fetchUsers(accessToken, instanceUrl) {
  try {
    const response = await axios.get(`${instanceUrl}/services/data/v59.0/query/?q=SELECT+Id,Name,Email+FROM+User+LIMIT+5`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    console.log('User Records:', response.data.records);
  } catch (error) {
    console.error('Error fetching Users:', error.response ? error.response.data : error.message);
  }
}

app.get('/data', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    console.log('Access Token:', accessToken);
    await fetchUsers(accessToken, 'https://wise-hawk-hdi2dp-dev-ed.trailblaze.my.salesforce.com');
    res.send('Data fetched successfully');
  } catch (error) {
    res.status(500).send('Error fetching data from Salesforce');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});