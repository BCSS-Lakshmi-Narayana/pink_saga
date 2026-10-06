const Settings = require('../models/Settings');
const { createAuditLog } = require('../services/auditService');
const { hasAnyRole } = require('../utils/authIdentity');

// @desc    Get settings
// @route   GET /api/settings
// @access  Private
const getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne({ id: 'global_settings' });

    if (!settings) {
      settings = await Settings.create({ id: 'global_settings' });
    }

    // Ensure UI-facing fields are present even for older docs
    const doc = settings.toObject();
    if (doc.risk_threshold_high === undefined) doc.risk_threshold_high = doc.high_risk_threshold ?? 70;
    if (doc.risk_threshold_medium === undefined) doc.risk_threshold_medium = doc.medium_risk_threshold ?? 40;
    if (doc.monitoring_interval_minutes === undefined) doc.monitoring_interval_minutes = 5;

    res.status(200).json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update settings
// @route   PUT /api/settings
// @access  Private (Admin/Analyst only)
const updateSettings = async (req, res) => {
  try {
    if (!hasAnyRole(req.user.role, ['superadmin', 'analyst'])) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const updateDoc = { ...req.body, updated_at: new Date() };

    // Normalize threshold field names (UI uses risk_threshold_*; backend uses *_risk_threshold)
    if (updateDoc.risk_threshold_high !== undefined) {
      updateDoc.high_risk_threshold = updateDoc.risk_threshold_high;
    }
    if (updateDoc.risk_threshold_medium !== undefined) {
      updateDoc.medium_risk_threshold = updateDoc.risk_threshold_medium;
    }

    // Also keep UI fields aligned if backend fields are provided
    if (updateDoc.high_risk_threshold !== undefined && updateDoc.risk_threshold_high === undefined) {
      updateDoc.risk_threshold_high = updateDoc.high_risk_threshold;
    }
    if (updateDoc.medium_risk_threshold !== undefined && updateDoc.risk_threshold_medium === undefined) {
      updateDoc.risk_threshold_medium = updateDoc.medium_risk_threshold;
    }

    const settings = await Settings.findOneAndUpdate(
      { id: 'global_settings' },
      updateDoc,
      { new: true, upsert: true }
    );

    await createAuditLog(req.user, 'update', 'settings', 'global_settings', updateDoc);

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getSettings,
  updateSettings
};
