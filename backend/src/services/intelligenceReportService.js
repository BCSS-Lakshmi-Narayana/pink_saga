const puppeteer = require('puppeteer');
const Alert = require('../models/Alert');
const Grievance = require('../models/Grievance');

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtDatetime = (d) =>
  new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

const platformLabel = (p = '') => {
  const m = { x: 'X', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' };
  return m[p.toLowerCase()] || p;
};

const platformBadge = (p = '') => {
  const styles = {
    x:         'background:#000;color:#fff',
    instagram: 'background:#e1306c;color:#fff',
    facebook:  'background:#1877f2;color:#fff',
    youtube:   'background:#ff0000;color:#fff'
  };
  return `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;${styles[p.toLowerCase()] || 'background:#6b7280;color:#fff'}">${platformLabel(p)}</span>`;
};

const topicBadge = (topic = '') => {
  const colors = {
    'Political Criticism': '#f59e0b', 'Law & Order': '#ef4444',
    'Public Complaint': '#3b82f6',   'Normal': '#6b7280',
    'Corruption': '#7c3aed',          'General Complaint': '#0891b2',
    'Abusive': '#dc2626',             'Hate Speech': '#d97706',
    'Hate Speech + Threat': '#7f1d1d','Threat': '#b91c1c',
    'Harassment': '#9f1239',          'Sexual Violence': '#881337',
    'Sexual Harassment': '#881337',   'Normal (Negative)': '#4b5563'
  };
  const c = colors[topic] || '#6b7280';
  return `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${c}22;color:${c};border:1px solid ${c}44">${topic || 'Normal'}</span>`;
};

const riskBadge = () =>
  `<span style="color:#dc2626;font-weight:700;font-size:11px">▲ High</span>`;

const SENTIMENT_BADGE_STYLES = {
  positive: { color: '#16a34a', arrow: '▲', label: 'POS' },
  negative: { color: '#dc2626', arrow: '▼', label: 'NEG' },
  neutral:  { color: '#64748b', arrow: '■', label: 'MOD' }
};
const sentimentBadge = (sentiment = 'negative') => {
  const s = SENTIMENT_BADGE_STYLES[sentiment] || SENTIMENT_BADGE_STYLES.negative;
  return `<span style="color:${s.color};font-weight:700;font-size:11px">${s.arrow} ${s.label}</span>`;
};

// ─── Base HTML shell ───────────────────────────────────────────────────────────

const baseHtml = (title, subtitle, badgeText, badgeColor, generated, period, showing, bodyContent) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',sans-serif;background:#f8fafc;color:#0f172a;font-size:12px;line-height:1.5}
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff}

  /* header */
  .header{background:#0f172a;color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  .header-left{display:flex;flex-direction:column}
  .header-unit{font-size:9px;font-weight:600;letter-spacing:2px;color:#94a3b8;text-transform:uppercase}
  .header-title{font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#f1f5f9;margin-top:2px}
  .header-meta{font-size:9px;color:#64748b;margin-top:4px}
  .badge-top{padding:4px 12px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor};white-space:nowrap}

  /* kpi row */
  .kpi-row{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:16px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
  .kpi-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
  .kpi-num{font-size:20px;font-weight:800;color:#0f172a;line-height:1}
  .kpi-sub{font-size:8px;color:#64748b;margin-top:3px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
  .kpi-label{font-size:8px;color:#94a3b8;margin-top:1px}

  /* section header */
  .section{padding:16px 24px 0}
  .section-title{font-size:9px;font-weight:700;letter-spacing:2px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px}

  /* category cards */
  .cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 24px 16px}
  .cat-card{border-radius:8px;padding:12px;border:1px solid}
  .cat-icon{font-size:18px;margin-bottom:4px}
  .cat-num{font-size:18px;font-weight:800;margin-bottom:2px}
  .cat-name{font-size:10px;font-weight:700;margin-bottom:4px}
  .cat-desc{font-size:9px;color:#475569;line-height:1.4}

  /* distribution analysis */
  .dist-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;padding:0 24px 16px;align-items:start}
  .dist-block{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;min-width:0;overflow:hidden}
  .dist-title{font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid #f1f5f9;padding-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dist-chart-wrap{position:relative;height:140px}
  .top5-row{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:10px}
  .top5-rank{font-weight:800;color:#94a3b8;width:16px;flex:0 0 auto}
  .top5-name{flex:1 1 auto;min-width:0;color:#1e293b;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .top5-count{flex:0 0 auto;font-weight:700;color:#0f172a;background:#f1f5f9;padding:1px 6px;border-radius:8px;font-size:9px}

  /* timeline */
  .timeline-wrap{padding:0 24px 16px}
  .timeline-inner{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px}
  .timeline-title{font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;margin-bottom:8px}
  .timeline-chart{height:100px;position:relative}

  /* table */
  .table-wrap{padding:0 24px 16px}
  .table-section-title{font-size:11px;font-weight:700;color:#0f172a;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  thead tr{background:#0f172a;color:#f1f5f9}
  thead th{padding:8px 6px;text-align:left;font-size:8px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}
  tbody tr:nth-child(even){background:#f8fafc}
  tbody tr:hover{background:#f1f5f9}
  tbody td{padding:6px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
  .row-num{color:#94a3b8;font-weight:600;font-size:9px}
  .author-name{font-weight:600;color:#0f172a}
  .author-handle{color:#64748b;font-size:9px}
  .link-btn{color:#3b82f6;font-size:9px;font-weight:600;text-decoration:none;padding:2px 6px;border:1px solid #bfdbfe;border-radius:4px}

  /* footer */
  .footer{background:#0f172a;color:#64748b;padding:10px 24px;display:flex;justify-content:space-between;align-items:center;font-size:8px;letter-spacing:.5px;margin-top:auto}
  .footer-confidential{color:#ef4444;font-weight:700;letter-spacing:2px}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <span class="header-unit">${subtitle}</span>
      <span class="header-title">${title}</span>
      <span class="header-meta">Generated: ${generated} &nbsp;·&nbsp; Period: ${period} &nbsp;·&nbsp; ${showing}</span>
    </div>
    <span class="badge-top">${badgeText}</span>
  </div>
  ${bodyContent}
</div>
</body>
</html>`;

// Append a "Filtered for: <AC>" suffix to a report subtitle when the caller is
// a scoped MLA/MP, so the PDF visibly reflects the constituency restriction.
const scopeSubtitle = (base, scope) => {
  if (!scope || scope.canSeeAll) return base;
  const seats = scope.constituencies || [];
  if (!seats.length) return base;
  return `${base} · Filtered for: ${seats.join(', ')}`;
};

// ─── ALERTS REPORT ─────────────────────────────────────────────────────────────

async function buildAlertsData(filters = {}) {
  const {
    startDate, endDate, platform, status = 'active',
    risk_level, topic_classification, alert_type, search, limit, scope
  } = filters;

  const query = {};

  // RBAC: scoped MLA / MP — restrict alerts to those whose title/description
  // matches one of their seats. Mirrors the live /api/alerts filter.
  if (scope && !scope.canSeeAll) {
    const seats = scope.constituencies || [];
    if (seats.length === 0) {
      return { alerts: [], total: 0 };
    }
    const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seatRegex = new RegExp(seats.map(escape).join('|'), 'i');
    query.$and = [{
      $or: [
        { title: seatRegex },
        { description: seatRegex },
        { matched_keywords_normalized: seatRegex },
      ],
    }];
  }
  if (status && status !== 'all') query.status = status;
  if (platform) query.platform = platform;
  if (risk_level && risk_level !== 'all') query.risk_level = String(risk_level).toLowerCase();
  if (alert_type && alert_type !== 'all') query.alert_type = alert_type;
  if (topic_classification && topic_classification !== 'all') {
    const esc = String(topic_classification).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query['llm_analysis.grievance_type'] = { $regex: `^${esc}$`, $options: 'i' };
  }
  if (search) {
    const esc = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');
    query.$or = [
      { author:                       rx },
      { author_handle:                rx },
      { content_text:                 rx },
      { 'llm_analysis.grievance_type': rx }
    ];
  }
  if (startDate || endDate) {
    query.published_at = {};
    if (startDate) query.published_at.$gte = new Date(startDate);
    if (endDate) { const e = new Date(endDate); e.setHours(23,59,59,999); query.published_at.$lte = e; }
  }

  const total = await Alert.countDocuments(query);
  const findCursor = Alert.find(query).sort({ published_at: -1 });
  if (limit && Number(limit) > 0) findCursor.limit(Number(limit));
  const rawAlerts = await findCursor.lean();

  // Group by author_handle → one row per unique profile
  const profileMap = new Map();
  for (const a of rawAlerts) {
    const key = (a.author_handle || a.author || 'unknown').toLowerCase();
    if (!profileMap.has(key)) {
      const topic = a.bsk_pipeline?.topic || a.source_category || 'Normal';
      profileMap.set(key, {
        author: a.author || a.author_handle || 'Unknown',
        handle: a.author_handle ? `@${a.author_handle.replace(/^@/, '')}` : '',
        platform: a.platform || 'x',
        topic,
        risk: a.risk_level || 'high',
        posts: 0,
        alert_date: a.published_at || a.created_at,
        link: a.content_url || '#'
      });
    }
    const p = profileMap.get(key);
    p.posts++;
    const d = a.published_at || a.created_at;
    if (d && d > p.alert_date) { p.alert_date = d; p.link = a.content_url || p.link; }
  }

  const profiles = [...profileMap.values()].sort((a, b) => b.posts - a.posts);

  // KPIs
  const totalPosts = rawAlerts.length;
  const byPlatform = {};
  for (const a of rawAlerts) { const k = a.platform || 'x'; byPlatform[k] = (byPlatform[k] || 0) + 1; }

  // Topic distribution
  const topicCounts = {};
  for (const p of profiles) { topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1; }

  // Daily timeline
  const dailyMap = {};
  for (const a of rawAlerts) {
    const d = new Date(a.published_at || a.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dailyMap[key] = (dailyMap[key] || 0) + 1;
  }
  const sortedDays = Object.keys(dailyMap).sort();

  // Date span
  const dates = rawAlerts.map(a => new Date(a.published_at || a.created_at)).filter(Boolean);
  const minDate = dates.length ? new Date(Math.min(...dates)) : null;
  const maxDate = dates.length ? new Date(Math.max(...dates)) : null;
  const daySpan = (minDate && maxDate)
    ? Math.round((maxDate - minDate) / 86400000) + 1
    : 0;

  const top5 = [...profiles].sort((a,b) => b.posts - a.posts).slice(0, 5);

  const topTopic = Object.entries(topicCounts).sort((a,b) => b[1] - a[1])[0];

  // Per-post rows for viewMode === 'all'
  const posts = rawAlerts.map((a) => ({
    author: a.author || a.author_handle || 'Unknown',
    handle: a.author_handle ? `@${a.author_handle.replace(/^@/, '')}` : '',
    platform: a.platform || 'x',
    topic: a.bsk_pipeline?.topic || a.source_category || a.llm_analysis?.grievance_type || 'Normal',
    risk: a.risk_level || 'high',
    alert_date: a.published_at || a.created_at,
    link: a.content_url || '#'
  }));

  return {
    profiles,
    posts,
    total,
    totalProfiles: profiles.length,
    totalPosts,
    byPlatform,
    topicCounts,
    dailyMap,
    sortedDays,
    daySpan,
    top5,
    topTopic: topTopic ? topTopic[0] : 'Political Criticism',
    topTopicCount: topTopic ? topTopic[1] : 0,
    minDate,
    maxDate
  };
}

function buildAlertsHtml(data, filters) {
  const {
    profiles, posts, total, totalProfiles, totalPosts, byPlatform, topicCounts,
    dailyMap, sortedDays, daySpan, top5, topTopic, topTopicCount, minDate, maxDate
  } = data;

  const profilesMode = filters.viewMode === 'profiles';
  const rows = profilesMode ? profiles : (posts || []);
  const rowCountLabel = profilesMode ? 'profiles' : 'posts';

  const periodStr = filters.startDate && filters.endDate
    ? `${fmtDate(filters.startDate)} – ${fmtDate(filters.endDate)}`
    : 'All Time';

  // Category card config
  const catConfig = [
    { key: 'Political Criticism', icon: '📢', bg: '#fef3c7', border: '#f59e0b', text: '#92400e',
      desc: 'Political commentary, party criticism, opposition narratives. Concentrated on X/Twitter.' },
    { key: 'Law & Order', icon: '⚡', bg: '#fee2e2', border: '#ef4444', text: '#991b1b',
      desc: 'Content relating to law enforcement matters and civil unrest narratives.' },
    { key: 'Public Complaint', icon: '📋', bg: '#dbeafe', border: '#3b82f6', text: '#1e40af',
      desc: 'Escalating grievance content directed at public services and institutional conduct.' },
    { key: 'Normal', icon: '🔎', bg: '#f1f5f9', border: '#94a3b8', text: '#334155',
      desc: 'Flagged due to high post volume or network proximity to high-risk handles.' },
    { key: 'General Complaint', icon: '📌', bg: '#cffafe', border: '#0891b2', text: '#164e63',
      desc: 'General grievance content flagged for tone and volume.' },
    { key: 'Corruption', icon: '🔴', bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95',
      desc: 'Profiles alleging official misconduct and corruption.' }
  ];

  const catCards = catConfig.map(c => {
    const count = topicCounts[c.key] || 0;
    if (!count) return '';
    return `<div class="cat-card" style="background:${c.bg};border-color:${c.border}">
      <div class="cat-icon">${c.icon}</div>
      <div class="cat-num" style="color:${c.text}">${c.key}</div>
      <div class="cat-name" style="color:${c.text}">${count} profiles</div>
      <div class="cat-desc">${c.desc}</div>
    </div>`;
  }).filter(Boolean).join('');

  // Top-5 list
  const top5Html = top5.map((p, i) =>
    `<div class="top5-row">
      <span class="top5-rank">${i+1}</span>
      <span class="top5-name">${p.handle || p.author}</span>
      <span class="top5-count">${p.posts}</span>
    </div>`
  ).join('');

  // Table rows
  const tableRows = rows.map((p, i) =>
    `<tr>
      <td class="row-num">${i+1}</td>
      <td><span class="author-name">${p.author}</span></td>
      <td><span class="author-handle">${p.handle}</span></td>
      <td>${platformBadge(p.platform)}</td>
      <td>${topicBadge(p.topic)}</td>
      <td>${riskBadge()}</td>
      ${profilesMode ? `<td style="font-weight:700;text-align:center">${p.posts}</td>` : ''}
      <td style="color:#475569;white-space:nowrap">${fmtDate(p.alert_date)}</td>
      <td><a class="link-btn" href="${p.link}" target="_blank">↗ View</a></td>
    </tr>`
  ).join('');

  // Chart data serialized for inline script
  const topicLabels = JSON.stringify(Object.keys(topicCounts));
  const topicValues = JSON.stringify(Object.values(topicCounts));
  const platformLabels = JSON.stringify(Object.keys(byPlatform).map(platformLabel));
  const platformValues = JSON.stringify(Object.values(byPlatform));
  const dayLabels = JSON.stringify(sortedDays.map(d => d.slice(5))); // MM-DD
  const dayValues = JSON.stringify(sortedDays.map(d => dailyMap[d]));

  const dateRange = (minDate && maxDate)
    ? `${fmtDate(minDate)} – ${fmtDate(maxDate)}`
    : 'All time';

  const body = `
  <!-- KPI Row -->
  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-num">${totalProfiles}</div><div class="kpi-sub">Total Profiles</div><div class="kpi-label">All flagged high risk</div></div>
    <div class="kpi-card"><div class="kpi-num">${totalPosts}</div><div class="kpi-sub">Total Posts</div><div class="kpi-label">Across all profiles</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.x || 0}</div><div class="kpi-sub">X (Twitter)</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.x||0)/totalPosts*100) : 0}% of alerts</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.instagram || 0}</div><div class="kpi-sub">Instagram</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.instagram||0)/totalPosts*100) : 0}% of alerts</div></div>
    <div class="kpi-card"><div class="kpi-num">${profiles.length > 0 ? (totalPosts/profiles.length).toFixed(1) : 0}</div><div class="kpi-sub">Avg Posts/Profile</div><div class="kpi-label">Per flagged account</div></div>
    <div class="kpi-card"><div class="kpi-num">${topTopicCount}</div><div class="kpi-sub">${topTopic}</div><div class="kpi-label">Highest topic volume</div></div>
    <div class="kpi-card"><div class="kpi-num">${daySpan}</div><div class="kpi-sub">Alert Days Span</div><div class="kpi-label">${dateRange}</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.facebook || 0}</div><div class="kpi-sub">Facebook</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.facebook||0)/totalPosts*100) : 0}% of alerts</div></div>
  </div>

  <!-- Threat Category Summary -->
  <div class="section"><div class="section-title">Threat Category Summary</div></div>
  <div class="cat-grid">${catCards}</div>

  <!-- Distribution Analysis -->
  <div class="section"><div class="section-title">Distribution Analysis</div></div>
  <div class="dist-grid">
    <div class="dist-block">
      <div class="dist-title">Alerts by Topic</div>
      <div class="dist-chart-wrap"><canvas id="topicChart"></canvas></div>
    </div>
    <div class="dist-block">
      <div class="dist-title">Platform Breakdown</div>
      <div class="dist-chart-wrap"><canvas id="platformChart"></canvas></div>
    </div>
    <div class="dist-block">
      <div class="dist-title">Top 5 by Post Volume</div>
      ${top5Html}
    </div>
  </div>

  <!-- Timeline -->
  <div class="timeline-wrap">
    <div class="timeline-inner">
      <div class="timeline-title">Alert Volume Timeline &nbsp;·&nbsp; Daily Alerts — ${dateRange}</div>
      <div class="timeline-chart"><canvas id="timelineChart"></canvas></div>
    </div>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <div class="table-section-title">${profilesMode ? `All ${totalProfiles} Flagged Profiles` : `${rows.length} ${rowCountLabel}`} &nbsp;<span style="color:#94a3b8;font-weight:400;font-size:10px">of ${total || totalPosts} total</span></div>
    <table>
      <thead><tr>
        <th>#</th><th>Author</th><th>Handle</th><th>Platform</th>
        <th>Topic</th><th>Risk</th>${profilesMode ? '<th style="text-align:center">Posts</th>' : ''}
        <th>Alert Date</th><th>Link</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <span>Social Intelligence Unit · Generated ${fmtDatetime(new Date())} · ${profilesMode ? `Total: ${totalProfiles} profiles` : `${rows.length} of ${total || totalPosts} posts`}</span>
    <span class="footer-confidential">CONFIDENTIAL</span>
    <span>All classifications: High Risk</span>
  </div>

  <script>
  (function() {
    const COLORS = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#0891b2','#ec4899','#f97316'];
    new Chart(document.getElementById('topicChart'), {
      type: 'bar',
      data: {
        labels: ${topicLabels},
        datasets: [{ data: ${topicValues}, backgroundColor: COLORS, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } },
        maintainAspectRatio: false
      }
    });
    new Chart(document.getElementById('platformChart'), {
      type: 'doughnut',
      data: {
        labels: ${platformLabels},
        datasets: [{ data: ${platformValues}, backgroundColor: ['#000000','#e1306c','#1877f2','#ff0000'], borderWidth: 2 }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10 } } },
        maintainAspectRatio: false
      }
    });
    new Chart(document.getElementById('timelineChart'), {
      type: 'bar',
      data: {
        labels: ${dayLabels},
        datasets: [{ data: ${dayValues}, backgroundColor: '#3b82f6', borderRadius: 4, hoverBackgroundColor: '#1d4ed8' }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 8 } } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 8 }, stepSize: 1 } } },
        maintainAspectRatio: false
      }
    });
  })();
  </script>`;

  return baseHtml(
    'Alerts Report',
    scopeSubtitle('Social Intelligence Unit · Monitoring Division', filters.scope),
    'ALL HIGH RISK',
    '#ef4444',
    fmtDatetime(new Date()),
    periodStr,
    profilesMode ? `Total Profiles: ${totalProfiles}` : `Showing: ${rows.length} of ${total || totalPosts} posts`,
    body
  );
}

// ─── GRIEVANCES REPORT ─────────────────────────────────────────────────────────

function classifyGrievance(g) {
  const a = g.analysis || {};
  const cat = (a.category || '').toLowerCase();
  const type = (a.grievance_type || '').toLowerCase();
  const all = cat + ' ' + type;

  if ((a.hate_speech || all.includes('hate')) && (all.includes('threat') || all.includes('violence')))
    return 'Hate Speech + Threat';
  if (all.includes('sexual violence') || all.includes('sexual_violence'))
    return 'Sexual Violence';
  if (all.includes('sexual harass') || all.includes('sexual_harass'))
    return 'Sexual Harassment';
  if (a.hate_speech || all.includes('hate speech') || all.includes('hate_speech'))
    return 'Hate Speech';
  if (all.includes('harassment') || all.includes('harass'))
    return 'Harassment';
  if (all.includes('threat'))
    return 'Threat';
  if (a.toxicity_level === 'high' || all.includes('abusive') || all.includes('abuse'))
    return 'Abusive';
  return 'Normal (Negative)';
}

async function buildGrievancesData(filters = {}) {
  const {
    startDate, endDate, platform, limit = 100,
    sentiment, grievance_type, category, search, scope
  } = filters;

  const query = { is_active: true };

  // RBAC: scoped MLA / MP — restrict grievances to detected_location.constituency
  // matches inside their seat list.
  if (scope && !scope.canSeeAll) {
    const seats = scope.constituencies || [];
    if (seats.length === 0) {
      return { grievances: [], total: 0 };
    }
    const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query['detected_location.constituency'] = {
      $regex: `^(${seats.map(escape).join('|')})$`,
      $options: 'i',
    };
  }

  const normalizedSentiment = sentiment ? String(sentiment).toLowerCase() : 'negative';
  if (['positive', 'negative', 'neutral'].includes(normalizedSentiment)) {
    query['analysis.sentiment'] = normalizedSentiment;
  }
  if (platform) query.platform = platform;
  if (grievance_type && grievance_type !== 'all') {
    query['analysis.grievance_type'] = grievance_type;
  }
  if (category && category !== 'all') {
    query.$or = [
      { 'grievance_workflow.category': category },
      { 'query_workflow.category':     category },
      { 'criticism.category':          category },
      { 'suggestion.category':         category }
    ];
  }
  if (search) {
    const esc = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');
    const searchOr = [
      { complaint_code:           rx },
      { 'content.text':           rx },
      { 'content.full_text':      rx },
      { 'posted_by.display_name': rx },
      { 'posted_by.handle':       rx },
      { complainant_phone:        rx }
    ];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }
  if (startDate || endDate) {
    query.created_at = {};
    if (startDate) query.created_at.$gte = new Date(startDate);
    if (endDate) { const e = new Date(endDate); e.setHours(23,59,59,999); query.created_at.$lte = e; }
  }

  const total = await Grievance.countDocuments(query);
  const rawGrievances = await Grievance.find(query)
    .sort({ created_at: -1 })
    .limit(Number(limit) || 100)
    .lean();

  // Group by posted_by.handle
  const profileMap = new Map();
  for (const g of rawGrievances) {
    const key = (g.posted_by?.handle || 'unknown').toLowerCase();
    const cat = classifyGrievance(g);
    if (!profileMap.has(key)) {
      const fallbackUrl = g.platform === 'x'
        ? `https://x.com/i/web/status/${g.tweet_id}`
        : g.platform === 'youtube'
          ? `https://youtube.com/watch?v=${g.tweet_id}`
          : g.platform === 'instagram'
            ? `https://instagram.com/p/${g.tweet_id}`
            : g.platform === 'facebook'
              ? `https://facebook.com/${g.tweet_id}`
              : '#';
      const url = g.tweet_url || fallbackUrl;

      profileMap.set(key, {
        display_name: g.posted_by?.display_name || g.posted_by?.handle || 'Unknown',
        handle: g.posted_by?.handle ? `@${g.posted_by.handle.replace(/^@/, '')}` : '',
        platform: g.platform || 'x',
        category: cat,
        sentiment: g.analysis?.sentiment || normalizedSentiment,
        posts: 0,
        date: g.created_at,
        link: url
      });
    }
    const p = profileMap.get(key);
    p.posts++;
    if (g.created_at > p.date) { p.date = g.created_at; }
  }

  const profiles = [...profileMap.values()].sort((a, b) => b.posts - a.posts);

  const byPlatform = {};
  const catCounts = {};
  for (const g of rawGrievances) {
    const plat = g.platform || 'x';
    byPlatform[plat] = (byPlatform[plat] || 0) + 1;
  }
  for (const p of profiles) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }

  // Severity tiers
  const severityTiers = {
    'Low (Normal)': catCounts['Normal (Negative)'] || 0,
    'Medium (Abusive)': catCounts['Abusive'] || 0,
    'High (Hate / Harass)': (catCounts['Hate Speech'] || 0) + (catCounts['Harassment'] || 0) + (catCounts['Sexual Harassment'] || 0),
    'Critical (Threat / SV)': (catCounts['Hate Speech + Threat'] || 0) + (catCounts['Threat'] || 0) + (catCounts['Sexual Violence'] || 0)
  };

  // Daily timeline
  const dailyMap = {};
  for (const g of rawGrievances) {
    const d = new Date(g.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dailyMap[key] = (dailyMap[key] || 0) + 1;
  }
  const sortedDays = Object.keys(dailyMap).sort();

  const top5 = [...profiles].sort((a,b) => b.posts - a.posts).slice(0, 5);

  const hateSpeechCount = (catCounts['Hate Speech'] || 0) + (catCounts['Hate Speech + Threat'] || 0);
  const threatCount = (catCounts['Threat'] || 0) + (catCounts['Hate Speech + Threat'] || 0) + (catCounts['Sexual Violence'] || 0);

  // Per-post rows (used when viewMode === 'all')
  const posts = rawGrievances.map((g) => {
    const fallbackUrl = g.platform === 'x'
      ? `https://x.com/i/web/status/${g.tweet_id}`
      : g.platform === 'youtube'
        ? `https://youtube.com/watch?v=${g.tweet_id}`
        : g.platform === 'instagram'
          ? `https://instagram.com/p/${g.tweet_id}`
          : g.platform === 'facebook'
            ? `https://facebook.com/${g.tweet_id}`
            : '#';
    return {
      display_name: g.posted_by?.display_name || g.posted_by?.handle || 'Unknown',
      handle: g.posted_by?.handle ? `@${g.posted_by.handle.replace(/^@/, '')}` : '',
      platform: g.platform || 'x',
      category: classifyGrievance(g),
      sentiment: g.analysis?.sentiment || normalizedSentiment,
      date: g.created_at,
      link: g.tweet_url || fallbackUrl
    };
  });

  return {
    profiles,
    posts,
    total,
    totalProfiles: profiles.length,
    totalPosts: rawGrievances.length,
    byPlatform,
    catCounts,
    severityTiers,
    dailyMap,
    sortedDays,
    top5,
    hateSpeechCount,
    threatCount,
    sentiment: normalizedSentiment
  };
}

