const AlertThreshold = require('../models/AlertThreshold');
const { createAuditLog } = require('../services/auditService');
const { hasAnyRole } = require('../utils/authIdentity');

// @desc    Get all alert thresholds
// @route   GET /api/alert-thresholds
// @access  Private
const getAlertThresholds = async (req, res) => {
    try {
        const { platform } = req.query;
        const query = {};

        if (platform) query.platform = platform;

        const thresholds = await AlertThreshold.find(query).sort({ platform: 1 });
        res.status(200).json(thresholds);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create new alert threshold
// @route   POST /api/alert-thresholds
// @access  Private (Admin/Analyst)
const createAlertThreshold = async (req, res) => {
    try {
        if (!hasAnyRole(req.user.role, ['superadmin', 'analyst'])) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }

        const { platform, low_threshold, medium_threshold, high_threshold, time_window_minutes } = req.body;

        // Check if threshold already exists for this platform
        const existing = await AlertThreshold.findOne({ platform });
        if (existing) {
            return res.status(400).json({ message: 'Threshold already exists for this platform. Use PUT to update.' });
        }

        const threshold = new AlertThreshold({
            platform,
            low_threshold: low_threshold || 100,
            medium_threshold: medium_threshold || 500,
            high_threshold: high_threshold || 1000,
            time_window_minutes: time_window_minutes || 60
        });

        await threshold.save();
        await createAuditLog(req.user, 'create', 'alert_threshold', threshold.id, req.body);

        res.status(201).json(threshold);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update alert threshold
// @route   PUT /api/alert-thresholds/:id
// @access  Private (Admin/Analyst)
const updateAlertThreshold = async (req, res) => {
    try {
        if (!hasAnyRole(req.user.role, ['superadmin', 'analyst'])) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }

        const threshold = await AlertThreshold.findOne({ id: req.params.id });

        if (!threshold) {
            return res.status(404).json({ message: 'Threshold not found' });
        }

        const updateDoc = {
            ...req.body,
            updated_at: new Date()
        };

        const updatedThreshold = await AlertThreshold.findOneAndUpdate(
            { id: req.params.id },
            updateDoc,
            { new: true }
        );

        await createAuditLog(req.user, 'update', 'alert_threshold', req.params.id, updateDoc);

        res.status(200).json(updatedThreshold);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete alert threshold
// @route   DELETE /api/alert-thresholds/:id
// @access  Private (Admin/Analyst)
const deleteAlertThreshold = async (req, res) => {
    try {
        if (!hasAnyRole(req.user.role, ['superadmin', 'analyst'])) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }

        const threshold = await AlertThreshold.findOne({ id: req.params.id });

        if (!threshold) {
            return res.status(404).json({ message: 'Threshold not found' });
        }

        await AlertThreshold.findOneAndDelete({ id: req.params.id });
        await createAuditLog(req.user, 'delete', 'alert_threshold', req.params.id, {});

        res.status(200).json({ message: 'Threshold deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Bulk upsert thresholds (for Settings UI convenience)
// @route   PUT /api/alert-thresholds/bulk
// @access  Private (Admin/Analyst)
const bulkUpdateThresholds = async (req, res) => {
    try {
        if (!hasAnyRole(req.user.role, ['superadmin', 'analyst'])) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }

        const { thresholds } = req.body;

        if (!Array.isArray(thresholds)) {
            return res.status(400).json({ message: 'thresholds must be an array' });
        }

        const results = [];

        for (const t of thresholds) {
            const updateDoc = {
                low_threshold: t.low_threshold,
                medium_threshold: t.medium_threshold,
                high_threshold: t.high_threshold,
                time_window_minutes: t.time_window_minutes || 60,
                is_active: t.is_active !== undefined ? t.is_active : true,
                updated_at: new Date()
            };

            // Now using platform-only matching (no metric field)
            const updated = await AlertThreshold.findOneAndUpdate(
                { platform: t.platform },
                { $set: updateDoc, $setOnInsert: { platform: t.platform } },
                { new: true, upsert: true }
            );

            results.push(updated);
        }

        await createAuditLog(req.user, 'bulk_update', 'alert_threshold', 'bulk', { count: results.length });

        res.status(200).json(results);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAlertThresholds,
    createAlertThreshold,
    updateAlertThreshold,
    deleteAlertThreshold,
    bulkUpdateThresholds
};
