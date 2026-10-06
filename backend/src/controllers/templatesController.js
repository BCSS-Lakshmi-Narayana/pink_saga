const Template = require('../models/Template');
const Report = require('../models/Report');
const Alert = require('../models/Alert');
const Content = require('../models/Content');
const Settings = require('../models/Settings');
const templateService = require('../services/templateService');
const { format } = require('date-fns');

/**
 * Parse DOCX file to HTML
 * POST /api/templates/parse
 */
const parseTemplate = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const html = await templateService.parseDocxToHtml(req.file.buffer);
        res.json({ html });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Upload and save template
 * POST /api/templates/upload
 */
const uploadTemplate = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { name, platform = 'all', is_default = false } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Template name is required' });
        }

        const html = await templateService.parseDocxToHtml(req.file.buffer);

        // If setting as default, unset other defaults for this platform
        if (is_default) {
            await Template.updateMany(
                { platform },
                { is_default: false }
            );
        }

        const template = await Template.create({
            name: name.trim(),
            platform,
            html_content: html,
            is_default: is_default === 'true' || is_default === true,
            created_by: req.user?.id
        });

        res.status(201).json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get all templates
 * GET /api/templates
 */
const getTemplates = async (req, res) => {
    try {
        const templates = await Template.find().sort({ created_at: -1 });
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get single template
 * GET /api/templates/:id
 */
const getTemplate = async (req, res) => {
    try {
        const template = await Template.findOne({ id: req.params.id });
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Update template content
 * PUT /api/templates/:id/content
 */
const updateTemplateContent = async (req, res) => {
    try {
        const { html_content } = req.body;

        if (!html_content) {
            return res.status(400).json({ error: 'HTML content is required' });
        }

        const template = await Template.findOneAndUpdate(
            { id: req.params.id },
            { html_content, updated_at: new Date() },
            { new: true }
        );

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Set template as default for a platform
 * PUT /api/templates/:id/default
 */
const setDefaultTemplate = async (req, res) => {
    try {
        const template = await Template.findOne({ id: req.params.id });
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Unset all other defaults for this platform
        await Template.updateMany(
            { platform: template.platform },
            { is_default: false }
        );

        // Set this one as default
        const updated = await Template.findOneAndUpdate(
            { id: req.params.id },
            { is_default: true, updated_at: new Date() },
            { new: true }
        );

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Delete template
 * DELETE /api/templates/:id
 */
const deleteTemplate = async (req, res) => {
    try {
        const template = await Template.findOneAndDelete({ id: req.params.id });
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json({ message: 'Template deleted', id: req.params.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Preview template with interpolation placeholders replaced
 * POST /api/templates/:id/preview
 */
const previewTemplate = async (req, res) => {
    try {
        const template = await Template.findOne({ id: req.params.id });
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Return template HTML for preview
        // The frontend will remove placeholder code and show actual content
        res.json({ 
            html: template.html_content,
            name: template.name
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Generate template with report data interpolation
 * POST /api/templates/:templateId/generate/:alertId
 */
const generateTemplate = async (req, res) => {
    try {
        // Get template and alert
        const template = await Template.findOne({ id: req.params.templateId });
        const alert = await Alert.findOne({ id: req.params.alertId });

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        // Get report, content, and settings
        const report = await Report.findOne({ alert_id: alert.id });
        const content = await Content.findOne({ id: alert.content_id });
        const settings = await Settings.findOne({ id: 'global_settings' });

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (!content) {
            return res.status(404).json({ error: 'Content not found' });
        }

        // Build platform metadata
        const platformMap = {
            x: { name: 'X', operator: 'X Corp.', domain: 'www.x.com' },
            youtube: { name: 'YouTube', operator: 'Google LLC', domain: 'www.youtube.com' },
            facebook: { name: 'Facebook', operator: 'Meta Platforms Inc.', domain: 'www.facebook.com' },
            instagram: { name: 'Instagram', operator: 'Meta Platforms Inc.', domain: 'www.instagram.com' }
        };

        const platformData = platformMap[report.platform] || platformMap.x;

        // Format dates
        const now = new Date();
        const dateFormatted = format(now, 'dd.MM.yyyy');
        const dateLong = format(now, 'do MMMM yyyy');

        // Sections list for subject
        const sectionsFullList = alert.legal_sections?.length > 0
            ? alert.legal_sections.map(s => s.section).join(', ')
            : '505, 353, 153A, 196';

        // Build legal sections strings
        const legalSections = alert.legal_sections?.length > 0 
            ? alert.legal_sections 
            : [
                { section: '352', act: 'BNS 2023', description: 'Intentional insult with intent to provoke breach of peace.' },
                { section: '196', act: 'BNS 2023', description: 'Promoting enmity / acts prejudicial to maintenance of harmony.' },
                { section: '351', act: 'BNS 2023', description: 'Criminal intimidation (threatening to cause injury).' }
            ];

        const legalSectionsText = legalSections
            .map(s => `Section ${s.section} ${s.act || 'BNS'}:\n${s.description}`)
            .join('\n\n') || '';
        const legalNumbersText = legalSections
            .map(s => s.section)
            .join(', ') || '';

        const departmentName = settings?.police_department_name || 'Cyber Crime Police Station, Telangana Police';

        // Build interpolation data
        const interpolationData = {
            SERIAL_NUMBER: report.serial_number || '',
            DATE: dateFormatted,
            DATE_LONG: dateLong,
            PLATFORM: platformData.name,
            PLATFORM_OPERATOR: platformData.operator,
            PLATFORM_DOMAIN: platformData.domain,
            AUTHOR_NAME: report.target_user_details?.name || alert.author || '',
            AUTHOR_HANDLE: (report.target_user_details?.handle || alert.author_handle || alert.author || '').startsWith('@') 
                ? (report.target_user_details?.handle || alert.author_handle || alert.author)
                : `@${report.target_user_details?.handle || alert.author_handle || alert.author || ''}`,
            PROFILE_URL: report.target_user_details?.profile_url || '',
            CONTENT_URL: content.content_url || alert.content_url || '',
            CONTENT_TEXT: content.text || alert.description || '',
            POST_DATE: content.posted_at ? format(new Date(content.posted_at), 'dd.MM.yyyy') : (alert.created_at ? format(new Date(alert.created_at), 'dd.MM.yyyy') : ''),
            LEGAL_SECTIONS: legalSectionsText,
            LEGAL_SECTIONS_NUMBERS: legalNumbersText,
            LEGAL_SECTIONS_LIST: sectionsFullList,
            CATEGORY: alert.threat_details?.intent || alert.alert_type || '',
            RISK_LEVEL: alert.risk_level?.toUpperCase() || '',
            IS_REPOST: (alert.is_repost || content.is_repost) ? 'Yes' : 'No',
            ALERT_DESCRIPTION: alert.description || alert.title || '',
            DEPARTMENT_NAME: departmentName,
            GOVERNMENT_NAME: settings?.government_name || 'Government of Telangana',
            SUBJECT: `NOTICE: U/Sec: 69(A) & 79(3) Information Technology Amendment Act 2008 and 94 BNSS of India. (Cr.No ${report.serial_number?.split(' ')[0] || '11/2026'}, U/Sec ${sectionsFullList} of BNS of ${departmentName})`,
            RECIPIENT_BLOCK: `${platformData.operator}\nc/o Trust & Safety - Legal Policy\n${platformData.name === 'X' ? '1355 Market Street, Suite 900\nSan Francisco, CA 94103' : '1601 Willow Road\nMenlo Park, CA 94025'}`,
            SIGNATURE_BLOCK: `Inspector of Police,\n${departmentName}\nTELANGANA.`
        };

        // Interpolate template
        let html = template.html_content;

        // Replace all {{PLACEHOLDER}} patterns with actual values
        for (const [key, value] of Object.entries(interpolationData)) {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            html = html.replace(regex, String(value || ''));
        }

        res.json({ html });
    } catch (error) {
        console.error('Generate template error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    parseTemplate,
    uploadTemplate,
    getTemplates,
    getTemplate,
    updateTemplateContent,
    setDefaultTemplate,
    deleteTemplate,
    previewTemplate,
    generateTemplate
};
