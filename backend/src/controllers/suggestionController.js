const SuggestionReport = require('../models/SuggestionReport');
const CriticismContact = require('../models/CriticismContact');
const Grievance = require('../models/Grievance');
const { generateSuggestionCode } = require('../services/suggestionCodeService');
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
/*                  SUGGESTION REPORT CRUD                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * POST /api/suggestion/reports
 * Create a new suggestion report from grievance data
 */
const createReport = async (req, res) => {
  try {
    const {
      grievance_id,
      remarks,
      message,
      platform,
      profile_id,
      profile_link,
      post_link,
      post_date,
      post_description,
      posted_by,
      engagement,
      category,
      media_urls,
      media_items,
      media_s3_urls
    } = req.body;

    if (!grievance_id) {
      return res.status(400).json({ error: 'grievance_id is required' });
    }

    const grievanceDoc = await Grievance.findOne({ id: grievance_id });
    if (!grievanceDoc) {
      return res.status(404).json({ error: 'Grievance not found' });
    }

    const existingReport = await SuggestionReport.findOne({ grievance_id });
    const unique_code = existingReport?.unique_code || await generateSuggestionCode(platform || grievanceDoc.platform || 'x');

    const payloadMediaItems = Array.isArray(media_items) && media_items.length > 0
      ? dedupeMediaItems(media_items)
      : [];

    const grievanceMediaItems = extractMediaFromGrievance(grievanceDoc);

    const mediaItemsToArchive = dedupeMediaItems([
      ...payloadMediaItems,
      ...grievanceMediaItems,
      ...(Array.isArray(media_urls)
        ? media_urls.map((url) => ({
          type: /\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/i.test(String(url || '')) ? 'video' : 'photo',
          url
        }))
        : [])
    ]);

    const archivedMedia = mediaItemsToArchive.length > 0
      ? await archiveContentMedia(
        mediaItemsToArchive,
        grievanceDoc.tweet_id || grievance_id,
        {
          folder: 'suggestion-content',
          useUniqueFileName: true,
          replaceOriginalUrls: false,
          postUrl: post_link || grievanceDoc.tweet_url
        }
      )
      : [];

    const finalOriginalMediaUrls = Array.from(new Set([
      ...dedupeMediaItems(mediaItemsToArchive).map((item) => item.video_url || item.url).filter(Boolean),
      ...dedupeMediaItems(archivedMedia).map((item) => item.video_url || item.url).filter(Boolean)
    ]));
    const finalS3MediaUrls = Array.from(new Set([
      ...((Array.isArray(media_s3_urls) ? media_s3_urls : []).filter(Boolean)),
      ...((Array.isArray(archivedMedia) ? archivedMedia : [])
        .flatMap((item) => [item?.s3_url, item?.s3_preview])
        .filter(Boolean))
    ]));

    const reportPayload = {
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
      category: category || existingReport?.category || 'Others',
      media_urls: finalOriginalMediaUrls,
      media_s3_urls: finalS3MediaUrls,
      remarks: remarks || '',
      message: message || '',
      created_by: existingReport?.created_by || getUser(req)
    };

    let report;
    let created = false;
    if (existingReport) {
      report = await SuggestionReport.findOneAndUpdate(
        { grievance_id },
        { $set: reportPayload },
        { new: true }
      );
    } else {
      report = await SuggestionReport.create(reportPayload);
      created = true;
    }

    // Update the parent grievance
    grievanceDoc.suggestion = {
      ...(grievanceDoc.suggestion || {}),
      report_id: report.id,
      unique_code: report.unique_code,
      remarks: report.remarks,
      category: report.category,
      message: report.message,
      media_s3_urls: report.media_s3_urls || [],
      action_taken_at: report.action_taken_at || null,
      shared_at: report.shared_at || null,
      shared_via: report.shared_via || null,
      informed_to: report.informed_to || {}
    };
    grievanceDoc.markModified('suggestion');
    await grievanceDoc.save();

    res.status(created ? 201 : 200).json(report);
  } catch (error) {
    console.error('Error creating suggestion report:', error);
    res.status(500).json({ error: 'Failed to create suggestion report' });
  }
};

/**
 * PUT /api/suggestion/reports/:id/share
 * Record sharing action
 */
const shareReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_name, contact_phone, contact_department } = req.body;

    const report = await SuggestionReport.findOne({ id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    report.informed_to = {
      name: contact_name || '',
      phone: contact_phone || '',
      department: contact_department || ''
    };
    report.shared_at = new Date();
    report.action_taken_at = new Date();
    report.shared_via = 'whatsapp';

    await report.save();

    await Grievance.findOneAndUpdate(
      { id: report.grievance_id },
      {
        $set: {
          'suggestion.action_taken_at': report.action_taken_at,
          'suggestion.shared_at': report.shared_at,
          'suggestion.shared_via': report.shared_via,
          'suggestion.informed_to': report.informed_to
        }
      }
    );

    res.json(report);
  } catch (error) {
    console.error('Error sharing suggestion report:', error);
    res.status(500).json({ error: 'Failed to share report' });
  }
};

