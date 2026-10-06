const reportService = require('../services/intelligenceReportService');

const parseFilters = (query) => ({
  startDate:      query.startDate      || null,
  endDate:        query.endDate        || null,
  platform:       query.platform       || null,
  status:         query.status         || 'active',
  sentiment:      query.sentiment      || null,
  grievance_type: query.grievance_type || null,
  category:       query.category       || null,
  search:         query.search         || null,
  viewMode:       query.viewMode       || 'all',
  limit:          parseInt(query.limit) || 100
});

const sendPdf = (res, buffer, filename) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
};

/**
 * GET /api/intelligence-reports/alerts/pdf
 * Query params: startDate, endDate, platform, status
 */
exports.alertsPdf = async (req, res) => {
  try {
    const filters = { ...parseFilters(req.query), scope: req.scope };
    const pdfBuffer = await reportService.generateAlertsPdf(filters);
    const date = new Date().toISOString().slice(0, 10);
    sendPdf(res, pdfBuffer, `alerts_report_${date}.pdf`);
  } catch (err) {
    console.error('[IntelligenceReport] Alerts PDF error:', err.message);
    res.status(500).json({ error: 'Failed to generate alerts report', details: err.message });
  }
};

/**
 * GET /api/intelligence-reports/grievances/pdf
 * Query params: startDate, endDate, platform, limit (default 100)
 */
exports.grievancesPdf = async (req, res) => {
  try {
    const filters = { ...parseFilters(req.query), scope: req.scope };
    const pdfBuffer = await reportService.generateGrievancesPdf(filters);
    const date = new Date().toISOString().slice(0, 10);
    sendPdf(res, pdfBuffer, `grievances_report_${date}.pdf`);
  } catch (err) {
    console.error('[IntelligenceReport] Grievances PDF error:', err.message);
    res.status(500).json({ error: 'Failed to generate grievances report', details: err.message });
  }
};