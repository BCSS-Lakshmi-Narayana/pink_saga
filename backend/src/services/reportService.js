const Report = require('../models/Report');
const Alert = require('../models/Alert');
const Content = require('../models/Content');
const Source = require('../models/Source');
const Analysis = require('../models/Analysis');
const cacheService = require('./cacheService');

/**
 * Generate a unique serial number for a report.
 * Format: PLATFORM-SN-MM-DD-YYYY
 */
const generateSerialNumber = async (platform) => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();

    const platformCode = platform.toUpperCase().substring(0, 1); // X, Y, F, I
    const dateStr = `${dd}${mm}${yyyy}`; // ddmmyyyy

    // Count ALL reports created for this platform (no date filter)
    const count = await Report.countDocuments({
        platform: platform.toLowerCase()
    });

    const sn = String(count + 1).padStart(4, '0'); // 0001
    return `${platformCode}${sn}-${dateStr}`; // x0001-ddmmyyyy
};

/**
 * Create a new report based on an alert.
 */
const createReportFromAlert = async (alertId) => {
    const alert = await Alert.findOne({ id: alertId });
    if (!alert) throw new Error('Alert not found');

    const content = await Content.findOne({ id: alert.content_id });
    const analysis = await Analysis.findOne({ id: alert.analysis_id });

    // Check if report already exists
    const existingReport = await Report.findOne({ alert_id: alertId });
    if (existingReport) {
        return existingReport;
    }

    const serialNumber = await generateSerialNumber(alert.platform);

    const reportData = {
        serial_number: serialNumber,
        alert_id: alertId,
        platform: alert.platform,
        target_user_details: {
            name: alert.author || 'Unknown',
            handle: content?.author_handle || alert.author,
            profile_url: `https://x.com/${(content?.author_handle || alert.author).replace('@', '')}`,
            avatar_url: content?.original_author_avatar || '',
            is_verified: false // Source model would have this
        },
        content_summary: content?.text || alert.description,
        media_links: content?.media?.map(m => m.url) || [],
        legal_sections: alert.legal_sections || [],
        violated_policies: alert.violated_policies || [],
        status: 'sent_to_intermediary'
    };

    const report = new Report(reportData);
    await report.save();

    // Update alert status to escalated
    alert.status = 'escalated';
    await alert.save();
    await cacheService.invalidatePrefix('reports:stats:v1');
    await cacheService.invalidatePrefix('dashboard:v2');
    await cacheService.invalidatePrefix('alerts:stats:v2');

    // --- ML FEEDBACK LOOP ---
    // Recording report generation as confirmed escalation (HIGH risk)
    try {
        const feedbackService = require('./feedbackService');
        if (content && content.text) {
            await feedbackService.recordFeedback({
                text: content.text,
                category: alert.category_id || 'Abusive',
                legal_sections: alert.legal_sections,
                review_status: 'escalated',
                current_risk: 'HIGH'
            });
            console.log(`[ReportService] Recorded feedback for report: ${alertId}`);
        }
    } catch (fbError) {
        console.error('[ReportService] Feedback recording failed:', fbError);
    }

    return report;
};

/**
 * Get all reports with filtering and pagination.
 */
