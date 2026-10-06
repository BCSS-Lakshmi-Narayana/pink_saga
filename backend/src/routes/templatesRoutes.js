const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');
const {
    parseTemplate,
    uploadTemplate,
    getTemplates,
    getTemplate,
    updateTemplateContent,
    setDefaultTemplate,
    deleteTemplate,
    previewTemplate,
    generateTemplate
} = require('../controllers/templatesController');

const router = express.Router();
router.use(protect, requireAnyPageAccess(['/settings']));

// Configure multer for file upload (store in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        // Only accept DOCX files
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        if (!allowedMimes.includes(file.mimetype)) {
            return cb(new Error('Only DOCX files are allowed'));
        }
        cb(null, true);
    }
});

router.post('/parse', upload.single('template'), parseTemplate);
router.post('/upload', upload.single('template'), uploadTemplate);

// Specific routes before parameterized routes
router.post('/:templateId/generate/:alertId', generateTemplate);
router.post('/:id/preview', previewTemplate);

// Generic parameterized routes
router.get('/', getTemplates);
router.get('/:id', getTemplate);
router.put('/:id/content', updateTemplateContent);
router.put('/:id/default', setDefaultTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
