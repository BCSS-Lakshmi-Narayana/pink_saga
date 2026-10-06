const POI = require('../models/POI');
const { normalizeScopeKey } = require('../middleware/scopeMiddleware');

// RBAC: does this POI's constituency fall inside the caller's scope?
// Mirrors the field/matching approach used by getAllPOIs' list filter
// (the `constituency` field). Fails closed: a POI with no constituency
// value set is only visible to canSeeAll roles.
const isPoiInScope = (poi, scope) => {
    if (!scope || scope.canSeeAll) return true;
    if (!poi || !poi.constituency) return false;
    return (scope.constituencyKeys || new Set()).has(normalizeScopeKey(poi.constituency));
};

const denyPoiAccess = (res) => res.status(403).json({
    code: 'CONSTITUENCY_FORBIDDEN',
    message: 'You are not authorized to view this record',
});

// GET /api/poi — List all POIs
const getAllPOIs = async (req, res) => {
    try {
        const { status, search, page = 1, limit = 50 } = req.query;

        const filter = {};

        // RBAC: scoped MLA / MP sees only POIs tagged to their seat or
        // explicitly marked party-wide.
        if (req.scope && !req.scope.canSeeAll) {
            const seats = req.scope.constituencies || [];
            if (seats.length === 0) {
                return res.json({ pois: [], total: 0, page: 1, totalPages: 0 });
            }
            const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = `^(${seats.map(escape).join('|')})$`;
            filter.$and = [
                {
                    $or: [
                        { is_party_wide: true },
                        { constituency: { $regex: rx, $options: 'i' } },
                    ],
                },
            ];
        }

        if (search) {
            const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegex = { $regex: escapedSearch, $options: 'i' };
            const searchOr = [
                { name: searchRegex },
                { realName: searchRegex },
                { aliasNames: searchRegex },
                { mobileNumbers: searchRegex },
                { emailIds: searchRegex },
                { whatsappNumbers: searchRegex },
                { lastUsedIp: searchRegex },
                { softwareHardwareIdentifiers: searchRegex },
                { currentAddress: searchRegex },
                { psLimits: searchRegex },
                { districtCommisionerate: searchRegex },
                { firNo: searchRegex },
                { linkedIncidents: searchRegex },
                { briefSummary: searchRegex },
                { 'firDetails.firNo': searchRegex },
                { 'firDetails.psLimits': searchRegex },
                { 'firDetails.districtCommisionerate': searchRegex },
                { 'socialMedia.handle': searchRegex },
                { 'socialMedia.displayName': searchRegex },
                { 'socialMedia.followerCount': searchRegex },
                { 'socialMedia.createdDate': searchRegex },
                { 'previouslyDeletedProfiles.x': searchRegex },
                { 'previouslyDeletedProfiles.facebook': searchRegex },
                { 'previouslyDeletedProfiles.instagram': searchRegex },
                { 'previouslyDeletedProfiles.youtube': searchRegex },
                { 'previouslyDeletedProfiles.whatsapp': searchRegex },
                { 'customFields.value': searchRegex }
            ];
            filter.$and = (filter.$and || []).concat([{ $or: searchOr }]);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [pois, total] = await Promise.all([
            POI.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            POI.countDocuments(filter)
        ]);

        res.json({
            pois,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error('[POI] Error fetching POIs:', error.message);
        res.status(500).json({ message: 'Failed to fetch persons of interest', error: error.message });
    }
};

// GET /api/poi/:id — Get single POI
const getPOIById = async (req, res) => {
    try {
        const poi = await POI.findById(req.params.id).lean();
        if (!poi) {
            return res.status(404).json({ message: 'Person of interest not found' });
        }
        if (!isPoiInScope(poi, req.scope)) {
            return denyPoiAccess(res);
        }
        res.json(poi);
    } catch (error) {
        console.error('[POI] Error fetching POI:', error.message);
        res.status(500).json({ message: 'Failed to fetch person of interest', error: error.message });
    }
};

// POST /api/poi — Create new POI
const createPOI = async (req, res) => {
    try {
        const {
            name, realName, aliasNames, mobileNumbers, emailIds, whatsappNumbers,
            lastUsedIp, currentAddress, psLimits, districtCommisionerate,
            softwareHardwareIdentifiers, firNo, firDetails, linkedIncidents,
            previouslyDeletedProfiles, socialMedia,
            briefSummary, profileImage, customFields, status
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Name is required' });
        }

        const poi = await POI.create({
            name: name.trim(),
            realName: realName || '',
            aliasNames: aliasNames || [],
            mobileNumbers: mobileNumbers || [],
            emailIds: emailIds || [],
            whatsappNumbers: whatsappNumbers || [],
            lastUsedIp: lastUsedIp || '',
            currentAddress: currentAddress || '',
            psLimits: psLimits || '',
            districtCommisionerate: districtCommisionerate || '',
            softwareHardwareIdentifiers: softwareHardwareIdentifiers || '',
            firNo: firNo || '',
            firDetails: firDetails || [],
            linkedIncidents: linkedIncidents || '',
            previouslyDeletedProfiles: previouslyDeletedProfiles || {},
            socialMedia: socialMedia || [],
            briefSummary: briefSummary || '',
            profileImage: profileImage || '',
            customFields: customFields || [],
            status: status || 'active',
            createdBy: req.body.createdBy || 'system'
        });

        res.status(201).json(poi);
    } catch (error) {
        console.error('[POI] Error creating POI:', error.message);
        res.status(500).json({ message: 'Failed to create person of interest', error: error.message });
    }
};

// PUT /api/poi/:id — Update POI
const updatePOI = async (req, res) => {
    try {
        const existing = await POI.findById(req.params.id).lean();
        if (!existing) {
            return res.status(404).json({ message: 'Person of interest not found' });
        }
        if (!isPoiInScope(existing, req.scope)) {
            return denyPoiAccess(res);
        }

        const poi = await POI.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );

        if (!poi) {
            return res.status(404).json({ message: 'Person of interest not found' });
        }

        // Sync monitoring details to Source collection if linked
        if (req.body.socialMedia && Array.isArray(req.body.socialMedia)) {
            const Source = require('../models/Source');
            for (const sm of req.body.socialMedia) {
                if (sm.sourceId) {
                    const updateData = {};
                    if (sm.category) updateData.category = sm.category;
                    if (sm.priority) updateData.priority = sm.priority;
                    if (sm.displayName) updateData.display_name = sm.displayName;
                    if (sm.is_active !== undefined) updateData.is_active = sm.is_active;

                    if (Object.keys(updateData).length > 0) {
                        // Update by UUID (id) OR ObjectId (_id)
                        const mongoose = require('mongoose');
                        const query = { $or: [{ id: sm.sourceId }] };
                        if (mongoose.Types.ObjectId.isValid(sm.sourceId)) {
                            query.$or.push({ _id: sm.sourceId });
                        }

                        try {
                            await Source.findOneAndUpdate(query, { $set: updateData });
                        } catch (err) {
                            console.error(`[POI] Failed to sync Source ${sm.sourceId}:`, err.message);
                        }
                    }
                }
            }
        }

        res.json(poi);
    } catch (error) {
        console.error('[POI] Error updating POI:', error.message);
        res.status(500).json({ message: 'Failed to update person of interest', error: error.message });
    }
};

// GET /api/poi/:id/report/latest — Redirect to latest S3 report
const getLatestReport = async (req, res) => {
    try {
        const poi = await POI.findById(req.params.id);
        if (!poi || !poi.s3ReportUrl) {
            console.log(`[POI] No report found for ID: ${req.params.id}`);
            return res.status(404).send('<h1>No report found</h1><p>The report for this profile has not been uploaded yet.</p>');
        }
        console.log(`[POI] Redirecting to report: ${poi.s3ReportUrl}`);
        res.redirect(poi.s3ReportUrl);
    } catch (error) {
        console.error('[POI] Error redirecting to report:', error.message);
        res.status(500).json({ message: 'Failed to find report', error: error.message });
    }
};

// DELETE /api/poi/:id — Delete POI
const deletePOI = async (req, res) => {
    try {
        const existing = await POI.findById(req.params.id).lean();
        if (!existing) {
            return res.status(404).json({ message: 'Person of interest not found' });
        }
        if (!isPoiInScope(existing, req.scope)) {
            return denyPoiAccess(res);
        }

        const poi = await POI.findByIdAndDelete(req.params.id);

        if (!poi) {
            return res.status(404).json({ message: 'Person of interest not found' });
        }

        res.json({ message: 'Person of interest deleted successfully' });
    } catch (error) {
        console.error('[POI] Error deleting POI:', error.message);
        res.status(500).json({ message: 'Failed to delete person of interest', error: error.message });
    }
};

// GET /api/poi/by-source/:sourceId — Find POI linked to a source
const getPoiBySourceId = async (req, res) => {
    try {
        const { sourceId } = req.params;
        // Try matching by sourceId first
        let poi = await POI.findOne({ 'socialMedia.sourceId': sourceId }).lean();
        if (!poi) {
            // Fallback: try matching by handle + platform from query params
            const { handle, platform } = req.query;
            if (handle && platform) {
                const normalizedPlatform = platform === 'twitter' ? 'x' : platform;
                poi = await POI.findOne({
                    'socialMedia.handle': { $regex: `^${handle.replace(/^@/, '')}$`, $options: 'i' },
                    'socialMedia.platform': normalizedPlatform
                }).lean();
            }
        }
        if (!poi) {
            return res.status(404).json({ message: 'No POI found for this source' });
        }
        res.json(poi);
    } catch (error) {
        console.error('[POI] Error finding POI by source:', error.message);
        res.status(500).json({ message: 'Failed to find POI', error: error.message });
    }
};

module.exports = {
    getAllPOIs,
    getPOIById,
    createPOI,
    updatePOI,
    deletePOI,
    getLatestReport,
    getPoiBySourceId
};