function buildGrievancesHtml(data, filters) {
  const {
    profiles, posts, total, totalProfiles, totalPosts, byPlatform, catCounts,
    severityTiers, dailyMap, sortedDays, top5, hateSpeechCount, threatCount,
    sentiment: dataSentiment
  } = data;

  const sentimentLabelMap = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral', moderate: 'Neutral' };
  const effectiveSentiment = dataSentiment || 'negative';
  const sentimentDisplay = sentimentLabelMap[effectiveSentiment] || 'Negative';
  const profilesMode = filters.viewMode === 'profiles';
  const rows = profilesMode ? profiles : (posts || []);
  const rowCountLabel = profilesMode ? 'profiles' : 'posts';

  const periodStr = filters.startDate && filters.endDate
    ? `${fmtDate(filters.startDate)} – ${fmtDate(filters.endDate)}`
    : 'All Time';

  const catConfig = [
    { key: 'Abusive', icon: '⚡', bg: '#fee2e2', border: '#ef4444', text: '#991b1b',
      desc: 'Personal attacks, slurs, and aggressive language directed at individuals or institutions. Concentrated on X/Twitter.' },
    { key: 'Normal (Negative)', icon: '🔴', bg: '#f8fafc', border: '#94a3b8', text: '#334155',
      desc: 'General negative content not yet classified as high-severity. Includes news channels, political commentary, and critical opinion posts.' },
    { key: 'Hate Speech', icon: '⚠️', bg: '#fef3c7', border: '#d97706', text: '#92400e',
      desc: 'Critical alerts. Flagged accounts show content promoting hatred against communities. Immediate review advised.' },
    { key: 'Hate Speech + Threat', icon: '🔒', bg: '#fdf2f8', border: '#7c3aed', text: '#4c1d95',
      desc: 'Combined hate and direct threat language. Highest severity tier requiring escalation.' },
    { key: 'Threat', icon: '📢', bg: '#fff1f2', border: '#e11d48', text: '#881337',
      desc: 'Accounts flagged for direct threatening language. Separate from hate-speech threats above.' },
    { key: 'Sexual Violence', icon: '🧾', bg: '#fdf4ff', border: '#a21caf', text: '#701a75',
      desc: 'Profiles flagged for sexual violence and harassment content. Require legal escalation pathway.' }
  ];

  const catCards = catConfig.map(c => {
    const count = c.key === 'Sexual Violence'
      ? (catCounts['Sexual Violence'] || 0) + (catCounts['Sexual Harassment'] || 0) + (catCounts['Harassment'] || 0)
      : (catCounts[c.key] || 0);
    if (!count) return '';
    return `<div class="cat-card" style="background:${c.bg};border-color:${c.border}">
      <div class="cat-icon">${c.icon}</div>
      <div class="cat-num" style="color:${c.text}">${c.key}</div>
      <div class="cat-name" style="color:${c.text}">${count} profiles</div>
      <div class="cat-desc">${c.desc}</div>
    </div>`;
  }).filter(Boolean).join('');

  const top5Html = top5.map((p, i) =>
    `<div class="top5-row">
      <span class="top5-rank">${i+1}</span>
      <span class="top5-name">${p.handle || p.display_name}</span>
      <span class="top5-count">${p.posts}</span>
    </div>`
  ).join('');

  const tierHtml = Object.entries(severityTiers).map(([label, count]) =>
    `<div class="top5-row">
      <span class="top5-name">${label}</span>
      <span class="top5-count">${count}</span>
    </div>`
  ).join('');

  const tableRows = rows.map((p, i) =>
    `<tr>
      <td class="row-num">${i+1}</td>
      <td><span class="author-name">${p.display_name}</span></td>
      <td><span class="author-handle">${p.handle}</span></td>
      <td>${platformBadge(p.platform)}</td>
      <td>${topicBadge(p.category)}</td>
      <td>${sentimentBadge(p.sentiment || effectiveSentiment)}</td>
      ${profilesMode ? `<td style="font-weight:700;text-align:center">${p.posts}</td>` : ''}
      <td style="color:#475569;white-space:nowrap">${fmtDate(p.date)}</td>
      <td><a class="link-btn" href="${p.link}" target="_blank">↗ View</a></td>
    </tr>`
  ).join('');

  const catLabels = JSON.stringify(Object.keys(catCounts));
  const catValues = JSON.stringify(Object.values(catCounts));
  const platLabels = JSON.stringify(Object.keys(byPlatform).map(platformLabel));
  const platValues = JSON.stringify(Object.values(byPlatform));
  const dayLabels  = JSON.stringify(sortedDays.map(d => d.slice(5)));
  const dayValues  = JSON.stringify(sortedDays.map(d => dailyMap[d]));

  const body = `
  <!-- KPI Row -->
  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-num">${totalProfiles}</div><div class="kpi-sub">Total Profiles</div><div class="kpi-label">Top ${totalProfiles} shown</div></div>
    <div class="kpi-card"><div class="kpi-num">${totalPosts}</div><div class="kpi-sub">Total Posts</div><div class="kpi-label">Top ${totalProfiles} combined</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.x || 0}</div><div class="kpi-sub">X (Twitter)</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.x||0)/totalPosts*100) : 0}% of alerts</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.youtube || 0}</div><div class="kpi-sub">YouTube</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.youtube||0)/totalPosts*100) : 0}% of alerts</div></div>
    <div class="kpi-card"><div class="kpi-num">${byPlatform.facebook || 0}</div><div class="kpi-sub">Facebook</div><div class="kpi-label">${totalPosts > 0 ? Math.round((byPlatform.facebook||0)/totalPosts*100) : 0}% of alerts</div></div>
    <div class="kpi-card"><div class="kpi-num">${hateSpeechCount}</div><div class="kpi-sub">Hate Speech</div><div class="kpi-label">Critical priority</div></div>
    <div class="kpi-card"><div class="kpi-num">${catCounts['Abusive'] || 0}</div><div class="kpi-sub">Abusive</div><div class="kpi-label">Highest category</div></div>
    <div class="kpi-card"><div class="kpi-num">${threatCount}</div><div class="kpi-sub">Threats / Violence</div><div class="kpi-label">Threat + Sex. Violence</div></div>
  </div>

  <!-- Category Overview -->
  <div class="section"><div class="section-title">Category Overview</div></div>
  <div class="cat-grid">${catCards}</div>

  <!-- Distribution Analysis -->
  <div class="section"><div class="section-title">Distribution Analysis</div></div>
  <div class="dist-grid">
    <div class="dist-block">
      <div class="dist-title">Category Breakdown</div>
      <div class="dist-chart-wrap"><canvas id="catChart"></canvas></div>
    </div>
    <div class="dist-block">
      <div class="dist-title">Platform Distribution</div>
      <div class="dist-chart-wrap"><canvas id="platChart"></canvas></div>
    </div>
    <div class="dist-block">
      <div class="dist-title">Severity Tier Split</div>
      ${tierHtml}
      <div class="dist-title" style="margin-top:12px">Top 5 by Post Volume</div>
      ${top5Html}
    </div>
  </div>

  <!-- Timeline -->
  <div class="timeline-wrap">
    <div class="timeline-inner">
      <div class="timeline-title">Daily Grievance Alerts — ${periodStr} (Top ${totalProfiles} sample)</div>
      <div class="timeline-chart"><canvas id="timelineChart"></canvas></div>
    </div>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <div class="table-section-title">${profilesMode ? `Top ${totalProfiles} Flagged Profiles` : `${rows.length} ${rowCountLabel}`} &nbsp;<span style="color:#94a3b8;font-weight:400;font-size:10px">of ${total} total</span></div>
    <table>
      <thead><tr>
        <th>#</th><th>Posted By</th><th>Handle</th><th>Platform</th>
        <th>Category</th><th>Sentiment</th>${profilesMode ? '<th style="text-align:center">Posts</th>' : ''}
        <th>Date</th><th>Link</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <span>Social Intelligence Unit · Generated ${fmtDatetime(new Date())} · ${profilesMode ? `Top ${totalProfiles} of ${total} profiles` : `${rows.length} of ${total} posts`}</span>
    <span class="footer-confidential">CONFIDENTIAL</span>
    <span>All sentiment: ${sentimentDisplay}</span>
  </div>

  <script>
  (function() {
    const COLORS = ['#dc2626','#4b5563','#d97706','#7f1d1d','#b91c1c','#881337','#9f1239','#6b7280'];
    new Chart(document.getElementById('catChart'), {
      type: 'bar',
      data: {
        labels: ${catLabels},
        datasets: [{ data: ${catValues}, backgroundColor: COLORS, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { display: false }, ticks: { font: { size: 8 } } } },
        maintainAspectRatio: false
      }
    });
    new Chart(document.getElementById('platChart'), {
      type: 'doughnut',
      data: {
        labels: ${platLabels},
        datasets: [{ data: ${platValues}, backgroundColor: ['#000000','#ff0000','#1877f2','#e1306c'], borderWidth: 2 }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10 } } },
        maintainAspectRatio: false
      }
    });
    new Chart(document.getElementById('timelineChart'), {
      type: 'bar',
      data: {
        labels: ${dayLabels},
        datasets: [{ data: ${dayValues}, backgroundColor: '#ef4444', borderRadius: 4 }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 8 } } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 8 }, stepSize: 1 } } },
        maintainAspectRatio: false
      }
    });
  })();
  </script>`;

  const headerColor = SENTIMENT_BADGE_STYLES[effectiveSentiment]?.color || '#dc2626';
  return baseHtml(
    'Grievances Report',
    scopeSubtitle('Social Intelligence Unit · Grievance Monitoring', filters.scope),
    `ALL ${sentimentDisplay.toUpperCase()} SENTIMENT`,
    headerColor,
    fmtDatetime(new Date()),
    periodStr,
    profilesMode ? `Showing: Top ${totalProfiles} of ${total} profiles` : `Showing: ${rows.length} of ${total} posts`,
    body
  );
}

// ─── PDF generation (shared Puppeteer utility) ─────────────────────────────────

async function renderPdf(html) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Wait a beat for Chart.js to finish drawing
    await new Promise(r => setTimeout(r, 800));
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  async generateAlertsPdf(filters = {}) {
    const data = await buildAlertsData(filters);
    const html = buildAlertsHtml(data, filters);
    return renderPdf(html);
  },

  async generateGrievancesPdf(filters = {}) {
    const data = await buildGrievancesData(filters);
    const html = buildGrievancesHtml(data, filters);
    return renderPdf(html);
  }
};