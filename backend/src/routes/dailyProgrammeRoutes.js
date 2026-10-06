const express = require('express');
const router = express.Router();
const multer = require('multer');

// In-memory storage for .docx uploads (no disk write needed)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.originalname.endsWith('.docx')) {
            cb(null, true);
        } else {
            cb(new Error('Only .docx files are allowed'), false);
        }
    }
});

const {
    getProgrammesByDate,
    saveProgrammesBulk,
    createProgramme,
    updateProgramme,
    deleteProgramme,
    clearProgrammesByDate,
    getAvailableDates,
    uploadPeriscope,
    getPeriscopeUploadInfo,
    downloadPeriscopeDoc
} = require('../controllers/dailyProgrammeController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, requireAnyPageAccess(['/announcements']));

// Get available dates with programmes
router.get('/dates', getAvailableDates);

// Get upload info (abstract, S3 availability) for a date
router.get('/upload-info', getPeriscopeUploadInfo);

// Download original Periscope DOCX from S3
router.get('/download-periscope', downloadPeriscopeDoc);

// Get programmes by date
router.get('/', getProgrammesByDate);

// Upload Periscope .docx and parse into programmes
router.post('/upload-periscope', authorize('super_admin','superadmin', 'analyst', 'viewer'), upload.single('file'), uploadPeriscope);

// Save bulk programmes for a date
router.post('/bulk', authorize('super_admin','superadmin' ,'analyst', 'viewer'), saveProgrammesBulk);

// Create single programme
router.post('/', authorize('super_admin','superadmin' ,'analyst', 'viewer'), createProgramme);

// Update single programme
router.put('/:id', authorize('super_admin', 'analyst','superadmin', 'viewer'), updateProgramme);

// Delete single programme
router.delete('/:id', authorize('super_admin', 'analyst','superadmin' ,'viewer'), deleteProgramme);

// Clear all programmes for a date
router.delete('/date/:date', authorize('super_admin','superadmin' ,'analyst'), clearProgrammesByDate);

module.exports = router;
