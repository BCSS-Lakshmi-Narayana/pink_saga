const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

const LOUD_LOG_FILE = path.join(process.cwd(), 's3_authority_debug.log');
const loudLog = (msg) => {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${msg}\n`;
  console.log(msg);
};

console.log('📦 UPLOAD ROUTES LOADED - VERSION: S3-AUTHORITY-V4');

const router = express.Router();
router.use(protect, requireAnyPageAccess(['/dial-100-incident-reporting', '/grievances', '/person-of-interest']));

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

const uploadBufferToS3 = async (file, customKey = null) => {
  const bucket = process.env.AWS_BUCKET_NAME;
  const folder = process.env.AWS_S3_FOLDER || 'uploads';
  const key = customKey || `${folder}/${crypto.randomUUID()}-${file.originalname.replace(/\s+/g, '-')}`;

  loudLog(`------------------------------------------------`);
  loudLog(`⬆️ STARTING S3 UPLOAD`);
  loudLog(`   Bucket:     ${bucket}`);
  loudLog(`   Target Key: ${key}`);
  loudLog(`   Custom Key Provided: ${customKey ? 'YES' : 'NO'}`);
  loudLog(`   Size:       ${file.size} bytes`);
  loudLog(`   MimeType:   ${file.mimetype}`);
  loudLog(`------------------------------------------------`);

  if (!file.buffer || file.size === 0) {
    console.error(`❌ ABORTING: File buffer is empty!`);
    throw new Error("Cannot upload empty file to S3");
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/pdf',
    });

    // HARD ASSERTION: We MUST await s3Client.send and check the result
    const result = await s3Client.send(command);

    // AWS SDK v3 returns metadata on success. If we reach this line, AWS accepted the object.
    loudLog(`✅ S3 UPLOAD SUCCESS (Stage 1): ${JSON.stringify({
      ETag: result.ETag,
      RequestId: result.$metadata?.requestId,
      KeyUsed: key
    })}`);

    // STAGE 2: IMMEDIATE VERIFICATION
    loudLog(`🔍 VERIFYING UPLOAD: Checking S3 for presence of ${key}...`);
    try {
      const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const headResult = await s3Client.send(headCommand);
      loudLog(`🎯 VERIFICATION SUCCESS: Object exists! Size: ${headResult.ContentLength} bytes`);
    } catch (headErr) {
      loudLog(`❌ VERIFICATION FAILURE: Object NOT FOUND immediately after upload! Error: ${headErr.message}`);
      throw new Error(`Critical S3 Sync Failure: Object was uploaded but HeadObject failed with ${headErr.message}`);
    }

    const region = process.env.AWS_REGION || 'eu-north-1';
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    const resourceType = file.mimetype?.startsWith('image/') ? 'image' :
      file.mimetype?.startsWith('video/') ? 'video' : 'file';

    return {
      url,
      key,
      resource_type: resourceType,
      original_filename: file.originalname
    };
  } catch (err) {
    loudLog(`❌ S3 UPLOAD FAILED: ${err.stack || err.message}`);
    throw err; // DO NOT CONTINUE
  }
};

router.post('/s3', upload.array('files', 10), async (req, res) => {
  loudLog(`[S3 POST] 📥 Received upload request. Query: ${JSON.stringify(req.query)}`);
  try {
    if (!req.files || req.files.length === 0) {
      loudLog(`[S3 POST] ⚠️ No files parsed by multer in req.files`);
      return res.status(400).json({ message: 'No files uploaded' });
    }

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_BUCKET_NAME) {
      console.error('[S3 POST] ❌ AWS Configuration Missing');
      return res.status(500).json({ message: 'AWS S3 configuration missing on server' });
    }

    const queryKey = req.query.customKey;
    const headerKey = req.headers['x-s3-key'];
    const bodyKey = req.body.customKey;

    let customKey = queryKey || headerKey || bodyKey;

    // Safety check: sometimes things come in as the string "undefined"
    if (customKey === 'undefined' || customKey === 'null') {
      customKey = null;
    }

    // LOUD CONSOLE LOGS - FOR TERMINAL VISIBILITY
    console.error(`!!!! [S3 AUTHORITY DEBUG] RESOLVED CUSTOM KEY: "${customKey}"`);
    console.error(`!!!! [S3 AUTHORITY DEBUG] FROM -> Query: "${queryKey}", Header: "${headerKey}", Body: "${bodyKey}"`);

    loudLog(`[S3 POST] Key Resolution - Query: ${queryKey}, Header: ${headerKey}, Body: ${bodyKey} => Final: ${customKey}`);
    loudLog(`[S3 POST] File count: ${req.files.length}`);

    if (queryKey && !customKey) {
      loudLog("[S3 Warning] customKey requested in query but not resolved (was null/undefined string). Using fallback.");
    }

    const uploads = await Promise.all(req.files.map(file => uploadBufferToS3(file, customKey)));

    loudLog(`[S3 POST] ✅ All ${req.files.length} files uploaded successfully`);
    res.status(200).json({ uploads });
  } catch (error) {
    console.error('[S3 POST] ❌ CRITICAL FAILURE:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// GET /api/uploads/predict — Pre-calculate S3 URL and Key (Single Source of Truth)
router.get('/predict', (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ message: 'Filename is required' });

    const folder = process.env.AWS_S3_FOLDER || 'uploads';
    const uuid = crypto.randomUUID();
    const cleanFileName = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_.]/g, '');
    const key = `${folder}/${uuid}-${cleanFileName}`;

    const bucket = process.env.AWS_BUCKET_NAME;
    const region = process.env.AWS_REGION || 'eu-north-1';
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    console.log(`[S3 Predict] Authority Key: ${key}`);
    res.json({ url, key });
  } catch (error) {
    console.error('[S3 Predict] Error:', error);
    res.status(500).json({ message: 'Prediction failed', error: error.message });
  }
});

// Proxy endpoint for downloading files to bypass CORS
router.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send('URL is required');
    }

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const contentType = response.headers['content-type'];
    // Try to get filename from URL, handle query params if any
    let filename = url.split('/').pop().split('?')[0];
    if (!filename) filename = 'downloaded-file';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy download error:', error);
    res.status(500).send('Failed to download file');
  }
});

module.exports = router;
