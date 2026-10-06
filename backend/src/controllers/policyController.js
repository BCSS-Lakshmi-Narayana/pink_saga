const PolicyMapping = require('../models/PolicyMapping');
const mappingService = require('../services/mappingService');

// @desc    Get all policy mappings
// @route   GET /api/policies
// @access  Private (Admin)
exports.getPolicies = async (req, res) => {
    try {
        const policies = await PolicyMapping.find().sort({ category_id: 1 });
        res.status(200).json({ success: true, count: policies.length, data: policies });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// @desc    Get single policy mapping
// @route   GET /api/policies/:id
// @access  Private (Admin)
exports.getPolicy = async (req, res) => {
    try {
        const policy = await PolicyMapping.findById(req.params.id);
        if (!policy) {
            return res.status(404).json({ success: false, error: 'Policy not found' });
        }
        res.status(200).json({ success: true, data: policy });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// @desc    Create new policy mapping
// @route   POST /api/policies
// @access  Private (Admin)
exports.createPolicy = async (req, res) => {
    try {
        const policy = await PolicyMapping.create(req.body);
        // Refresh cache
        await mappingService.forceRefresh();
        res.status(201).json({ success: true, data: policy });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'Category ID already exists' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};

// @desc    Update policy mapping
// @route   PUT /api/policies/:id
// @access  Private (Admin)
exports.updatePolicy = async (req, res) => {
    try {
        const policy = await PolicyMapping.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        if (!policy) {
            return res.status(404).json({ success: false, error: 'Policy not found' });
        }
        // Refresh cache
        await mappingService.forceRefresh();
        res.status(200).json({ success: true, data: policy });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// @desc    Delete policy mapping
// @route   DELETE /api/policies/:id
// @access  Private (Admin)
exports.deletePolicy = async (req, res) => {
    try {
        const policy = await PolicyMapping.findByIdAndDelete(req.params.id);
        if (!policy) {
            return res.status(404).json({ success: false, error: 'Policy not found' });
        }
        // Refresh cache
        await mappingService.forceRefresh();
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