const getAllReports = async (filters = {}) => {
    const { platform, status, search, startDate, endDate, page = 1, limit = 50, keyword, alert_type, risk_level, category, viewMode } = filters;
    const query = {};

    if (platform && platform !== 'all') query.platform = platform;
    if (status && status !== 'all') query.status = status;
    if (startDate || endDate) {
        query.generated_at = {};
        if (startDate) query.generated_at.$gte = new Date(startDate);
        if (endDate) query.generated_at.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // optimization: if no filters require lookups, we paginate first.
    // however, search usually covers content_data.text and target_user_details (now in Report model).
    // alert_data filters (risk_level, alert_type) and source_data (category) always need joins.

    const needsJoinsForFiltering = category && category !== 'all' ||
        keyword && keyword !== 'all' ||
        risk_level && risk_level !== 'all' ||
        alert_type && alert_type !== 'all' ||
        (search && search.includes(' ')); // complex search might hit content text

    // SPECIAL MODE: If viewMode is 'profiles_only', return pre-computed top profiles (cached for 1 hour)
    if (viewMode === 'profiles_only') {
        // Use a SINGLE cache key for all profiles (no query-specific caching)
        // This means all filters use the SAME cached profile list
        const profileCacheKey = 'profiles:all:grouped:v1';

        try {
            const cached = await cacheService.get(profileCacheKey);
            if (cached) {
                // Return paginated results from cache
                return cached.slice(skip, skip + limitNum);
            }
        } catch (cacheErr) {
            // Cache miss, proceed to compute
        }

        // Get all gated alert IDs
        const gatedAlertsCacheKey = 'gated:alert:ids:v1';
        let gatedAlertIdSet = null;
        try {
            const cached = await cacheService.get(gatedAlertsCacheKey);
            if (cached) gatedAlertIdSet = new Set(cached);
        } catch (cacheErr) {
            // ignore
        }

        if (!gatedAlertIdSet) {
            const gatedAlertIds = await Alert.find({ matched_keywords: { $exists: true, $ne: [] } }, { id: 1 }).lean().exec();
            gatedAlertIdSet = new Set(gatedAlertIds.map(a => a.id));
            try {
                await cacheService.set(gatedAlertsCacheKey, Array.from(gatedAlertIdSet), 300);
            } catch (cacheErr) {
                // ignore
            }
        }

        if (gatedAlertIdSet.size === 0) return [];

        // Get ALL reports with gated alert IDs (no additional filters for profiles view)
        const allReports = await Report.find({
            alert_id: { $in: Array.from(gatedAlertIdSet) }
        }).lean().exec();

        if (!allReports || allReports.length === 0) return [];

        // Group by handle in JavaScript
        const profileMap = new Map();
        allReports.forEach(report => {
            const handle = report.target_user_details?.handle;
            if (!handle) return;

            if (!profileMap.has(handle)) {
                profileMap.set(handle, {
                    handle,
                    name: report.target_user_details?.name,
                    avatar_url: report.target_user_details?.avatar_url,
                    alertCount: 0,
                    latestAlert: report.generated_at
                });
            }
            const profile = profileMap.get(handle);
            profile.alertCount++;
            if (new Date(report.generated_at) > new Date(profile.latestAlert)) {
                profile.latestAlert = report.generated_at;
            }
        });

        // Sort by alert count
        const sortedProfiles = Array.from(profileMap.values())
            .sort((a, b) => b.alertCount - a.alertCount || new Date(b.latestAlert) - new Date(a.latestAlert));

        // Cache for 1 HOUR (60 minutes) - pre-computed so instant on subsequent requests
        try {
            await cacheService.set(profileCacheKey, sortedProfiles, 60);
        } catch (cacheErr) {
            // ignore
        }

        // Return paginated slice
        return sortedProfiles.slice(skip, skip + limitNum);
    }

    let pipeline = [];

    // PRE-FETCH: Get alert IDs with matched_keywords for gate filter (with caching to avoid repeated queries)
    const gatedAlertsCacheKey = 'gated:alert:ids:v1';
    let gatedAlertIdSet = null;
    try {
        const cached = await cacheService.get(gatedAlertsCacheKey);
        if (cached) {
            gatedAlertIdSet = new Set(cached);
        }
    } catch (cacheErr) {
        // Cache miss, will query DB
    }

    if (!gatedAlertIdSet) {
        const gatedAlertIds = await Alert.find({ matched_keywords: { $exists: true, $ne: [] } }, { id: 1 }).lean();
        gatedAlertIdSet = new Set(gatedAlertIds.map(a => a.id));
        // Cache for 5 minutes
        try {
            await cacheService.set(gatedAlertsCacheKey, Array.from(gatedAlertIdSet), 300);
        } catch (cacheErr) {
            // Cache write failed, continue without caching
        }
    }

    if (!needsJoinsForFiltering) {
        // OPTIMIZED PATH: Simple find + sort + paginate (fastest)
        if (gatedAlertIdSet.size === 0) return [];

        // Build query object
        const finalQuery = {
            ...query,
            alert_id: { $in: Array.from(gatedAlertIdSet) }
        };

        // Add search filter if provided
        if (search) {
            finalQuery.$or = [
                { serial_number: { $regex: search, $options: 'i' } },
                { 'target_user_details.name': { $regex: search, $options: 'i' } },
                { 'target_user_details.handle': { $regex: search, $options: 'i' } }
            ];
        }

        // Direct find query with indexes - FASTEST
        const reports = await Report.find(finalQuery)
            .sort({ generated_at: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean()
            .exec();

        if (!reports || reports.length === 0) return [];

        // Batch load related data AFTER pagination
        const alertIds = [...new Set(reports.map(r => r.alert_id))];
        const alertMap = new Map();
        const contentMap = new Map();

        if (alertIds.length > 0) {
            const alerts = await Alert.find({ id: { $in: alertIds } }).lean().exec();
            alerts.forEach(a => alertMap.set(a.id, a));

            const contentIds = [...new Set(alerts.map(a => a.content_id).filter(Boolean))];
            if (contentIds.length > 0) {
                const contents = await Content.find({ id: { $in: contentIds } }).lean().exec();
                contents.forEach(c => contentMap.set(c.id, c));
            }
        }

        // Enrich with related data
        return reports.map(report => ({
            ...report,
            alert_data: alertMap.get(report.alert_id) || null,
            content_data: alertMap.get(report.alert_id) ? contentMap.get(alertMap.get(report.alert_id).content_id) : null
        }));
    } else {
        // LEGACY PATH: Complex filters with aggregation (must use $lookup for filtering)
        if (gatedAlertIdSet.size === 0) return [];

        const baseQuery = {
            ...query,
            alert_id: { $in: Array.from(gatedAlertIdSet) }
        };

        // Use aggregation pipeline for complex filtering WITH pagination BEFORE final enrichment
        const pipeline = [
            { $match: baseQuery },
            {
                $lookup: {
                    from: 'alerts',
                    localField: 'alert_id',
                    foreignField: 'id',
                    as: 'alert_data'
                }
            },
            { $unwind: { path: '$alert_data', preserveNullAndEmptyArrays: true } }
        ];

        // Add filters that use alert data
        if (risk_level && risk_level !== 'all') {
            pipeline.push({ $match: { 'alert_data.risk_level': risk_level } });
        }

        if (alert_type && alert_type !== 'all') {
            if (alert_type === 'risk') {
                pipeline.push({ $match: { 'alert_data.alert_type': { $in: ['keyword_risk', 'ai_risk', null] } } });
            } else {
                pipeline.push({ $match: { 'alert_data.alert_type': alert_type } });
            }
        }

        // Add content lookup if needed for filtering
        if (category && category !== 'all') {
            pipeline.push(
                {
                    $lookup: {
                        from: 'contents',
                        localField: 'alert_data.content_id',
                        foreignField: 'id',
                        as: 'content_data'
                    }
                },
                { $unwind: { path: '$content_data', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'sources',
                        localField: 'content_data.source_id',
                        foreignField: 'id',
                        as: 'source_data'
                    }
                },
                { $unwind: { path: '$source_data', preserveNullAndEmptyArrays: true } },
                { $match: { 'source_data.category': category } }
            );
        }

        if (keyword && keyword !== 'all') {
            if (!category) {
                pipeline.push(
                    {
                        $lookup: {
                            from: 'contents',
                            localField: 'alert_data.content_id',
                            foreignField: 'id',
                            as: 'content_data'
                        }
                    },
                    { $unwind: { path: '$content_data', preserveNullAndEmptyArrays: true } }
                );
            }
            pipeline.push({ $match: { 'content_data.risk_factors.keyword': { $regex: `^${keyword}`, $options: 'i' } } });
        }

        if (search) {
            if (!category && !keyword) {
                pipeline.push(
                    {
                        $lookup: {
                            from: 'contents',
                            localField: 'alert_data.content_id',
                            foreignField: 'id',
                            as: 'content_data'
                        }
                    },
                    { $unwind: { path: '$content_data', preserveNullAndEmptyArrays: true } }
                );
            }
            pipeline.push({
                $match: {
                    $or: [
                        { serial_number: { $regex: search, $options: 'i' } },
                        { 'target_user_details.name': { $regex: search, $options: 'i' } },
                        { 'target_user_details.handle': { $regex: search, $options: 'i' } },
                        { 'content_data.text': { $regex: search, $options: 'i' } }
                    ]
                }
            });
        }

        // CRITICAL: Sort and paginate BEFORE final lookups (only load 50 results max)
        pipeline.push(
            { $sort: { generated_at: -1 } },
            { $skip: skip },
            { $limit: limitNum }
        );

        // Final content lookup if not already done
        if (!category && !keyword && !search) {
            pipeline.push(
                {
                    $lookup: {
                        from: 'contents',
                        localField: 'alert_data.content_id',
                        foreignField: 'id',
                        as: 'content_data'
                    }
                },
                { $unwind: { path: '$content_data', preserveNullAndEmptyArrays: true } }
            );
        }

        return await Report.aggregate(pipeline).exec();
    }
};
const updateReport = async (alertId, updateData) => {
    const report = await Report.findOneAndUpdate(
        { alert_id: alertId },
        {
            $set: updateData
        },
        { new: true }
    );
    if (!report) throw new Error('Report not found');
    await cacheService.invalidatePrefix('reports:stats:v1');
    await cacheService.invalidatePrefix('dashboard:v2');
    return report;
};

const getReportStats = async () => {
    const cacheKey = 'reports:stats:v1:all';
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    // Pre-fetch gated alert IDs for fast filtering (with caching to avoid repeated queries)
    const gatedAlertsCacheKey = 'gated:alert:ids:v1';
    let gatedAlertIdSet = null;
    try {
        const cached = await cacheService.get(gatedAlertsCacheKey);
        if (cached) {
            gatedAlertIdSet = new Set(cached);
        }
    } catch (cacheErr) {
        // Cache miss, will query DB
    }

    if (!gatedAlertIdSet) {
        const gatedAlertIds = await Alert.find({ matched_keywords: { $exists: true, $ne: [] } }, { id: 1 }).lean();
        gatedAlertIdSet = new Set(gatedAlertIds.map(a => a.id));
        // Cache for 5 minutes
        try {
            await cacheService.set(gatedAlertsCacheKey, Array.from(gatedAlertIdSet), 300);
        } catch (cacheErr) {
            // Cache write failed, continue without caching
        }
    }

    const grouped = await Report.aggregate([
        // Gate filter using pre-fetched alert IDs (fast $match with $in)
        {
            $match: {
                alert_id: { $in: Array.from(gatedAlertIdSet) }
            }
        },
        {
            $group: {
                _id: { platform: '$platform', status: '$status' },
                count: { $sum: 1 }
            }
        }
    ]);

    const normalizePlatform = (platform) => (platform === 'x' ? 'twitter' : platform);
    const statuses = ['generated', 'printed', 'sent', 'sent_to_intermediary', 'awaiting_reply', 'closed'];
    const platforms = ['all', 'twitter', 'youtube', 'facebook', 'instagram', 'whatsapp'];
    const byPlatform = {};
    const byStatus = Object.fromEntries(statuses.map((s) => [s, 0]));
    const totals = { total: 0 };

    platforms.forEach((p) => {
        byPlatform[p] = { total: 0 };
        statuses.forEach((s) => {
            byPlatform[p][s] = 0;
        });
    });

    grouped.forEach(({ _id, count }) => {
        const platform = normalizePlatform(_id.platform || 'unknown');
        const status = _id.status;
        if (!statuses.includes(status)) return;
        if (!byPlatform[platform]) {
            byPlatform[platform] = { total: 0 };
            statuses.forEach((s) => {
                byPlatform[platform][s] = 0;
            });
        }
        byPlatform[platform][status] += count;
        byPlatform[platform].total += count;
        byPlatform.all[status] += count;
        byPlatform.all.total += count;
        byStatus[status] += count;
        totals.total += count;
    });

    const payload = { byPlatform, byStatus, totals };
    await cacheService.set(cacheKey, payload, 30);
    return payload;
};

module.exports = {
    generateSerialNumber,
    createReportFromAlert,
    getAllReports,
    updateReport,
    getReportStats
};
