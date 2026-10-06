const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE_PATH = path.join(__dirname, '../../../backend_ml/data/feedback_samples.jsonl');

/**
 * Maps UI status to ML Risk Label.
 * 
 * False Positive Logic (context-aware):
 *   - If system scored LOW but user says FP → system MISSED a threat → train as HIGH
 *   - If system scored HIGH/MEDIUM but user says FP → system OVER-detected → train as LOW
 */
const mapStatusToRisk = (status, currentRisk) => {
    if (status === 'false_positive') {
        const risk = (currentRisk || '').toUpperCase();
        if (risk === 'LOW') {
            // System said safe, but analyst flagged it → it's actually dangerous
            return 'HIGH';
        }
        // System said risky (HIGH/MEDIUM), but analyst says it's safe
        return 'LOW';
    }
    if (status === 'escalated') return 'HIGH';
    if (status === 'acknowledged') {
        const risk = (currentRisk || '').toUpperCase();
        return (risk === 'HIGH' || risk === 'MEDIUM') ? risk : 'MEDIUM';
    }
    return null;
};

const axios = require('axios');

/**
 * Records feedback from the UI by sending it to the remote ML server.
 * 
 * @param {Object} feedbackData - { text, category, legal_sections, review_status, current_risk }
 */
const recordFeedback = async ({ text, category, legal_sections, review_status, current_risk }) => {
    try {
        if (!text || !review_status) return;

        const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8006';
        
        console.log(`[FeedbackService] Sending feedback to server: ${mlServiceUrl}/record-feedback`);

        const response = await axios.post(`${mlServiceUrl}/record-feedback`, {
            text,
            category,
            legal_sections: (legal_sections || []).map(l => l.section || l),
            review_status,
            current_risk
        });

        if (response.data.status === 'success') {
            console.log(`[FeedbackService] Server accepted feedback: ${response.data.message}`);
            if (response.data.retraining_triggered) {
                console.log('[FeedbackService] Retraining threshold reached on server!');
            }
        }

    } catch (error) {
        console.error('[FeedbackService] Error sending feedback to server:', error.response?.data || error.message);
    }
};

module.exports = { recordFeedback };