/**
 * GET /api/suggestion/reports
 * List all suggestion reports with pagination
 */
const getReports = async (req, res) => {
  try {
    const { page = 1, limit = 50, platform, from, to, unique_code, sort, order, category } = req.query;
    const query = {};

    if (platform && platform !== 'all') query.platform = platform;
    if (category && category !== 'all') query.category = category;
    if (unique_code) {
      query.unique_code = { $regex: String(unique_code).trim(), $options: 'i' };
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

    const sortFieldMap = {
      post_date: 'post_date',
      category: 'category',
      unique_code: 'unique_code',
      unique_id: 'unique_code',
      action_taken: 'action_taken_at',
      action_taken_at: 'action_taken_at',
      created_at: 'created_at'
    };
    const resolvedSortField = sortFieldMap[String(sort || 'created_at')] || 'created_at';
    const resolvedSortOrder = String(order || 'desc').toLowerCase() === 'asc' ? 1 : -1;

    const total = await SuggestionReport.countDocuments(query);
    const reports = await SuggestionReport.find(query)
      .sort({ [resolvedSortField]: resolvedSortOrder, created_at: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({
      reports,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching suggestion reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
};

/**
 * GET /api/suggestion/reports/:id
 */
const getReport = async (req, res) => {
  try {
    const report = await SuggestionReport.findOne({ id: req.params.id }).lean();
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
};

/**
 * GET /api/suggestion/reports/export
 * Export suggestion reports as Excel
 */
const exportReports = async (req, res) => {
  try {
    const { platform, from, to, unique_code } = req.query;
    const query = {};

    if (platform && platform !== 'all') query.platform = platform;
    if (unique_code) {
      query.unique_code = { $regex: String(unique_code).trim(), $options: 'i' };
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

    const reports = await SuggestionReport.find(query).sort({ created_at: -1 }).lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SANKET';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Suggestion Reports');

    sheet.columns = [
      { header: 'SI.NO', key: 'sno', width: 8 },
      { header: 'Post Date & Time', key: 'post_date', width: 22 },
      { header: 'Profile ID / Profile Link', key: 'profile', width: 35 },
      { header: 'Post Link', key: 'post_link', width: 40 },
      { header: 'Post Description', key: 'post_description', width: 50 },
      { header: 'Media URLs', key: 'media', width: 40 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Remarks', key: 'remarks', width: 40 },
      { header: 'Unique ID', key: 'unique_code', width: 22 },
      { header: 'Action Taken Date & Time', key: 'action_taken_at', width: 22 },
      { header: 'Informed To', key: 'informed_to', width: 30 }
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF9333EA' } // purple-600
    };

    const formatDate = (d) => {
      if (!d) return '';
      try {
        return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      } catch { return ''; }
    };

    reports.forEach((report, index) => {
      sheet.addRow({
        sno: index + 1,
        post_date: formatDate(report.post_date),
        profile: report.profile_link || report.profile_id || '',
        post_link: report.post_link || '',
        post_description: report.post_description || '',
        media: ((Array.isArray(report.media_s3_urls) && report.media_s3_urls.length > 0)
          ? report.media_s3_urls
          : (report.media_urls || [])
        ).join('\n'),
        category: report.category || 'Others',
        remarks: report.remarks || '',
        unique_code: report.unique_code || '',
        action_taken_at: formatDate(report.action_taken_at),
        informed_to: report.informed_to
          ? `${report.informed_to.name || ''}${report.informed_to.phone ? ' (' + report.informed_to.phone + ')' : ''}`
          : ''
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=suggestion_reports_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting suggestion reports:', error);
    res.status(500).json({ error: 'Failed to export reports' });
  }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                  CONTACTS (reuse Criticism contacts)              */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const getContacts = async (req, res) => {
  try {
    const contacts = await CriticismContact.find({ is_active: true })
      .sort({ name: 1 })
      .lean();
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
};

const generateReportPdf = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { id }, { unique_code: id }] }
      : { $or: [{ id }, { unique_code: id }] };

    const report = await SuggestionReport.findOne(query).lean();

    if (!report) return res.status(404).json({ error: 'Report not found' });

    // ── Build self-contained HTML for the report ──
    const html = buildReportHtml(report);

    // ── Render with Puppeteer ──
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' }
    });
    await browser.close();

    // ── Upload to S3 ──
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.AWS_REGION || 'eu-north-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    const folder = process.env.AWS_S3_FOLDER || 'uploads';
    const key = `${folder}/suggestion-reports/${report.unique_code || report.id}-${Date.now()}.pdf`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${report.unique_code || report.id}.pdf"`
    }));

    const pdfUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'eu-north-1'}.amazonaws.com/${key}`;

    // ── Save URL to record ──
    await SuggestionReport.updateOne(
      { _id: report._id },
      { $set: { report_pdf_url: pdfUrl, report_pdf_generated_at: new Date() } }
    );

    return res.json({ pdf_url: pdfUrl });
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

const buildReportHtml = (r) => {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dash = v => v || '—';

  // Align with Grievance colors
  const statusColor = '#2563eb'; // blue-600
  const statusBg = '#eff6ff'; // blue-50

  const mediaUrls = (r.media_s3_urls && r.media_s3_urls.length > 0) ? r.media_s3_urls : (r.media_urls || []);

  // Profile Link Fallback
  let finalProfileLink = r.profile_link;
  if (!finalProfileLink && r.platform && r.posted_by?.handle) {
    const handle = r.posted_by.handle.replace(/^@/, '');
    if (r.platform === 'x' || r.platform === 'twitter') finalProfileLink = `https://x.com/${handle}`;
    else if (r.platform === 'facebook') finalProfileLink = `https://facebook.com/${handle}`;
    else if (r.platform === 'youtube') finalProfileLink = `https://youtube.com/@${handle}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; font-size: 11px; }
  .header { background: #1e293b; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
  .meta-bar { background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 8px 20px; display: flex; gap: 20px; flex-wrap: wrap; }
  .meta-item label { display:block; font-size:8px; font-weight:700; text-transform:uppercase; color:#94a3b8; letter-spacing:0.08em; }
  .meta-item span { font-size:11px; font-weight:600; color:#1e293b; }
  .section { margin: 12px 20px; }
  .section-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748b; border-bottom:2px solid #e2e8f0; padding-bottom:4px; margin-bottom:8px; }
  .kv-table td { padding: 3px 0; font-size:10px; vertical-align:top; }
  .kv-table td:first-child { width:140px; color:#64748b; font-weight:600; padding-right:12px; }
  .box { border-radius:6px; padding:10px 14px; font-size:11px; line-height:1.6; white-space:pre-wrap; }
  .two-col { display:flex; gap:16px; }
  .two-col > div { flex:1; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div>
    <div style="font-size:15px;font-weight:800;letter-spacing:0.02em">Suggestion Report</div>
    <div style="font-size:9px;opacity:0.55;margin-top:3px">Generated: ${fmtDateHtml(new Date())}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:900;font-family:monospace;color:#fbbf24">${esc(r.unique_code || '—')}</div>
    <div style="font-size:8px;opacity:0.5;margin-top:2px">UNIQUE REPORT ID</div>
    <div style="margin-top:4px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;background:${statusBg};color:${statusColor}">SUGGESTION</div>
  </div>
</div>

<!-- META BAR -->
<div class="meta-bar">
  <div class="meta-item"><label>Category</label><span>${esc(dash(r.category))}</span></div>
  <div class="meta-item"><label>Platform</label><span>${(r.platform || '—').toUpperCase()}</span></div>
  <div class="meta-item"><label>Post Date</label><span>${fmtDateHtml(r.post_date)}</span></div>
  <div class="meta-item"><label>Phone</label><span>${esc(dash(r.complaint_phone || r.phone))}</span></div>
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
        <tr><td>Profile Link</td><td><a href="${esc(finalProfileLink || '')}" style="color:#2563eb;word-break:break-all">${esc(dash(finalProfileLink))}</a></td></tr>
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

<!-- REMARKS -->
<div class="section">
  <div class="section-title">Operator Remarks</div>
  <div class="box" style="background:#f8fafc;border:1px solid #e2e8f0">${esc(dash(r.remarks))}</div>
</div>

${r.shared_at ? `
<div class="section">
  <div class="section-title">Shared Details</div>
  <div class="box" style="background:#eff6ff;border:1px solid #bfdbfe">
    <table class="kv-table">
      <tr><td>Shared At</td><td>${fmtDateHtml(r.shared_at)}</td></tr>
    </table>
  </div>
</div>` : ''}

<!-- FOOTER -->
<div style="margin:20px 20px 0;padding:8px 0;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8">
  <span>Suggestion Report · ${esc(r.unique_code || '')}</span>
  <span>Generated ${fmtDateHtml(new Date())}</span>
</div>

</body>
</html>`;
};

module.exports = {
  createReport,
  shareReport,
  getReports,
  getReport,
  exportReports,
  getContacts,
  generateReportPdf
};
