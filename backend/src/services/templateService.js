const mammoth = require('mammoth');

/**
 * Parse DOCX file to HTML
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} HTML content
 */
const parseDocxToHtml = async (buffer) => {
    try {
        const result = await mammoth.convertToHtml({ buffer });
        return result.value;
    } catch (error) {
        throw new Error(`Failed to parse DOCX: ${error.message}`);
    }
};

/**
 * Extract text from DOCX file
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} Plain text content
 */
const parseDocxToText = async (buffer) => {
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } catch (error) {
        throw new Error(`Failed to extract text: ${error.message}`);
    }
};

module.exports = {
    parseDocxToHtml,
    parseDocxToText
};
