const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

// Uploads of up to 100 MB are proxied to the ML service: signed-in users only.
router.use(protect);

// Configuration for Deepfake ML Service
// Use DEEPFAKE_ML_URL to avoid conflict with remote ML_SERVICE_URL
const DEEPFAKE_ML_URL = process.env.DEEPFAKE_ML_URL || 'http://localhost:8001';

// Setup Multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

/**
 * @route   POST /api/deepfake/image
 * @desc    Analyze an image for deepfakes
 */
router.post('/image', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file uploaded' });
        }

        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const response = await axios.post(`${DEEPFAKE_ML_URL}/detect/image`, formData, {
            headers: {
                ...formData.getHeaders()
            }
        });

        const responseData = response.data;

        // Normalize for frontend
        const finalResult = {
            ...responseData,
            label: responseData.label || responseData.verdict || 'UNKNOWN',
            type: 'image'
        };

        res.json(finalResult);
    } catch (error) {
        console.error('Deepfake Image Analysis Error:', error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.detail || 'Deepfake image analysis failed';
        res.status(status).json({ message, error: error.message });
    }
});

/**
 * @route   POST /api/deepfake/video
 * @desc    Analyze a video for deepfakes
 */
router.post('/video', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No video file uploaded' });
        }

        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const response = await axios.post(`${DEEPFAKE_ML_URL}/detect/video`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 300000 // 5 minutes for video processing
        });

        const responseData = response.data;

        // Rewrite imageUrls to be served through the backend proxy
        if (responseData.full_forensic_timeline) {
            responseData.full_forensic_timeline = responseData.full_forensic_timeline.map(frame => ({
                ...frame,
                imageUrl: frame.imageUrl ? `${req.protocol}://${req.get('host')}/api/deepfake/forensics/${frame.imageUrl.split('/').pop()}` : null
            }));
        }
        if (responseData.top_suspicious_frames) {
            responseData.top_suspicious_frames = responseData.top_suspicious_frames.map(frame => ({
                ...frame,
                imageUrl: frame.imageUrl ? `${req.protocol}://${req.get('host')}/api/deepfake/forensics/${frame.imageUrl.split('/').pop()}` : null
            }));
        }

        // Normalize for frontend
        const finalResult = {
            ...responseData,
            label: responseData.label || responseData.verdict || 'UNKNOWN',
            type: 'video'
        };

        res.json(finalResult);
    } catch (error) {
        console.error('Deepfake Video Analysis Error:', error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.detail || 'Deepfake video analysis failed';
        res.status(status).json({ message, error: error.message });
    }
});

/**
 * @route   GET /api/deepfake/forensics/:filename
 * @desc    Proxy forensic preview images from ML service
 */
router.get('/forensics/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const imageUrl = `${DEEPFAKE_ML_URL}/static/forensics/${filename}`;

        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream'
        });

        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        console.error('Forensic Image Proxy Error:', error.message);
        res.status(404).send('Not Found');
    }
});

module.exports = router;
