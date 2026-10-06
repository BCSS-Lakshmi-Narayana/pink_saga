const DailyProgramme = require('../models/DailyProgramme');
const PeriscopeUpload = require('../models/PeriscopeUpload');
const { createAuditLog } = require('../services/auditService');
const { uploadPeriscopeToS3, getPeriscopeDownloadUrl } = require('../services/periscopeS3Service');
const cacheService = require('../services/cacheService');

const PROGRAMMES_CACHE_PREFIX = 'daily-programmes:v1';
const invalidateProgrammesCache = () => cacheService.invalidatePrefix(PROGRAMMES_CACHE_PREFIX);

// Helper to get start and end of a day
const getDayRange = (dateStr) => {
    const date = new Date(dateStr);
    const start = new Date(date.setHours(0, 0, 0, 0));
    const end = new Date(date.setHours(23, 59, 59, 999));
    return { start, end };
};

// @desc    Get programmes by date
// @route   GET /api/daily-programmes?date=YYYY-MM-DD
// @access  Private
const getProgrammesByDate = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ message: 'date query parameter is required' });
        }

        const cacheKey = `${PROGRAMMES_CACHE_PREFIX}:${date}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=15');
            return res.status(200).json(cached);
        }

        const { start, end } = getDayRange(date);

        const programmes = await DailyProgramme.find({
            date: { $gte: start, $lte: end }
        }).sort({ category: 1, slNo: 1 });

        // Group by category
        const grouped = {
            category1: programmes.filter(p => p.category === 'category1'),
            category2: programmes.filter(p => p.category === 'category2'),
            category3: programmes.filter(p => p.category === 'category3'),
            category4: programmes.filter(p => p.category === 'category4'),
        };

        // Get category labels (from first item in each category)
        const categoryLabels = {};
        Object.keys(grouped).forEach(cat => {
            if (grouped[cat].length > 0 && grouped[cat][0].categoryLabel) {
                categoryLabels[cat] = grouped[cat][0].categoryLabel;
            }
        });

        const payload = {
            date,
            total: programmes.length,
            categoryLabels,
            programmes: grouped
        };
        await cacheService.set(cacheKey, payload, 60);
        res.set('Cache-Control', 'private, max-age=15');
        res.status(200).json(payload);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Save/Update programmes for a date (bulk)
// @route   POST /api/daily-programmes/bulk
// @access  Private
const saveProgrammesBulk = async (req, res) => {
    try {
        const { date, categoryLabels, programmes } = req.body;

        if (!date || !programmes) {
            return res.status(400).json({ message: 'date and programmes are required' });
        }

        const { start, end } = getDayRange(date);

        // Delete existing programmes for this date
        await DailyProgramme.deleteMany({
            date: { $gte: start, $lte: end }
        });

        // Prepare new programmes
        const programmeDate = new Date(date);
        programmeDate.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues

        const allProgrammes = [];
        const createdBy = req.user?.email || req.user?.id || 'system';

        Object.keys(programmes).forEach(category => {
            const categoryProgrammes = programmes[category] || [];
            const label = categoryLabels?.[category] || '';

            categoryProgrammes.forEach((p, index) => {
                allProgrammes.push({
                    date: programmeDate,
                    category,
                    categoryLabel: label,
                    slNo: p.slNo || index + 1,
                    zone: p.zone || '',
                    programName: p.programName || '',
                    location: p.location || '',
                    organizer: p.organizer || '',
                    expectedMembers: p.expectedMembers || 0,
                    time: p.time || '',
                    gist: p.gist || '',
                    permission: p.permission || 'By Information',
                    comments: p.comments || 'Required L&O and Traffic BB',
                    createdBy
                });
            });
        });

        // Insert all programmes
        const created = await DailyProgramme.insertMany(allProgrammes);

        await createAuditLog(req.user, 'save', 'daily_programmes', date, {
            count: created.length
        });

        await invalidateProgrammesCache();
        res.status(201).json({
            message: `Saved ${created.length} programmes for ${date}`,
            count: created.length
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create single programme
// @route   POST /api/daily-programmes
// @access  Private
const createProgramme = async (req, res) => {
    try {
        const { date, category, ...data } = req.body;

        if (!date || !category) {
            return res.status(400).json({ message: 'date and category are required' });
        }

        const programmeDate = new Date(date);
        programmeDate.setHours(12, 0, 0, 0);

        const programme = await DailyProgramme.create({
            date: programmeDate,
            category,
            ...data,
            createdBy: req.user?.email || req.user?.id || 'system'
        });

        await invalidateProgrammesCache();
        res.status(201).json(programme);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update single programme
// @route   PUT /api/daily-programmes/:id
// @access  Private
const updateProgramme = async (req, res) => {
    try {
        const programme = await DailyProgramme.findOne({ id: req.params.id });

        if (!programme) {
            return res.status(404).json({ message: 'Programme not found' });
        }

        const updated = await DailyProgramme.findOneAndUpdate(
            { id: req.params.id },
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        await invalidateProgrammesCache();
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete single programme
// @route   DELETE /api/daily-programmes/:id
// @access  Private
const deleteProgramme = async (req, res) => {
    try {
        const programme = await DailyProgramme.findOne({ id: req.params.id });

        if (!programme) {
            return res.status(404).json({ message: 'Programme not found' });
        }

        await DailyProgramme.deleteOne({ id: req.params.id });

        await invalidateProgrammesCache();
        res.status(200).json({ message: 'Programme deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Clear all programmes for a date
// @route   DELETE /api/daily-programmes/date/:date
// @access  Private
const clearProgrammesByDate = async (req, res) => {
    try {
        const { date } = req.params;
        const { start, end } = getDayRange(date);

        const result = await DailyProgramme.deleteMany({
            date: { $gte: start, $lte: end }
        });

        await createAuditLog(req.user, 'clear', 'daily_programmes', date, {
            deleted: result.deletedCount
        });

        await invalidateProgrammesCache();
        res.status(200).json({
            message: `Cleared ${result.deletedCount} programmes for ${date}`
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get available dates with programmes
// @route   GET /api/daily-programmes/dates
// @access  Private
const getAvailableDates = async (req, res) => {
    try {
        const dates = await DailyProgramme.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: -1 } },
            { $limit: 100 }
        ]);

        res.status(200).json(dates.map(d => ({ date: d._id, count: d.count })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
/* ─── Periscope .docx parser ─── */
const mammoth = require('mammoth');

// Category header patterns (matches the section dividers in Periscope docs)
const CATEGORY_PATTERNS = [
    { key: 'category1', regex: /Government\s+Programmes|CM\/Governor|Central\s+Minister/i },
    { key: 'category2', regex: /Other\s+Programmes/i },
    { key: 'category3', regex: /Religious\s+Programmes/i },
    { key: 'category4', regex: /Ongoing\s+Programmes/i },
];

/**
 * Strip HTML tags and decode entities, keeping newlines for multi-paragraph cells.
 */
const stripHtml = (html) => {
    return (html || '')
        .replace(/<\/p>\s*<p>/gi, '\n')            // paragraph breaks → newline
        .replace(/<\/li>\s*<li>/gi, '\n')           // list item breaks → newline
        .replace(/<br\s*\/?>/gi, '\n')              // <br> → newline
        .replace(/<[^>]+>/g, '')                    // strip all tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')                // collapse excess newlines
        .trim();
};

const normalizePermission = (raw) => {
    const lower = (raw || '').toLowerCase().trim();
    if (lower.includes('permitted') && !lower.includes('applied')) return 'Permitted';
    if (lower.includes('rejected')) return 'Rejected';
    if (lower.includes('applied')) return 'Applied for Permission';
    return 'By Information';
};

/**
 * Parse expected-members string that may contain ranges (e.g. "3000-4000") or
 * non-numeric characters. Returns the highest number found.
 */
const parseExpectedMembers = (raw) => {
    const str = String(raw || '0');
    // Find all number sequences
    const numbers = str.match(/\d+/g);
    if (!numbers || numbers.length === 0) return 0;
    // Return the maximum (handles "3000-4000" → 4000)
    return Math.max(...numbers.map(Number));
};

/**
 * Normalize zone text: fix newline-joined words like "Charminar\nZone" → "Charminar Zone",
 * "Jubilee Hills\nZone" → "Jubilee Hills Zone", "Sec-bad\nZone" → "Sec-bad Zone".
 */
const normalizeZone = (raw) => {
    return (raw || '')
        .replace(/\r?\n/g, ' ')               // newlines → space
        .replace(/\s{2,}/g, ' ')               // collapse multiple spaces
        .replace(/([a-z])Zone/gi, '$1 Zone')   // fix glued "CharminarZone"
        .trim();
};

/**
 * Parse Periscope .docx buffer into structured programme entries.
 *
 * Mammoth renders the docx as HTML with <table><tr><td> structure.
 * Category header rows are full-width merged rows (1 cell or all cells identical).
 * Data rows from mammoth typically have 9 cells (colspan merges slNo+zone, and
 * location columns):
 *   [zone, programName, location, organizer, expectedMembers, time, gist, permission, comments]
 *
 * Rows with 10+ cells include an explicit slNo first column.
 */
const parsePeriscopeDocx = async (buffer) => {
    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value;

    const programmes = { category1: [], category2: [], category3: [], category4: [] };
    const categoryLabels = {};
    let currentCategory = null;

    // Extract all <tr>...</tr> rows
    const rowRegex = /<tr>(.*?)<\/tr>/gs;
    const rows = [];
    let m;
    while ((m = rowRegex.exec(html)) !== null) {
        rows.push(m[1]);
    }

    let globalSlNo = 0;

    for (let ri = 0; ri < rows.length; ri++) {
        const rowHtml = rows[ri];

        // Extract cells from this row
        const cellRegex = /<td(?:\s[^>]*)?>(.+?)<\/td>/gs;
        const cells = [];
        let cm;
        while ((cm = cellRegex.exec(rowHtml)) !== null) {
            cells.push(stripHtml(cm[1]));
        }

        if (cells.length === 0) continue;

        // ── Detect category header rows ──
        // Header rows have either 1 cell, or all cells are identical text (merged colspan).
        const isHeaderRow = cells.length === 1 ||
            (cells.length > 1 && cells.every(c => c === cells[0]));

        if (isHeaderRow) {
            const text = cells[0] || '';
            for (const { key, regex } of CATEGORY_PATTERNS) {
                if (regex.test(text)) {
                    const label = text.replace(/\s*[-–—]\s*\d+\s*$/, '').trim();
                    currentCategory = key;
                    categoryLabels[key] = label;
                    break;
                }
            }
            continue;
        }

        // ── Skip table column-header row ──
        const joined = cells.join(' ').toLowerCase();
        if (joined.includes('sl.') && (joined.includes('zones') || joined.includes('programme'))) {
            continue;
        }

        // Skip if no category active yet
        if (!currentCategory) continue;

        // Skip rows with too few meaningful cells
        const nonEmptyCells = cells.filter(c => c.trim().length > 0);
        if (nonEmptyCells.length < 3) continue;

        globalSlNo++;

        // ── Map cells to fields based on cell count ──
        let zone, programName, location, organizer, expectedMembers, time, gist, permission, comments;

        if (cells.length >= 10) {
            // 10+ cells: includes explicit slNo in cell 0
            zone = cells[1] || '';
            programName = cells[2] || '';
            location = cells[3] || '';
            organizer = cells[4] || '';
            expectedMembers = parseExpectedMembers(cells[5]);
            time = cells[6] || '';
            gist = cells[7] || '';
            permission = normalizePermission(cells[8] || '');
            comments = cells[9] || 'Required L&O and Traffic BB';
        } else {
            // 9 or fewer cells: mammoth merged slNo column away
            // [zone, programName, location, organizer, expectedMembers, time, gist, permission, comments]
            zone = cells[0] || '';
            programName = cells[1] || '';
            location = cells[2] || '';
            organizer = cells[3] || '';
            expectedMembers = parseExpectedMembers(cells[4]);
            time = cells[5] || '';
            gist = cells[6] || '';
            permission = normalizePermission(cells[7] || '');
            comments = cells[8] || 'Required L&O and Traffic BB';
        }

        // Clean up zone name (fix newline-joined words)
        zone = normalizeZone(zone);

        programmes[currentCategory].push({
            slNo: globalSlNo,
            zone, programName, location, organizer,
            expectedMembers, time, gist, permission, comments,
            category: currentCategory,
        });
    }

    return { programmes, categoryLabels };
};

/**
 * Build the "ABSTRACT OF PROGRAMMES" summary from parsed data.
 * Groups programmes by programName within each category and counts them.
 */
const buildAbstract = (programmes, categoryLabels) => {
    const abstract = [];
    let totalProgrammes = 0;

    for (const [catKey, entries] of Object.entries(programmes)) {
        if (!entries || entries.length === 0) {
            // Still include the category with 0
            abstract.push({
                categoryKey: catKey,
                categoryLabel: categoryLabels[catKey] || catKey,
                totalCount: 0,
                items: []
            });
            continue;
        }

        // Group by programName
        const nameMap = {};
        entries.forEach(e => {
            const name = (e.programName || 'Unknown').trim();
            nameMap[name] = (nameMap[name] || 0) + 1;
        });

        const items = Object.entries(nameMap).map(([name, count]) => ({ name, count }));
        totalProgrammes += entries.length;

        abstract.push({
            categoryKey: catKey,
            categoryLabel: categoryLabels[catKey] || catKey,
            totalCount: entries.length,
            items
        });
    }

    return { abstract, totalProgrammes };
};

// @desc    Upload & parse Periscope .docx, save to DB + S3
// @route   POST /api/daily-programmes/upload-periscope
// @access  Private (multer middleware provides req.file)
const uploadPeriscope = async (req, res) => {
    try {
        const { date } = req.body;

        if (!date) {
            return res.status(400).json({ message: 'date is required' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Please upload a .docx file' });
        }

        const { programmes, categoryLabels } = await parsePeriscopeDocx(req.file.buffer);

        const totalEntries = Object.values(programmes).reduce((sum, arr) => sum + arr.length, 0);
        if (totalEntries === 0) {
            return res.status(400).json({
                message: 'Could not parse any entries from the uploaded document. Make sure it is a valid Periscope .docx file with a table.'
            });
        }

        const { start, end } = getDayRange(date);

        // Delete existing programmes for this date
        await DailyProgramme.deleteMany({ date: { $gte: start, $lte: end } });

        // Prepare and insert
        const programmeDate = new Date(date);
        programmeDate.setHours(12, 0, 0, 0);
        const createdBy = req.user?.email || req.user?.id || 'system';

        const allProgrammes = [];
        Object.keys(programmes).forEach(category => {
            const label = categoryLabels[category] || '';
            programmes[category].forEach((p, index) => {
                allProgrammes.push({
                    date: programmeDate,
                    category,
                    categoryLabel: label,
                    slNo: p.slNo || index + 1,
                    zone: p.zone,
                    programName: p.programName,
                    location: p.location,
                    organizer: p.organizer,
                    expectedMembers: p.expectedMembers,
                    time: p.time,
                    gist: p.gist,
                    permission: p.permission,
                    comments: p.comments,
                    createdBy
                });
            });
        });

        const created = await DailyProgramme.insertMany(allProgrammes);

        // ── Build abstract summary ──
        const { abstract, totalProgrammes } = buildAbstract(programmes, categoryLabels);

        // ── Upload original DOCX to S3 ──
        let s3Info = null;
        try {
            s3Info = await uploadPeriscopeToS3(
                req.file.buffer,
                date,
                req.file.originalname || `Periscope_${date}.docx`
            );
        } catch (s3Err) {
            console.error('[Periscope] S3 upload failed (non-fatal):', s3Err.message);
        }

        // ── Store / update upload metadata ──
        if (s3Info) {
            await PeriscopeUpload.findOneAndUpdate(
                { date: programmeDate },
                {
                    date: programmeDate,
                    originalFilename: req.file.originalname || `Periscope_${date}.docx`,
                    s3Key: s3Info.key,
                    s3Url: s3Info.url,
                    fileSizeBytes: req.file.buffer.length,
                    abstract,
                    totalProgrammes,
                    uploadedBy: createdBy,
                    createdAt: new Date()
                },
                { upsert: true, new: true }
            );
        }

        await createAuditLog(req.user, 'upload_periscope', 'daily_programmes', date, {
            count: created.length,
            categories: Object.fromEntries(
                Object.entries(programmes).map(([k, v]) => [k, v.length])
            ),
            s3Key: s3Info?.key || null
        });

        res.status(201).json({
            message: `Parsed and saved ${created.length} programmes for ${date}`,
            count: created.length,
            breakdown: {
                category1: programmes.category1.length,
                category2: programmes.category2.length,
                category3: programmes.category3.length,
                category4: programmes.category4.length,
            },
            categoryLabels,
            abstract,
            totalProgrammes,
            hasOriginalDoc: !!s3Info,
        });
    } catch (error) {
        console.error('Error uploading periscope:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get upload info for a date (abstract, S3 availability)
// @route   GET /api/daily-programmes/upload-info?date=YYYY-MM-DD
// @access  Private
const getPeriscopeUploadInfo = async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ message: 'date query parameter is required' });
        }

        const programmeDate = new Date(date);
        programmeDate.setHours(12, 0, 0, 0);

        const upload = await PeriscopeUpload.findOne({ date: programmeDate });
        if (!upload) {
            return res.status(200).json({ hasUpload: false });
        }

        res.status(200).json({
            hasUpload: true,
            originalFilename: upload.originalFilename,
            fileSizeBytes: upload.fileSizeBytes,
            abstract: upload.abstract,
            totalProgrammes: upload.totalProgrammes,
            uploadedBy: upload.uploadedBy,
            uploadedAt: upload.createdAt,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Download original Periscope DOCX from S3
// @route   GET /api/daily-programmes/download-periscope?date=YYYY-MM-DD
// @access  Private
const downloadPeriscopeDoc = async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ message: 'date query parameter is required' });
        }

        const programmeDate = new Date(date);
        programmeDate.setHours(12, 0, 0, 0);

        const upload = await PeriscopeUpload.findOne({ date: programmeDate });
        if (!upload || !upload.s3Key) {
            return res.status(404).json({ message: 'No original document found for this date' });
        }

        const downloadUrl = await getPeriscopeDownloadUrl(upload.s3Key);
        res.status(200).json({
            downloadUrl,
            originalFilename: upload.originalFilename,
        });
    } catch (error) {
        console.error('Error getting download URL:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
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
};

