const axios = require('axios');

const THREAT_API_URL = process.env.THREAT_API_URL || 'http://localhost:8001';
const REQUEST_TIMEOUT_MS = Number(process.env.THREAT_API_TIMEOUT_MS || 30000);

const analyzeText = async ({ text, context_text, custom_keywords }) => {
  const payload = {
    text,
    context_text,
    custom_keywords: custom_keywords || []
  };

  try {
    const response = await axios.post(`${THREAT_API_URL}/analyze`, payload, {
      timeout: REQUEST_TIMEOUT_MS
    });
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`[ThreatAPI] Cannot connect to Python API at ${THREAT_API_URL}. Make sure the threat detection service is running.`);
    }
    throw error;
  }
};

module.exports = {
  analyzeText
};
