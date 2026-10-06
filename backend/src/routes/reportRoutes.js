const express = require('express');
const router = express.Router();
const reportService = require('../services/reportService');
const Alert = require('../models/Alert');
const cacheService = require('../services/cacheService');
const { protect } = require('../middleware/authMiddleware');
const {
    loadUserPermissions,
    hasPageAccess,
    hasFeatureAccess,
    denyPageAccess,
    denyFeatureAccess
} = require('../middleware/rbacMiddleware');

const requireReportsAccess = (req, res, next) => {
    if (hasPageAccess(req, '/reports') || hasPageAccess(req, '/unified-reports')) {
        return next();
    }
    if (hasPageAccess(req, '/alerts') && hasFeatureAccess(req, '/alerts', 'reports')) {
        return next();
    }
    if (!hasPageAccess(req, '/reports') && !hasPageAccess(req, '/unified-reports') && hasPageAccess(req, '/alerts')) {
        return denyFeatureAccess(res, '/alerts', 'reports');
    }
    return denyPageAccess(res, ['/reports', '/unified-reports', '/alerts']);
};

router.use(protect, loadUserPermissions, requireReportsAccess);

/**
 * Get all generated reports.
 */
router.get('/', async (req, res) => {
    try {
        // Cache the JSON keyed on query params so repeat visits & pagination flicks
        // skip the gate-cache + Report find + Alert/Content batch lookups entirely.
        const cacheKey = `reports:list:v1:${JSON.stringify(req.query || {})}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=15');
            return res.json(cached);
        }
        const reports = await reportService.getAllReports(req.query);
        await cacheService.set(cacheKey, reports, 30);
        res.set('Cache-Control', 'private, max-age=15');
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const stats = await reportService.getReportStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Escalate an alert and generate a report.
 */
router.post('/escalate/:id', async (req, res) => {
    try {
        const report = await reportService.createReportFromAlert(req.params.id);
        await cacheService.invalidatePrefix('reports:list:v1');
        await cacheService.invalidatePrefix('reports:stats:v1');
        res.status(201).json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update alert status (Ack, False Positive).
 */
router.post('/status/:id', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['acknowledged', 'false_positive', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const alert = await Alert.findOneAndUpdate(
            { id: req.params.id },
            { status },
            { new: true }
        );
        await cacheService.invalidatePrefix('alerts:list:v2');
        await cacheService.invalidatePrefix('alerts:stats:v2');
        await cacheService.invalidatePrefix('dashboard:v2');

        if (!alert) return res.status(404).json({ error: 'Alert not found' });
        res.json(alert);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update a report's content (save edits).
 */
router.put('/:id', async (req, res) => {
    try {
        const report = await reportService.updateReport(req.params.id, req.body);
        await cacheService.invalidatePrefix('reports:list:v1');
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/reports/:id/finalize — Finalize report HTML and generate PDF
 */
router.post('/:id/finalize', async (req, res) => {
    try {
        const { html_content, template_id } = req.body;
        const { pdfPath, report } = await reportService.finalizeReport(req.params.id, html_content, template_id);
        const filename = `${report.serial_number || 'report'}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.sendFile(pdfPath);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
