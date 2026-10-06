const Settings = require('../models/Settings');
const threatApiService = require('../services/threatApiService');

// @desc    Analyze text for threats using the Python AI model
// @route   POST /api/threat/analyze
// @access  Private (Analyts/Admins)
const analyzeText = async (req, res) => {
  try {
    const { text, context_text } = req.body;

    if (!text) {
      return res.status(400).json({ message: 'Text is required for analysis' });
    }

    // 1. Fetch Global Custom Keywords from Settings
    const settings = await Settings.findOne({ id: 'global_settings' });
    let customKeywords = [];
    if (settings && settings.threat_keywords) {
        customKeywords = settings.threat_keywords;
    }

    // 2. Call the Python Service
    const aiResponse = await threatApiService.analyzeText({
      text,
      context_text,
      custom_keywords: customKeywords,
    });

    // 3. Return the result
    return res.status(200).json(aiResponse);

  } catch (error) {
    console.error('Threat Analysis Error:', error);
    // Handle case where Python service is down
    if (error.code === 'ECONNREFUSED') {
       return res.status(503).json({ 
         message: 'Threat Analysis Service is currently unavailable.',
         error: 'Service unreachable' 
       });
    }
    return res.status(500).json({ 
        message: 'Failed to analyze text',
        error: error.message 
    });
  }
};

module.exports = {
  analyzeText
};
