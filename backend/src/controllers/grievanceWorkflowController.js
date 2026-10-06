const GrievanceWorkflowReport = require('../models/GrievanceWorkflowReport');
const CriticismContact = require('../models/CriticismContact'); // reuse same contacts
const Grievance = require('../models/Grievance');
const { generateGrievanceWorkflowCode } = require('../services/grievanceWorkflowCodeService');
const { archiveContentMedia } = require('../services/contentS3Service');
const ExcelJS = require('exceljs');

/* ─── Helpers ─── */
const getUser = (req) => ({
  user_id: req.user?.id,
  email: req.user?.email,
  name: req.user?.full_name || req.user?.name || req.user?.email
});

const dedupeMediaItems = (items = []) => {
  const map = new Map();
  for (const item of items) {
    const url = item?.video_url || item?.url || item?.preview || item?.preview_url;
    if (!url) continue;
    if (!map.has(url)) {
      map.set(url, {
        type: item?.type || 'photo',
        url: item?.url || item?.video_url || url,
        video_url: item?.video_url || null,
        preview: item?.preview || item?.preview_url || null,
        preview_url: item?.preview_url || item?.preview || null
      });
    }
  }
  return Array.from(map.values());
};

const buildStatusFilter = (rawStatus) => {
  const normalized = String(rawStatus || '').trim().toUpperCase();

  // Use regex for case-insensitive + whitespace-flexible matching
  if (normalized === 'PENDING') {
    // Correctly matches explicit "PENDING" case-insensitive AND null/missing status values
    // by excluding everything that is Escalated or Closed.
    return { status: { $nin: [/^\s*(escalated|escaled)\s*$/i, /^\s*closed\s*$/i] } };
  }
  if (normalized === 'ESCALATED') {
    return { status: { $regex: /^\s*(escalated|escaled)\s*$/i } };
  }
  if (normalized === 'CLOSED') {
    return { status: { $regex: /^\s*closed\s*$/i } };
  }

  // Fallback for unknown status
  return { status: normalized };
};

