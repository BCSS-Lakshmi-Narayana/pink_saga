/**
 * periscopeS3Service.js
 * ---------------------
 * Handles uploading Periscope DOCX files to S3 and generating
 * pre-signed download URLs so users can retrieve the original document.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ─── S3 Client (same credentials as other services) ──────────────────────
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'eu-north-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET = process.env.AWS_BUCKET_NAME;
const PERISCOPE_FOLDER = 'periscope-documents';

/**
 * Upload a DOCX buffer to S3.
 * Key format: periscope-documents/2026-02-07/Periscope_for_the_day_07.02.2026.docx
 *
 * @param {Buffer} buffer - File buffer
 * @param {string} dateStr - Date string YYYY-MM-DD
 * @param {string} originalFilename - Original file name
 * @returns {{ url: string, key: string }}
 */
const uploadPeriscopeToS3 = async (buffer, dateStr, originalFilename) => {
    // Sanitize filename for S3 key
    const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${PERISCOPE_FOLDER}/${dateStr}/${safeName}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ContentDisposition: `attachment; filename="${originalFilename}"`,
    }));

    const url = `https://${BUCKET}.s3.${process.env.AWS_REGION || 'eu-north-1'}.amazonaws.com/${key}`;
    return { url, key };
};

/**
 * Generate a pre-signed download URL for a stored DOCX.
 * Valid for 1 hour.
 *
 * @param {string} s3Key - The S3 object key
 * @returns {string} Pre-signed URL
 */
const getPeriscopeDownloadUrl = async (s3Key) => {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return signedUrl;
};

module.exports = {
    uploadPeriscopeToS3,
    getPeriscopeDownloadUrl,
};