const extractMediaFromGrievance = (grievance) => {
  const lists = [
    grievance?.content?.media,
    grievance?.context?.content?.media,
    grievance?.context?.quoted?.content?.media,
    grievance?.context?.in_reply_to?.content?.media,
    grievance?.context?.reposted_from?.content?.media,
    grievance?.context?.parent?.content?.media,
    grievance?.context?.thread_parent?.content?.media
  ];
  return dedupeMediaItems(lists.flatMap((arr) => (Array.isArray(arr) ? arr : [])));
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*              GRIEVANCE WORKFLOW REPORT – CREATE (Proceed)        */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const createReport = async (req, res) => {
  try {
    const {
      grievance_id, remarks, message, platform,
      profile_id, profile_link, post_link, post_date,
      post_description, posted_by, engagement,
      media_urls, media_items, media_s3_urls,
      complaint_phone, category
    } = req.body;

    if (!grievance_id) return res.status(400).json({ error: 'grievance_id is required' });

    const grievanceDoc = await Grievance.findOne({ id: grievance_id });
    if (!grievanceDoc) return res.status(404).json({ error: 'Grievance not found' });

    // Re-use existing report for same grievance
    const existing = await GrievanceWorkflowReport.findOne({ grievance_id });
    const unique_code = existing?.unique_code || await generateGrievanceWorkflowCode(platform || grievanceDoc.platform || 'x');

    // Collect & archive media
    const payloadMedia = dedupeMediaItems(Array.isArray(media_items) ? media_items : []);
    const grievanceMedia = extractMediaFromGrievance(grievanceDoc);
    const mediaToArchive = dedupeMediaItems([
      ...payloadMedia,
      ...grievanceMedia,
      ...(Array.isArray(media_urls) ? media_urls.map((url) => ({
        type: /\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/i.test(String(url || '')) ? 'video' : 'photo', url
      })) : [])
    ]);

    let archivedMedia = [];
    try {
      archivedMedia = mediaToArchive.length > 0
        ? await archiveContentMedia(mediaToArchive, grievanceDoc.tweet_id || grievance_id, {
          folder: 'grievance-workflow-content',
          useUniqueFileName: true,
          replaceOriginalUrls: false,
          postUrl: post_link || grievanceDoc.tweet_url
        })
        : [];
    } catch (e) { console.error('Media archive warning:', e.message); }

    const finalOriginalUrls = Array.from(new Set(
      [...dedupeMediaItems(mediaToArchive).map(i => i.video_url || i.url),
      ...dedupeMediaItems(archivedMedia).map(i => i.video_url || i.url)].filter(Boolean)
    ));
    const finalS3Urls = Array.from(new Set([
      ...((Array.isArray(media_s3_urls) ? media_s3_urls : []).filter(Boolean)),
      ...((Array.isArray(archivedMedia) ? archivedMedia : [])
        .flatMap(i => [i?.s3_url, i?.s3_preview]).filter(Boolean))
    ]));

    const payload = {
      grievance_id,
      unique_code,
      platform: platform || grievanceDoc.platform || 'x',
      profile_id: profile_id || grievanceDoc.posted_by?.handle || '',
      profile_link: profile_link || grievanceDoc.posted_by?.profile_url || '',
      post_link: post_link || grievanceDoc.tweet_url || '',
      post_date: post_date || grievanceDoc.post_date || grievanceDoc.created_at || new Date(),
      post_description: post_description || grievanceDoc.content?.full_text || grievanceDoc.content?.text || '',
      posted_by: posted_by || {
        handle: grievanceDoc.posted_by?.handle || '',
        display_name: grievanceDoc.posted_by?.display_name || '',
        profile_image_url: grievanceDoc.posted_by?.profile_image_url || ''
      },
      engagement: engagement || {
        views: grievanceDoc.engagement?.views || 0,
        reposts: grievanceDoc.engagement?.retweets || 0,
        likes: grievanceDoc.engagement?.likes || 0,
        replies: grievanceDoc.engagement?.replies || 0
      },
      complaint_phone: complaint_phone || grievanceDoc.complainant_phone || '',
      category: category || 'Others',
      media_urls: finalOriginalUrls,
      media_s3_urls: finalS3Urls,
      remarks: remarks || '',
      message: message || '',
      status: existing?.status || 'PENDING',
      created_by: existing?.created_by || getUser(req)
    };

    let report;
    let created = false;
    if (existing) {
      // preserve status_history
      payload.status_history = existing.status_history || [];
      report = await GrievanceWorkflowReport.findOneAndUpdate(
        { grievance_id }, { $set: payload }, { new: true }
      );
    } else {
      payload.status_history = [{
        from_status: null,
        to_status: 'PENDING',
        changed_by: getUser(req),
        note: 'Report created',
        timestamp: new Date()
      }];
      report = await GrievanceWorkflowReport.create(payload);
      created = true;
    }

    // Sync back to grievance
    const existingWorkflow = grievanceDoc.grievance_workflow || {};
    const existingInformedTo = (
      existingWorkflow.informed_to && typeof existingWorkflow.informed_to === 'object'
    )
      ? {
        name: existingWorkflow.informed_to.name || '',
        phone: existingWorkflow.informed_to.phone || '',
        department: existingWorkflow.informed_to.department || ''
      }
      : { name: '', phone: '', department: '' };

    grievanceDoc.grievance_workflow = {
      report_id: report.id,
      unique_code: report.unique_code,
      status: report.status,
      category: report.category,
      shared_at: existingWorkflow.shared_at || null,
      informed_to: existingInformedTo
    };
    grievanceDoc.markModified('grievance_workflow');
    await grievanceDoc.save();

    res.status(created ? 201 : 200).json(report);
  } catch (error) {
    console.error('Error creating grievance workflow report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*             SHARE (WhatsApp) → records contact info             */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const shareReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_name, contact_phone, contact_department, set_status, shared_message } = req.body;

    const report = await GrievanceWorkflowReport.findOne({ id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const prevStatus = report.status;
    if (prevStatus === 'CLOSED') {
      return res.status(400).json({ error: 'Closed report cannot be shared' });
    }

    report.informed_to = { name: contact_name || '', phone: contact_phone || '', department: contact_department || '' };
    report.shared_at = new Date();
    report.action_taken_at = new Date();
    report.shared_via = 'whatsapp';

    // If caller explicitly requests ESCALATED (from status change popup), set it
    // Otherwise keep current status (PENDING for initial share from G popup)
    const targetStatus = set_status === 'ESCALATED' ? 'ESCALATED' : prevStatus;
    report.status = targetStatus;
    if (targetStatus === 'ESCALATED') report.escalated_at = new Date();
    if (targetStatus === 'ESCALATED') {
      report.escalation_message = String(shared_message || '').trim();
    }

    report.status_history.push({
      from_status: prevStatus,
      to_status: targetStatus,
      changed_by: getUser(req),
      note: targetStatus === 'ESCALATED'
        ? `Escalated via WhatsApp to ${contact_name || contact_phone}`
        : `Shared via WhatsApp to ${contact_name || contact_phone}`,
      timestamp: new Date()
    });

    await report.save();

    await Grievance.findOneAndUpdate(
      { id: report.grievance_id },
      {
        $set: {
          'grievance_workflow.status': report.status,
          'grievance_workflow.shared_at': report.shared_at,
          'grievance_workflow.informed_to': report.informed_to
        }
      }
    );

    res.json(report);
  } catch (error) {
    console.error('Error sharing grievance workflow report:', error);
    res.status(500).json({ error: 'Failed to share report' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                   CLOSE REPORT                                   */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const closeReport = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      closing_remarks, operator_reply, final_reply_to_user, final_communication,
      fir_status, fir_number, closing_media_urls, closing_media_s3_urls
    } = req.body;

    const report = await GrievanceWorkflowReport.findOne({ id });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status === 'CLOSED') return res.status(400).json({ error: 'Report already closed' });

    const prevStatus = report.status;

    const normalizeUrlList = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)));

    const closingOriginalUrls = normalizeUrlList(closing_media_urls);
    const providedClosingS3Urls = normalizeUrlList(closing_media_s3_urls);

    // Archive external closing media URLs to S3 (if any)
    let archivedClosingS3Urls = [];
    if (Array.isArray(closing_media_urls) && closing_media_urls.length > 0) {
      try {
        const closingMediaItems = closing_media_urls.map(url => ({
          type: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'photo', url
        }));
        const archived = await archiveContentMedia(closingMediaItems, report.grievance_id, {
          folder: 'grievance-workflow-closing',
          useUniqueFileName: true
        });
        archivedClosingS3Urls = archived.flatMap(i => [i?.s3_url, i?.s3_preview]).filter(Boolean);
      } catch (e) { console.error('Closing media archive warning:', e.message); }
    }

    const finalClosingS3Urls = Array.from(new Set([
      ...providedClosingS3Urls,
      ...archivedClosingS3Urls
    ].filter(Boolean)));

    report.status = 'CLOSED';
    report.closed_at = new Date();
    report.closing_remarks = closing_remarks || '';
    report.operator_reply = operator_reply || report.operator_reply || '';
    report.final_reply_to_user = final_reply_to_user || report.final_reply_to_user || '';
    report.final_communication = final_communication || '';
    const normalizedFirStatus = String(fir_status || '').trim();
    const normalizedFirNumber = String(fir_number || '').trim();

    if (normalizedFirStatus === 'Yes' || normalizedFirStatus === 'No') {
      report.fir_status = normalizedFirStatus;
      report.fir_number = normalizedFirStatus === 'Yes' ? normalizedFirNumber : '';
    } else if (/^yes\s*[-:]\s*/i.test(normalizedFirStatus)) {
      report.fir_status = 'Yes';
      report.fir_number = normalizedFirNumber || normalizedFirStatus.replace(/^yes\s*[-:]\s*/i, '').trim();
    } else if (normalizedFirStatus) {
      report.fir_status = 'Yes';
      report.fir_number = normalizedFirNumber || normalizedFirStatus;
    } else {
      report.fir_status = '';
      report.fir_number = '';
    }
    report.closing_media_urls = closingOriginalUrls;
    report.closing_media_s3_urls = finalClosingS3Urls;
    report.status_history.push({
      from_status: prevStatus,
      to_status: 'CLOSED',
      changed_by: getUser(req),
      note: closing_remarks || 'Closed',
      timestamp: new Date()
    });

    await report.save();

    // Sync status to parent Grievance document
    const grievanceUpdate = { 'grievance_workflow.status': 'CLOSED' };
    if (report.fir_status === 'Yes') {
      grievanceUpdate.workflow_status = 'converted_to_fir';
      grievanceUpdate.fir_status = 'Yes';
      grievanceUpdate.fir_number = report.fir_number || '';
      grievanceUpdate.fir_converted_at = new Date();
    }
    await Grievance.findOneAndUpdate(
      { id: report.grievance_id },
      { $set: grievanceUpdate }
    );

    res.json(report);
  } catch (error) {
    console.error('Error closing grievance workflow report:', error);
    res.status(500).json({ error: 'Failed to close report' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                 UPDATE STATUS (dropdown)                        */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const updateReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['PENDING', 'ESCALATED', 'CLOSED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await GrievanceWorkflowReport.findOne({ id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const prevStatus = report.status || 'PENDING';
    if (prevStatus === status) return res.json(report);

    report.status = status;
    if (status === 'CLOSED') report.closed_at = new Date();
    if (status === 'ESCALATED') report.escalated_at = new Date();

    report.status_history.push({
      from_status: prevStatus,
      to_status: status,
      changed_by: getUser(req),
      note: `Status changed from ${prevStatus} to ${status} from grievance card dropdown`,
      timestamp: new Date()
    });

    await report.save();

    await Grievance.findOneAndUpdate(
      { id: report.grievance_id },
      { $set: { 'grievance_workflow.status': status } }
    );

    res.json(report);
  } catch (error) {
    console.error('Error updating grievance workflow status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                       LIST / GET                                 */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const getReports = async (req, res) => {
  try {
    const { page = 1, limit = 50, platform, from, to, status, search, sort = 'created_at', order = 'desc', category } = req.query;
    const query = {};
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (platform && platform !== 'all') query.platform = platform;
    if (category && category !== 'all') query.category = category;
    if (normalizedStatus && normalizedStatus !== 'ALL') {
      if (normalizedStatus === 'FIR') {
        query.fir_status = { $nin: ['', 'No', null] };
      } else {
        Object.assign(query, buildStatusFilter(normalizedStatus));
      }
    }

    if (from || to) {
      query.post_date = {};
      if (from) query.post_date.$gte = new Date(from);
      if (to) {
        const toDateObj = new Date(to);
        toDateObj.setHours(23, 59, 59, 999);
        query.post_date.$lte = toDateObj;
      }
    }

    // Search across multiple fields
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      query.$or = [
        { unique_code: searchRegex },
        { profile_id: searchRegex },
        { post_description: searchRegex },
        { complaint_phone: searchRegex },
        { remarks: searchRegex },
        { category: searchRegex },
        { 'posted_by.display_name': searchRegex },
        { 'posted_by.handle': searchRegex },
        { 'informed_to.name': searchRegex }
      ];
    }

    // Build sort object
    const sortDir = order === 'asc' ? 1 : -1;
    const sortObj = { [sort]: sortDir };

    const total = await GrievanceWorkflowReport.countDocuments(query);
    const reports = await GrievanceWorkflowReport.find(query)
      .sort(sortObj)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    console.log('[getReports] Found', reports.length, 'reports. First report status:', reports[0]?.status);

    const statsQuery = {};
    if (platform && platform !== 'all') statsQuery.platform = platform;
    if (category && category !== 'all') statsQuery.category = category;
    if (from || to) {
      statsQuery.post_date = {};
      if (from) statsQuery.post_date.$gte = new Date(from);
      if (to) {
        const toDateObj = new Date(to);
        toDateObj.setHours(23, 59, 59, 999);
        statsQuery.post_date.$lte = toDateObj;
      }
    }
    // Note: search term is not typically applied to high-level stats cards unless we specifically want it to shrink.
    // However, the user asked to "select any category it should have to show how many are there in that category and outoff all",
    // and the filters to perfectly match the table records. We will include search just in case.
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      statsQuery.$or = [
        { unique_code: searchRegex },
        { profile_id: searchRegex },
        { post_description: searchRegex },
        { complaint_phone: searchRegex },
        { remarks: searchRegex },
        { category: searchRegex },
        { 'posted_by.display_name': searchRegex },
        { 'posted_by.handle': searchRegex },
        { 'informed_to.name': searchRegex }
      ];
    }

    const [statsTotal, pending, escalated, closed, fir] = await Promise.all([
      GrievanceWorkflowReport.countDocuments(statsQuery),
      GrievanceWorkflowReport.countDocuments({ ...statsQuery, ...buildStatusFilter('PENDING') }),
      GrievanceWorkflowReport.countDocuments({ ...statsQuery, ...buildStatusFilter('ESCALATED') }),
      GrievanceWorkflowReport.countDocuments({ ...statsQuery, ...buildStatusFilter('CLOSED') }),
      GrievanceWorkflowReport.countDocuments({ ...statsQuery, fir_status: { $nin: ['', 'No', null] } })
    ]);

    res.json({
      reports,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
      stats: { total: statsTotal, pending, escalated, closed, fir }
    });
  } catch (error) {
    console.error('Error fetching grievance workflow reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
};

const getReport = async (req, res) => {
  try {
    const report = await GrievanceWorkflowReport.findOne({ id: req.params.id }).lean();
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                    EXCEL EXPORT                                  */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const exportReports = async (req, res) => {
  try {
    const { platform, from, to, status } = req.query;
    const query = {};
    const normalizedStatus = String(status || '').trim().toUpperCase();
    if (platform && platform !== 'all') query.platform = platform;
    if (normalizedStatus && normalizedStatus !== 'ALL') {
      if (normalizedStatus === 'FIR') {
        query.fir_status = { $nin: ['', 'No', null] };
      } else {
        Object.assign(query, buildStatusFilter(normalizedStatus));
      }
    }
    if (from || to) {
      query.post_date = {};
      if (from) query.post_date.$gte = new Date(from);
      if (to) {
        const toDateObj = new Date(to);
        toDateObj.setHours(23, 59, 59, 999);
        query.post_date.$lte = toDateObj;
      }
    }

    const reports = await GrievanceWorkflowReport.find(query).sort({ created_at: -1 }).lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SANKET';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Grievance Workflow Reports');
    sheet.columns = [
      { header: 'SI.NO', key: 'sno', width: 8 },
      { header: 'Post Date & Time', key: 'post_date', width: 22 },
      { header: 'Mobile Number', key: 'complaint_phone', width: 18 },
      { header: 'Profile ID', key: 'profile', width: 30 },
      { header: 'Post Link', key: 'post_link', width: 40 },
      { header: 'Post Description', key: 'post_description', width: 50 },
      { header: 'Media URLs', key: 'media', width: 40 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Operator Remarks to Officer', key: 'remarks', width: 40 },
      { header: 'Sent To', key: 'sent_to', width: 28 },
      { header: 'Date & Time (Action)', key: 'action_date', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Operator Reply to User', key: 'operator_reply', width: 40 },
      { header: 'Final Reply to User', key: 'final_reply', width: 40 },
      { header: 'Closing Remarks', key: 'closing_remarks', width: 38 },
      { header: 'Closing Attachment URLs', key: 'closing_media', width: 55 },
      { header: 'Final Communication to User', key: 'final_comm', width: 40 },
      { header: 'FIR', key: 'fir', width: 18 },
      { header: 'Complainant Conversation', key: 'complainant_conv', width: 60 },
      { header: 'Officer Feedback', key: 'officer_conv', width: 60 },
      { header: 'Unique ID', key: 'unique_code', width: 22 }
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

    const fmtDate = (d) => {
      if (!d) return '';
      try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
    };

    reports.forEach((r, i) => {
      const mediaUrls = (Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0 ? r.media_s3_urls : (r.media_urls || []));
      const closingMediaUrls = (Array.isArray(r.closing_media_s3_urls) && r.closing_media_s3_urls.length > 0
        ? r.closing_media_s3_urls
        : (r.closing_media_urls || []));

      sheet.addRow({
        sno: i + 1,
        post_date: fmtDate(r.post_date),
        complaint_phone: r.complaint_phone || '',
        profile: r.profile_link || r.profile_id || '',
        post_link: r.post_link || '',
        post_description: r.post_description || '',
        media: mediaUrls.join('\n'),
        category: r.category || '',
        remarks: r.remarks || '',
        sent_to: r.informed_to ? `${r.informed_to.name || ''} (${r.informed_to.phone || ''})` : '',
        action_date: fmtDate(r.action_taken_at || r.escalated_at),
        status: r.status || 'PENDING',
        operator_reply: r.operator_reply || '',
        final_reply: r.final_reply_to_user || '',
        closing_remarks: r.closing_remarks || '',
        closing_media: closingMediaUrls.join('\n'),
        final_comm: r.final_communication || '',
        fir: r.fir_status || '',
        complainant_conv: (r.complainant_logs || []).map(log =>
          `[${fmtDate(log.timestamp)} - ${log.mode} - ${log.type}] ${log.content}`
        ).join('\n---\n'),
        officer_conv: (r.officer_logs || []).map(log =>
          `[${fmtDate(log.timestamp)} - ${log.mode}] ${log.content}`
        ).join('\n---\n'),
        unique_code: r.unique_code || ''
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=grievance_workflow_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting grievance workflow reports:', error);
    res.status(500).json({ error: 'Failed to export reports' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*           CONTACTS (reuse criticism contacts)                    */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const getContacts = async (req, res) => {
  try {
    const contacts = await CriticismContact.find({ is_active: true }).sort({ name: 1 }).lean();
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
};

const updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { complainant_logs, officer_logs } = req.body;

    const report = await GrievanceWorkflowReport.findOne({ id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (complainant_logs) report.complainant_logs = complainant_logs;
    if (officer_logs) report.officer_logs = officer_logs;

    await report.save();

    res.json(report);
  } catch (error) {
    console.error('Error updating grievance report details:', error);
    res.status(500).json({ error: 'Failed to update report details' });
  }
};

/* ─────────────────────────────────────────────────────────────────
   PDF GENERATION  –  POST /reports/:id/generate-pdf
   Uses Puppeteer to render an HTML snapshot of the report,
   uploads the PDF to S3, and saves the URL on the record.
───────────────────────────────────────────────────────────────── */
const generateReportPdf = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { id }, { unique_code: id }] }
      : { $or: [{ id }, { unique_code: id }] };

    const report = await GrievanceWorkflowReport.findOne(query).lean();

    if (!report) return res.status(404).json({ error: 'Report not found' });

    // ── Prepare final PDF URL up front so QR in generated PDF can point to this file ──
    const region = process.env.AWS_REGION || 'eu-north-1';
    const bucket = process.env.AWS_BUCKET_NAME;
    const folder = process.env.AWS_S3_FOLDER || 'uploads';
    const key = `${folder}/grievance-reports/${report.unique_code || report.id}-${Date.now()}.pdf`;
    const finalPdfUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    // ── Build self-contained HTML for the report ──
    const html = buildReportHtml(
      { ...report, report_pdf_url: report.report_pdf_url || finalPdfUrl },
      { pdfUrl: finalPdfUrl }
    );

    // ── Render with Puppeteer ──
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' }
    });
    await browser.close();

    // ── Upload to S3 ──
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${report.unique_code || report.id}.pdf"`
    }));

    // ── Save URL to record ──
    await GrievanceWorkflowReport.updateOne(
      { _id: report._id },
      { $set: { report_pdf_url: finalPdfUrl, report_pdf_generated_at: new Date() } }
    );

    return res.json({ pdf_url: finalPdfUrl });
  } catch (err) {
    console.error('PDF generation error:', err);
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
};

/* ─── HTML template for PDF ─── */
const fmtDateHtml = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
};

const buildQrImageUrl = (value, size = 120) => {
  if (!value) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&format=png&data=${encodeURIComponent(value)}`;
};

const buildReportHtml = (r, options = {}) => {
  const allLogs = [
    ...(r.complainant_logs || []).map(l => ({ ...l, _src: 'complainant' })),
    ...(r.officer_logs || []).map(l => ({ ...l, _src: 'officer' }))
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dash = v => v || '—';
  const effectivePdfUrl = options.pdfUrl || r.report_pdf_url || '';
  const postQrImageUrl = buildQrImageUrl(r.post_link, 120);
  const pdfQrImageUrl = buildQrImageUrl(effectivePdfUrl, 120);

  const logRows = allLogs.map(l => {
    let role = 'User', bg = '#fff7ed', border = '#fed7aa', roleColor = '#ea580c';
    const opName = l.operator?.name || 'Operator';
    const recName = l.recipient?.name || r.informed_to?.name || 'Officer';
    const recPhone = l.recipient?.phone || r.informed_to?.phone || '';
    let toFrom = '';
    if (l._src === 'officer' && l.is_escalation) {
      role = 'Escalation'; bg = '#fef2f2'; border = '#fecaca'; roleColor = '#dc2626';
      toFrom = `Operator (${opName}) → Officer (${recName}${recPhone ? ' · ' + recPhone : ''})`;
    } else if (l._src === 'officer') {
      role = 'Operator→Officer'; bg = '#eff6ff'; border = '#bfdbfe'; roleColor = '#2563eb';
      toFrom = `Operator (${opName}) → Officer (${recName}${recPhone ? ' · ' + recPhone : ''})`;
    } else if (l.type === 'OperatorRemark') {
      role = 'Operator Note'; bg = '#fffbeb'; border = '#fde68a'; roleColor = '#d97706';
      toFrom = `Operator (${opName}) — Internal`;
    } else if (l.type === 'Operator') {
      role = 'Operator→User'; bg = '#f0fdf4'; border = '#bbf7d0'; roleColor = '#16a34a';
      toFrom = `Operator (${opName}) → User`;
    } else {
      toFrom = r.posted_by?.display_name || r.profile_id || 'User';
    }
    return `<tr style="background:${bg}">
      <td style="padding:6px 8px;border:1px solid ${border};border-radius:4px;white-space:nowrap;vertical-align:top">
        <span style="color:${roleColor};font-weight:700;font-size:9px;text-transform:uppercase">${role}</span><br/>
        <span style="font-size:9px;color:#64748b">${esc(toFrom)}</span>
      </td>
      <td style="padding:6px 8px;border:1px solid ${border};font-size:9px;color:#475569;white-space:nowrap;vertical-align:top">${esc(l.mode || '—')}</td>
      <td style="padding:6px 8px;border:1px solid ${border};font-size:10px;color:#1e293b;white-space:pre-wrap;vertical-align:top">${esc(l.content)}</td>
      <td style="padding:6px 8px;border:1px solid ${border};font-size:9px;color:#64748b;white-space:nowrap;vertical-align:top">${fmtDateHtml(l.timestamp)}</td>
    </tr>`;
  }).join('<tr><td colspan="4" style="padding:2px"></td></tr>');

  const statusColor = r.status === 'CLOSED' ? '#16a34a' : r.status === 'ESCALATED' ? '#ea580c' : '#ca8a04';
  const statusBg = r.status === 'CLOSED' ? '#f0fdf4' : r.status === 'ESCALATED' ? '#fff7ed' : '#fefce8';

  const officerLogs = (r.officer_logs || []);
  const firstOfficerLog = officerLogs[0];
  const escalationLog = officerLogs.find(l => l.is_escalation);

  const cd = r.closing_details || {};
  const firConverted = cd.fir_converted || r.fir_status || '';
  const firNumber = cd.fir_number || r.fir_number || '';
  const firStation = cd.fir_station || '';
  const firDistrict = cd.fir_district || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; font-size: 11px; }
  .header { background: #1e293b; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .meta-bar { background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 8px 20px; display: flex; gap: 20px; flex-wrap: wrap; }
  .meta-item label { display:block; font-size:8px; font-weight:700; text-transform:uppercase; color:#94a3b8; letter-spacing:0.08em; }
  .meta-item span { font-size:11px; font-weight:600; color:#1e293b; }
  .section { margin: 12px 20px; }
  .section-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748b; border-bottom:2px solid #e2e8f0; padding-bottom:4px; margin-bottom:8px; }
  .kv-table td { padding: 3px 0; font-size:10px; vertical-align:top; }
  .kv-table td:first-child { width:140px; color:#64748b; font-weight:600; padding-right:12px; }
  .box { border-radius:6px; padding:10px 14px; font-size:11px; line-height:1.6; white-space:pre-wrap; }
  .log-table { width:100%; border-collapse:separate; border-spacing:0 4px; }
  .log-table th { background:#f1f5f9; font-size:8px; font-weight:700; text-transform:uppercase; color:#64748b; padding:5px 8px; text-align:left; }
  .two-col { display:flex; gap:16px; }
  .two-col > div { flex:1; }
  .qr-stack { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
  .qr-box { background:#fff; border:1px solid #cbd5e1; padding:4px; width:92px; border-radius:4px; text-align:center; }
  .qr-box img { width:82px; height:82px; display:block; margin:0 auto; }
  .qr-label { font-size:7px; color:#64748b; margin-top:3px; line-height:1.2; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }
  .qr-placeholder { width:82px; height:82px; display:flex; align-items:center; justify-content:center; border:1px dashed #cbd5e1; color:#94a3b8; font-size:7px; line-height:1.2; }
  .tag { display:inline-block; padding:1px 6px; border-radius:9999px; font-size:9px; font-weight:700; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div>
    <div style="font-size:15px;font-weight:800;letter-spacing:0.02em">Grievance Report</div>
    <div style="font-size:9px;opacity:0.55;margin-top:3px">Generated: ${fmtDateHtml(new Date())}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:900;font-family:monospace;color:#fbbf24">${esc(r.unique_code || '—')}</div>
    <div style="font-size:8px;opacity:0.5;margin-top:2px">UNIQUE REPORT ID</div>
    <div style="margin-top:4px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;background:${statusBg};color:${statusColor}">${r.status || 'PENDING'}</div>
    <div class="qr-stack">
      ${(postQrImageUrl && r.post_link) ? `
      <div class="qr-box">
        <img src="${esc(postQrImageUrl)}" alt="Post QR"/>
        <div class="qr-label">POST QR</div>
      </div>` : ''}
      ${pdfQrImageUrl ? `
      <div class="qr-box">
        <img src="${esc(pdfQrImageUrl)}" alt="PDF QR"/>
        <div class="qr-label">PDF QR</div>
      </div>` : `
      <div class="qr-box">
        <div class="qr-placeholder">Generate PDF to enable QR</div>
        <div class="qr-label">PDF QR</div>
      </div>`}
    </div>
  </div>
</div>

<!-- META BAR -->
<div class="meta-bar">
  <div class="meta-item"><label>Category</label><span>${esc(dash(r.category))}</span></div>
  <div class="meta-item"><label>Platform</label><span>${(r.platform || '—').toUpperCase()}</span></div>
  <div class="meta-item"><label>Post Date</label><span>${fmtDateHtml(r.post_date)}</span></div>
  <div class="meta-item"><label>Phone</label><span>${esc(dash(r.complaint_phone))}</span></div>
  <div class="meta-item"><label>Profile</label><span>${esc(r.posted_by?.display_name || r.profile_id || '—')}</span></div>
  <div class="meta-item"><label>Created</label><span>${fmtDateHtml(r.created_at)}</span></div>
</div>

<!-- POST DETAILS -->
<div class="section">
  <div class="section-title">Post Details</div>
  <div class="two-col">
    <div>
      <table class="kv-table">
        <tr><td>Profile Handle</td><td>${esc(dash(r.posted_by?.handle || r.profile_id))}</td></tr>
        <tr><td>Profile Link</td><td>${(() => {
      const link = r.profile_link || (() => {
        const handle = r.posted_by?.handle || r.profile_id || '';
        if (!handle) return '';
        const p = (r.platform || '').toLowerCase();
        if (p === 'twitter' || p === 'x') return `https://x.com/${handle.replace(/^@/, '')}`;
        if (p === 'facebook') return `https://facebook.com/${handle.replace(/^@/, '')}`;
        if (p === 'youtube') return `https://youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`;
        return '';
      })();
      return link ? `<a href="${esc(link)}" style="color:#2563eb;word-break:break-all">${esc(link)}</a>` : '—';
    })()}</td></tr>
        <tr><td>Post Link</td><td><a href="${esc(r.post_link || '')}" style="color:#2563eb;word-break:break-all">${esc(dash(r.post_link))}</a></td></tr>
        <tr><td>Post Date</td><td>${fmtDateHtml(r.post_date)}</td></tr>
      </table>
    </div>
    <div>
      <table class="kv-table">
        <tr><td>Views</td><td>${dash(r.engagement?.views)}</td></tr>
        <tr><td>Likes</td><td>${dash(r.engagement?.likes)}</td></tr>
        <tr><td>Reposts</td><td>${dash(r.engagement?.reposts)}</td></tr>
        <tr><td>Replies</td><td>${dash(r.engagement?.replies)}</td></tr>
      </table>
    </div>
    ${postQrImageUrl && r.post_link ? `
    <div style="max-width:150px;flex:0 0 150px;text-align:center">
      <div style="border:1px solid #e2e8f0;padding:8px;background:#fff">
        <img src="${esc(postQrImageUrl)}" alt="Post QR" style="width:120px;height:120px;display:block;margin:0 auto"/>
      </div>
      <div style="font-size:8px;color:#64748b;margin-top:4px">Scan to view original post</div>
    </div>` : ''}
  </div>
  ${r.post_description ? `<div class="box" style="background:#f8fafc;border:1px solid #e2e8f0;margin-top:8px">${esc(r.post_description)}</div>` : ''}
</div>


<!-- MEDIA -->
${(() => {
      const mediaUrls = (r.media_s3_urls && r.media_s3_urls.length > 0) ? r.media_s3_urls : (r.media_urls || []);
      const isVideo = (url) => /\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/i.test(String(url || ''));

      return mediaUrls.length > 0 ? `
<div class="section">
  <div class="section-title">Post Media (${mediaUrls.length})</div>
  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
    ${mediaUrls.map((u, i) => `
      <div style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; background: #f8fafc; min-height: 40px; display: flex; flex-direction: column;">
        ${isVideo(u)
          ? `<div style="padding: 20px 10px; text-align: center; font-size: 9px; color: #2563eb; font-weight: 500; background: #f1f5f9; flex: 1; display: flex; align-items: center; justify-content: center; word-break: break-all;">
               🎬 Video: <a href="${esc(u)}" style="color:#2563eb; text-decoration: underline; margin-left: 4px;">${esc(u)}</a>
             </div>`
          : `<img src="${esc(u)}" style="width: 100%; height: 160px; object-fit: contain; display: block; background: #f1f5f9;" />`
        }
        <div style="padding: 4px 8px; font-size: 8px; color: #64748b; background: white; border-top: 1px solid #e2e8f0; text-align: center; font-weight: 600;">
          <a href="${esc(u)}" style="color:#2563eb; text-decoration: underline;">📎 ${isVideo(u) ? 'Video' : 'Image'} ${i + 1} — Click to view</a>
        </div>
      </div>`).join('')}
  </div>
</div>` : '';
    })()}

<!-- ESCALATION -->
${escalationLog ? `
<div class="section">
  <div class="section-title">Escalation Details</div>
  <div class="box" style="background:#fef2f2;border:1px solid #fecaca">
    <table class="kv-table">
      <tr><td>Escalated At</td><td>${fmtDateHtml(escalationLog.timestamp)}</td></tr>
      ${escalationLog.recipient?.name ? `<tr><td>Escalated To</td><td style="font-weight:700">${esc(escalationLog.recipient.name)}${escalationLog.recipient?.phone ? ' · ' + esc(escalationLog.recipient.phone) : ''}</td></tr>` : ''}
      ${escalationLog.content ? `<tr><td>Remarks</td><td>${esc(escalationLog.content)}</td></tr>` : ''}
    </table>
  </div>
</div>` : ''}

<!-- COMMUNICATION LOG -->
${allLogs.length > 0 ? `
<div class="section">
  <div class="section-title">Communication Log (${allLogs.length} entries)</div>
  <table class="log-table">
    <thead><tr><th>Comments By</th><th>Mode Of Communication</th><th>Message</th><th>Time</th></tr></thead>
    <tbody>${logRows}</tbody>
  </table>
</div>` : ''}

<!-- CLOSING -->
${(r.closing_remarks || r.final_reply_to_user || r.status === 'CLOSED') ? `
<div class="section">
  <div class="section-title">Closing Details</div>
  ${r.closing_remarks ? `
  <div style="margin-bottom:8px">
    <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px">Closing Remarks</div>
    <div class="box" style="background:#f0fdf4;border:1px solid #bbf7d0">${esc(r.closing_remarks)}</div>
  </div>` : ''}
  ${r.final_reply_to_user ? `
  <div>
    <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px">Final Reply to User</div>
    <div class="box" style="background:#f0fdf4;border:1px solid #bbf7d0">${esc(r.final_reply_to_user)}</div>
  </div>` : ''}
</div>` : ''}

<!-- FIR -->
${(firConverted === 'Yes' || firNumber) ? `
<div class="section">
  <div class="section-title">FIR Details</div>
  <div class="box" style="background:#fef2f2;border:1px solid #fecaca">
    <table class="kv-table">
      <tr><td>FIR Number</td><td style="font-weight:700;color:#dc2626;font-size:13px">${esc(firNumber || '—')}</td></tr>
      ${firStation ? `<tr><td>Police Station</td><td>${esc(firStation)}</td></tr>` : ''}
      ${firDistrict ? `<tr><td>District</td><td>${esc(firDistrict)}</td></tr>` : ''}
    </table>
  </div>
</div>` : ''}

<!-- FOOTER -->
<div style="margin:20px 20px 0;padding:8px 0;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8">
  <span>Grievance Report · ${esc(r.unique_code || '')}</span>
  <span>Generated ${fmtDateHtml(new Date())}</span>
</div>

</body>
</html>`;
};

module.exports = {
  createReport,
  shareReport,
  closeReport,
  updateReportStatus,
  updateReport,
  getReports,
  getReport,
  exportReports,
  getContacts,
  generateReportPdf
};
