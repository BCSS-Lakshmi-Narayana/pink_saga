require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const connectDB = require('./config/db');
const { initDisplayGate } = require('./config/displayGate');
const { startMonitoring } = require('./services/monitorService');
const { startTempContentProcessor } = require('./services/tempContentProcessor');
const { seedDefaultThresholds } = require('./services/velocityAlertService');
const grievanceService = require('./services/grievanceService');
const { seedRecurringEvents } = require('./controllers/masterCalendarController');
const User = require('./models/User');
const Settings = require('./models/Settings');
const Source = require('./models/Source');
const Content = require('./models/Content');
const GrievanceSource = require('./models/GrievanceSource');
const Keyword = require('./models/Keyword');
const blugateClient = require('./services/blugateClient');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { buildEmailLookup, normalizeEmail, normalizeRole } = require('./utils/authIdentity');
const Alert = require('./models/Alert');
const Report = require('./models/Report');
const cacheService = require('./services/cacheService');

const app = express();

// Trust proxy for proper protocol detection behind nginx/load balancer
app.set('trust proxy', 1);

// Middleware
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (server-to-server, curl, mobile apps).
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  // PATCH was missing, so the browser preflight rejected every PATCH route
  // (news sentiment edits, scoped-user updates, x actions, youtube status)
  // before the request was sent. curl worked because it doesn't preflight.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/deepfake', require('./routes/deepfakeRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/sources', require('./routes/sourceRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/intelligence', require('./routes/intelligenceDashboardRoutes'));
app.use('/api/keywords', require('./routes/keywordRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/youtube', require('./routes/youtube.routes'));
app.use('/api/x', require('./routes/x.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/search', require('./routes/searchRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/master-calendar', require('./routes/masterCalendarRoutes'));
app.use('/api/alert-thresholds', require('./routes/alertThresholdRoutes'));

app.use('/api/grievances', require('./routes/grievanceRoutes'));
app.use('/api/admin', require('./routes/profileSettingsRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/ongoing-events', require('./routes/ongoingEventRoutes'));
app.use('/api/daily-programmes', require('./routes/dailyProgrammeRoutes'));
app.use('/api/export', require('./routes/exportRoutes'));
app.use('/api/uploads', require('./routes/uploadRoutes'));
app.use('/api/instagram-stories', require('./routes/instagramStoryRoutes'));
app.use('/api/dial100-incidents', require('./routes/dial100IncidentRoutes'));
app.use('/api/criticism', require('./routes/criticismRoutes'));
app.use('/api/grievance-workflow', require('./routes/grievanceWorkflowRoutes'));
app.use('/api/query-workflow', require('./routes/queryRoutes'));
app.use('/api/suggestion', require('./routes/suggestionRoutes'));
app.use('/api/policies', require('./routes/policyRoutes'));
app.use('/api/templates', require('./routes/templatesRoutes'));
app.use('/api/poi', require('./routes/poiRoutes'));
app.use('/api/telegram', require('./routes/telegramRoutes'));
app.use('/api/unrest', require('./routes/unrest.routes'));
app.use('/api/news',  require('./routes/newsRoutes'));
app.use('/api/intelligence-reports', require('./routes/intelligenceReportRoutes'));
app.use('/api/search-trends', require('./routes/searchTrends'));
app.use('/api/constituency-intel', require('./routes/constituencyIntelligenceRoutes'));
app.use('/api/geo-intel', require('./routes/geoIntelRoutes'));
// AI Campaigns — suggestion engine + the campaigns it produces.
app.use('/api/campaign-suggestions', require('./routes/campaignSuggestionRoutes'));
app.use('/api/viral-campaigns', require('./routes/viralCampaignRoutes'));
app.use('/api/dashboard', require('./routes/apDashboardRoutes'));
app.use('/api/cm-dashboard', require('./routes/cmDashboardRoutes'));
app.use('/api/voter-profiles', require('./routes/voterProfileRoutes'));
app.use('/api/booth-imports', require('./routes/boothImportRoutes'));
app.use('/api/web-articles', require('./routes/webArticleRoutes'));
app.use('/api/youtube-live', require('./routes/youtubeLiveRoutes'));

// Proxy for Location Service (to share ngrok tunnel). Signed-in users only,
// and only the two endpoints the frontend uses, so it cannot be used to reach
// arbitrary paths on the internal service.
const LOCATION_PROXY_PATHS = new Set(['extract-location', 'extract-locations-batch']);
app.post('/api/location-extraction/:path*', require('./middleware/authMiddleware').protect, async (req, res) => {
  if (!LOCATION_PROXY_PATHS.has(req.params.path)) {
    return res.status(404).json({ error: 'Unknown location endpoint' });
  }
  try {
    const locationServiceBaseUrl = String(process.env.LOCATION_SERVICE_URL || 'http://localhost:5002').trim().replace(/\/+$/, '');
    const targetUrl = `${locationServiceBaseUrl}/api/${req.params.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    const response = await axios({
      method: 'post',
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});


app.get('/api/verify-v2', (req, res) => res.json({ status: 'ok', version: 'v2-diagnostic', timestamp: new Date() }));
app.get('/api/ping', (req, res) => res.json({ status: 'ok', msg: 'Deepfake integration check' }));
app.use('/api/rbac', require('./routes/rbacRoutes'));
//app.get('/api/ping', (req, res) => res.json({ status: 'ok', msg: 'Deepfake integration check' }));

// Catch-all 404 handler for debugging untracked routes
app.use((req, res, next) => {
  console.log(`[404] Path NOT FOUND: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Path ${req.originalUrl} not found` });
});

const upsertDefaultUser = async ({ email, password, full_name, role, previousEmails = [] }) => {
  const normalizedEmail = normalizeEmail(email);
  const lookupEmails = [normalizedEmail, ...previousEmails.map(normalizeEmail)].filter(Boolean);

  if (!normalizedEmail || !full_name || !role) {
    return;
  }

  const existingUser = await User.findOne({
    $or: lookupEmails.map((candidateEmail) => ({ email: buildEmailLookup(candidateEmail) }))
  });

  // No password configured: never overwrite an existing account, and give a
  // brand-new one a random password shown once, instead of a guessable default.
  if (!password) {
    if (existingUser) return;
    password = crypto.randomBytes(12).toString('base64url');
    console.warn(`[Setup] Created ${role} ${normalizedEmail} with one-time password: ${password} — set it in .env or change it after login.`);
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  if (existingUser) {
    existingUser.email = normalizedEmail;
    existingUser.password = hashedPassword;
    existingUser.full_name = String(full_name).trim();
    existingUser.role = normalizeRole(role);
    existingUser.is_active = true;
    await existingUser.save();
    return;
  }

  await User.create({
    email: normalizedEmail,
    password: hashedPassword,
    full_name: String(full_name).trim(),
    role: normalizeRole(role),
    is_active: true
  });
};

// Default Admin/User Accounts
const createDefaultUsers = async () => {
  try {
    const defaultUsers = [
      {
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@cgwatch.local',
        password: process.env.DEFAULT_ADMIN_PASSWORD,
        full_name: process.env.DEFAULT_ADMIN_NAME || 'SANKET Super Admin',
        role: 'superadmin'
      },
      // Optional second superadmin, created only when configured in .env.
      {
        email: process.env.GRIEVANCE_ADMIN_EMAIL,
        password: process.env.GRIEVANCE_ADMIN_PASSWORD,
        full_name: process.env.GRIEVANCE_ADMIN_NAME || 'Grievance Admin',
        role: 'superadmin'
      }
    ];

    for (const user of defaultUsers) {
      await upsertDefaultUser(user);
    }
  } catch (error) {
    //console.error(`Error creating default users: ${error.message}`);
  }
};

// Default Settings
const createDefaultSettings = async () => {
  try {
    const settings = await Settings.findOne({ id: 'global_settings' });
    if (!settings) {
      await Settings.create({
        id: 'global_settings',
        high_risk_threshold: 70,
        medium_risk_threshold: 40,
        risk_threshold_high: 70,
        risk_threshold_medium: 40,
        monitoring_interval_minutes: 5,
        enable_email_alerts: true
      });
      //console.log('Default settings created');
    }
  } catch (error) {
    //console.error(`Error creating default settings: ${error.message}`);
  }
};

const seedSources = async () => {
  try {
    const sourcesList = require('./data/sources_list.json');
    const canResolveYoutube = blugateClient.hasCredentials();

    //console.log(`Seeding ${sourcesList.length} sources...`);

    for (const source of sourcesList) {
      // Check if exists by identifier or display name
      const existing = await Source.findOne({
        $or: [
          { identifier: source.identifier },
          { display_name: source.display_name, platform: source.platform }
        ]
      });

      if (existing) continue;

      let identifier = source.identifier;

      // Resolve YouTube handle/name to Channel ID if needed
      if (source.platform === 'youtube' && !identifier.startsWith('UC') && canResolveYoutube) {
        try {
          const response = await blugateClient.get('youtube', 'search', {
            part: 'snippet',
            q: identifier,
            type: 'channel',
            maxResults: 1
          });

          if (response.data.items && response.data.items.length > 0) {
            identifier = response.data.items[0].id.channelId;
            // Also try to get stats here if possible, to avoid 0s
            // But doing it for all might hit quota.
            // We will rely on user Sync for seeded data to save quota.
            //console.log(`Resolved ${source.identifier} to ${identifier}`);
          } else {
            //console.warn(`Could not resolve YouTube handle: ${source.identifier}`);
          }
        } catch (err) {
          //console.error(`Error resolving ${source.identifier}: ${err.message}`);
        }
      }

      try {
        await Source.create({
          platform: source.platform,
          identifier: identifier,
          display_name: source.display_name,
          category: source.category,
          created_by: 'system_seed',
          is_active: true
        });
        //console.log(`Seeded source: ${source.display_name} (${source.platform})`);
      } catch (err) {
        if (err.code !== 11000) { // Ignore duplicate key errors
          //console.error(`Failed to seed ${source.display_name}: ${err.message}`);
        }
      }
    }
    //console.log('Seeding completed.');
  } catch (error) {
    //console.error('Error seeding sources:', error);
  }
};

const fixIndexes = async () => {
  try {
    const indexes = await Content.collection.indexes();
    const keyIndex = indexes.find(idx => idx.name === 'key_1');
    if (keyIndex) {
      //console.log('Dropping invalid index key_1 from contents collection...');
      await Content.collection.dropIndex('key_1');
      //console.log('Index dropped.');
    }

    const legacyContentIdIndex = indexes.find(idx => idx.name === 'content_id_1');
    if (legacyContentIdIndex) {
      //console.log('Dropping legacy unique index content_id_1 from contents collection...');
      await Content.collection.dropIndex('content_id_1');
      //console.log('Legacy index dropped.');
    }

    const compoundIndexName = 'platform_1_content_id_1';
    const compoundIndex = indexes.find(idx => idx.name === compoundIndexName);
    if (!compoundIndex) {
      //console.log('Creating compound unique index platform_1_content_id_1 on contents collection...');
      await Content.collection.createIndex({ platform: 1, content_id: 1 }, { unique: true, name: compoundIndexName });
      //console.log('Compound index created.');
    }
  } catch (error) {
    if (error.code !== 27) {
      console.error('Error fixing indexes:', error.message);
    }
  }
};

// Grievance Auto-Fetch Scheduler - runs every 10 minutes
const GRIEVANCE_FETCH_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds
let grievanceSchedulerRunning = false;

const startGrievanceScheduler = () => {
  //console.log('[Grievance Scheduler] Starting auto-fetch every 10 minutes...');

  // Run immediately on startup (after a small delay to let everything initialize)
  setTimeout(async () => {
    await runGrievanceFetch();
  }, 30000); // 30 second delay on startup

  // Then run every 10 minutes
  setInterval(async () => {
    await runGrievanceFetch();
  }, GRIEVANCE_FETCH_INTERVAL);
};

const runGrievanceFetch = async () => {
  // Prevent concurrent runs
  if (grievanceSchedulerRunning) {
    //console.log('[Grievance Scheduler] Previous fetch still running, skipping...');
    return;
  }

  try {
    grievanceSchedulerRunning = true;

    // Check if there are any active grievance sources
    const activeSources = await GrievanceSource.countDocuments({ is_active: true });
    if (activeSources === 0) {
      //console.log('[Grievance Scheduler] No active grievance sources configured, skipping fetch');
      return;
    }

    //console.log(`[Grievance Scheduler] Auto-fetching grievances for ${activeSources} active sources...`);
    // Fetch grievances for today (no date filter = recent tweets)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const result = await grievanceService.fetchAllGrievances(todayStr, todayStr);
    //console.log(`[Grievance Scheduler] Auto-fetch complete: ${result.newGrievances} new grievances found`);

    // Also fetch keyword-based content from Facebook, Instagram, YouTube
    try {
      const kwResult = await grievanceService.fetchKeywordGrievances();
      //console.log(`[Grievance Scheduler] Keyword fetch complete: ${kwResult.newGrievances} new from keywords`);
    } catch (kwErr) {
      //console.error('[Grievance Scheduler] Keyword fetch error:', kwErr.message);
    }

  } catch (error) {
    //console.error('[Grievance Scheduler] Error during auto-fetch:', error.message);
  } finally {
    grievanceSchedulerRunning = false;
  }
};

// ─── Analysis retry (complete-or-pending pipeline) ─────────────────────────
/**
 * Alerts and mentions are written only from a COMPLETE analysis. A post whose
 * analysis failed or fell back (model timeout, Ollama busy) is left 'pending'
 * with no verdict; this job re-analyses those every ANALYSIS_RETRY_INTERVAL_MS
 * (default 5 min) and writes the alert / mention verdict once it completes.
 * Each record is retried up to MAX_ANALYSIS_ATTEMPTS (default 6), then marked
 * 'failed'.
 */
let analysisRetryRunning = false;
const startAnalysisRetryScheduler = () => {
  const INTERVAL_MS = Number(process.env.ANALYSIS_RETRY_INTERVAL_MS || 5 * 60 * 1000);
  const BATCH = Number(process.env.ANALYSIS_RETRY_BATCH || 25);
  const tick = async () => {
    if (analysisRetryRunning) return;
    analysisRetryRunning = true;
    try {
      const { retryPendingAnalyses } = require('./services/monitorService');
      const { retryPendingGrievanceAnalyses } = require('./services/grievanceService');
      const alerts = await retryPendingAnalyses({ limit: BATCH });
      const mentions = await retryPendingGrievanceAnalyses({ limit: BATCH });
      if (alerts.picked || mentions.picked) {
        console.log(`[AnalysisRetry] alerts: ${alerts.completed}/${alerts.picked} completed · mentions: ${mentions.completed}/${mentions.picked} completed`);
      }
    } catch (err) {
      console.warn('[AnalysisRetry] tick failed:', err.message);
    } finally {
      analysisRetryRunning = false;
    }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, INTERVAL_MS);
};

// ─── RSS target-aware scorer ────────────────────────────────────────────────
/**
 * Scores newly ingested news articles through the SAME pipeline as Mentions and
 * Alerts, so all three carry one stance vocabulary.
 *
 * WHY THIS HAS TO BE A SCHEDULER
 * The Python engine (Blura-Engine) owns RSS ingest and writes with `$setOnInsert`.
 * It sets its own `sentiment` but knows nothing about `political_stance`,
 * `target_sentiment` or the campaign taxonomy. Nothing in Node was watching for
 * those rows — `rssAnalysisService` was only ever reachable from a CLI script —
 * so every new article sat unscored indefinitely and the news cards had no stance
 * to show. Measured before this existed: 1,832 articles, 0 with a stance.
 *
 * `pipeline_analyzed_at: null` is the work queue and analyzeArticle stamps it, so
 * each article is picked up exactly once — but ONLY when it actually gets scored.
 * analyzeArticle returns early without writing in two cases, and both have to be
 * excluded by the filter rather than left to the service, or they would come back
 * in every batch forever and eventually fill it, starving real work:
 *   • `manual_sentiment_override` — an operator corrected it by hand; a re-score
 *     must never quietly revert that.
 *   • no usable text at all — nothing to analyse, so it can never clear itself.
 */
let rssScorerRunning = false;
const startRssScorer = () => {
  const INTERVAL_MS = Number(process.env.RSS_SCORE_INTERVAL_MS || 10 * 60 * 1000);
  // Each article costs two LLM calls on the SHARED Ollama host, so a batch of 10
  // is roughly one interval's worth of work. The `rssScorerRunning` guard means
  // an overrunning tick is skipped, never stacked.
  const BATCH = Number(process.env.RSS_SCORE_BATCH || 10);
  const tick = async () => {
    if (rssScorerRunning) return;
    rssScorerRunning = true;
    try {
      const svc = require('./services/rssAnalysisService');
      const res = await svc.analyzeArticles(
        {
          pipeline_analyzed_at: null,
          manual_sentiment_override: { $ne: true },
          pipeline_attempts: { $not: { $gte: Number(process.env.MAX_ANALYSIS_ATTEMPTS || 6) } },
          $or: [
            { title: { $nin: [null, ''] } },
            { title_english: { $nin: [null, ''] } },
            { summary: { $nin: [null, ''] } },
            { content: { $nin: [null, ''] } },
          ],
        },
        { limit: BATCH, write: true },
      );
      if (res?.total) {
        console.log(`[RssScorer] tick: total=${res.total} analyzed=${res.analyzed} skipped=${res.skipped} failed=${res.failed}`);
      }
    } catch (err) {
      console.warn('[RssScorer] tick failed:', err.message);
    } finally {
      rssScorerRunning = false;
    }
  };
  // First run 2 minutes after startup, so it never competes with boot work or
  // with the grievance fetch that runs at 30 s — both share the Ollama host.
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, INTERVAL_MS);
};

/**
 * Constituency location sweep — Alerts and NewsArticles get an AP constituency
 * stamped after the fact, since neither creation path (monitorService,
 * velocityAlertService, the Python RSS engine) ever ran location detection.
 * See services/constituencyLocationSweepService.js for measured coverage and
 * why the pending query is keyed on `attempted_at`, not on a missing seat.
 *
 * Handles UPCOMING alerts/news automatically, forever, at a trickle — the
 * existing backlog (11,461 alerts / 3,656 articles at the time this was
 * measured) is drained by `npm run backfill:locations` instead, since running
 * that volume through this tick would take days at a batch of 10 and race the
 * paid RapidAPI tier against real ingest traffic.
 */
let constituencySweepRunning = false;
const startConstituencySweep = () => {
  const INTERVAL_MS = Number(process.env.CONSTITUENCY_SWEEP_INTERVAL_MS || 5 * 60 * 1000);
  const BATCH = Number(process.env.CONSTITUENCY_SWEEP_BATCH || 10);
  const tick = async () => {
    if (constituencySweepRunning) return;
    constituencySweepRunning = true;
    try {
      const { runSweep } = require('./services/constituencyLocationSweepService');
      const res = await runSweep({ surface: 'all', limit: BATCH });
      const a = res.alert, n = res.news;
      if ((a && a.scanned) || (n && n.scanned)) {
        console.log(`[ConstituencySweep] tick: alerts(scanned=${a?.scanned || 0} placed=${a?.placed || 0}) news(scanned=${n?.scanned || 0} placed=${n?.placed || 0})`);
      }
    } catch (err) {
      console.warn('[ConstituencySweep] tick failed:', err.message);
    } finally {
      constituencySweepRunning = false;
    }
  };
  // 3 minutes after startup — after the RSS scorer's 2-minute delay, since both
  // can touch the same NewsArticle rows and this one should run second.
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, INTERVAL_MS);
};

// ─── Engager Analysis Auto-Queue (runs every hour) ───────────────────────────
const startEngagerAutoQueue = () => {
  // Lazy-require so a missing/optional service can't crash boot.
  const safeCall = async () => {
    try {
      const svc = require('./services/engagerAnalysisService');
      if (typeof svc.autoQueueNewHandles === 'function') {
        await svc.autoQueueNewHandles();
      }
    } catch (err) {
      console.warn('[EngagerAutoQueue] tick failed:', err.message);
    }
  };
  // First run 2 minutes after startup
  setTimeout(safeCall, 2 * 60 * 1000);
  // Then every 1 hour — processes one handle per run
  setInterval(safeCall, 60 * 60 * 1000);
};

// ─── Content Availability Checker (runs every 6 hours) ──────────────────────
let availabilityCheckerRunning = false;

const startAvailabilityChecker = () => {
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  // Run first check 2 minutes after startup
  setTimeout(async () => {
    await runAvailabilityCheckOnce();
  }, 2 * 60 * 1000);

  setInterval(async () => {
    await runAvailabilityCheckOnce();
  }, INTERVAL_MS);
};

const runAvailabilityCheckOnce = async () => {
  if (availabilityCheckerRunning) return;
  availabilityCheckerRunning = true;
  try {
    const { runFullAvailabilityCheck } = require('./services/availabilityCheckerService');
    const stats = await runFullAvailabilityCheck();
    console.log('[AvailabilityChecker] Scheduled check complete:', JSON.stringify(stats));
  } catch (err) {
    console.error('[AvailabilityChecker] Scheduled check error:', err.message);
  } finally {
    availabilityCheckerRunning = false;
  }
};

// ─── Mojibake Healer (runs every 30 minutes) ────────────────────────────────
// Repairs any post stored with double-encoded text (UTF-8 read as Windows-1252
// upstream). The ingest guards re-request a mangled response and catch nearly
// all of it, but grievances are written once and never re-polled, so anything
// that slips through would otherwise stay corrupt forever. Work is capped per
// sweep, so this cannot starve the event loop or run away with the API quota.
let mojibakeHealerRunning = false;

const runMojibakeHealCycle = async () => {
  if (mojibakeHealerRunning) return;
  mojibakeHealerRunning = true;
  try {
    const { runMojibakeHealOnce } = require('./services/mojibakeHealerService');
    await runMojibakeHealOnce();
  } catch (err) {
    console.error('[MojibakeHealer] sweep error:', err.message);
  } finally {
    mojibakeHealerRunning = false;
  }
};

const startMojibakeHealer = () => {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  // First sweep 5 minutes after startup, so it never competes with boot work.
  setTimeout(runMojibakeHealCycle, 5 * 60 * 1000);
  setInterval(runMojibakeHealCycle, INTERVAL_MS);
};

// ─── Cache Warming Functions ──────────────────────────────────────────────────

const warmGatedAlertIdsCache = async () => {
  try {
    const gatedAlertIds = await Alert.find(
      { matched_keywords: { $exists: true, $ne: [] } },
      { id: 1 }
    ).lean().exec();
    const alertIdArray = gatedAlertIds.map(a => a.id);
    await cacheService.set('gated:alert:ids:v1', alertIdArray, 300); // 5 minutes
    console.log(`[CacheWarmup] Gated alert IDs cached: ${alertIdArray.length} alerts`);
    return alertIdArray.length;
  } catch (err) {
    console.error('[CacheWarmup] Failed to warm gated alert IDs cache:', err.message);
    return 0;
  }
};

const warmProfilesCache = async () => {
  try {
    // Get all gated alert IDs (use cache if available, otherwise query)
    let gatedAlertIds = [];
    try {
      const cached = await cacheService.get('gated:alert:ids:v1');
      if (cached) {
        gatedAlertIds = cached;
      }
    } catch (_) {
      // ignore cache miss, will query DB
    }

    if (gatedAlertIds.length === 0) {
      const alertDocs = await Alert.find(
        { matched_keywords: { $exists: true, $ne: [] } },
        { id: 1 }
      ).lean().exec();
      gatedAlertIds = alertDocs.map(a => a.id);
    }

    if (gatedAlertIds.length === 0) {
      console.log('[CacheWarmup] No gated alerts found, skipping profiles cache warming');
      return 0;
    }

    console.log(`[CacheWarmup] Looking for reports with ${gatedAlertIds.length} gated alert IDs...`);

    // Get all reports with gated alert IDs
    const allReports = await Report.find({
      alert_id: { $in: gatedAlertIds }
    }).lean().exec();

    console.log(`[CacheWarmup] Found ${allReports ? allReports.length : 0} reports in DB`);

    // Debug: Check total reports in collection
    const totalReportsInDb = await Report.countDocuments();
    console.log(`[CacheWarmup] Total reports in collection: ${totalReportsInDb}`);

    if (!allReports || allReports.length === 0) {
      console.log('[CacheWarmup] No reports match gated alert IDs - check if alert_id references are correct');
      return 0;
    }

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

    // Sort by alert count descending
    const sortedProfiles = Array.from(profileMap.values())
      .sort((a, b) => b.alertCount - a.alertCount || new Date(b.latestAlert) - new Date(a.latestAlert));

    // Cache for 1 HOUR (3600 seconds)
    await cacheService.set('profiles:all:grouped:v1', sortedProfiles, 3600);
    console.log(`[CacheWarmup] Profiles cache warmed: ${sortedProfiles.length} unique profiles from ${allReports.length} reports`);
    return sortedProfiles.length;
  } catch (err) {
    console.error('[CacheWarmup] Failed to warm profiles cache:', err.message);
    return 0;
  }
};

const startServer = async () => {
  // Connect to database
  await connectDB();

  /**
   * Resolve the display gate's legacy line before any request can be served.
   * It is persisted in `system_flags`, so this reads the same value every boot
   * instead of quietly moving the line forward and releasing unscored records —
   * see config/displayGate.js. Never throws; on failure the gates stay open.
   */
  await initDisplayGate();

  // Create default users
  await createDefaultUsers();

  // Create default settings
  await createDefaultSettings();

  // Keywords + GrievanceSources are managed from the frontend.
  // No backend seeding. The DB-driven scheduler reads those collections fresh every tick.

  // Seed sources
  // await seedSources();

  // Fix indexes
  await fixIndexes();

  // Seed default velocity alert thresholds
  await seedDefaultThresholds();

  // Seed recurring master calendar events used by Events Report
  await seedRecurringEvents();

  // Start Monitoring Service OR temp content processor (engine mode)
  const useEngine = String(process.env.USE_ENGINE || 'false').toLowerCase() === 'true';
  if (useEngine) {
    console.log('[Server] USE_ENGINE=true -> starting temp content processor and skipping direct monitoring fetch loops');
    startTempContentProcessor();
  } else {
    console.log('[Server] USE_ENGINE=false -> starting existing monitoring service');
    startMonitoring();
  }

  // Start Grievance Auto-Fetch Scheduler only in legacy mode.
  if (!useEngine) {
    startGrievanceScheduler();
  } else {
    console.log('[Server] USE_ENGINE=true -> skipping backend Grievance Auto-Fetch (handled by engine)');
  }

  // Start Engager Analysis Auto-Queue (every 15 minutes)
  startEngagerAutoQueue();

  // Re-analyse alerts / mentions whose analysis did not complete.
  startAnalysisRetryScheduler();

  // Score newly ingested RSS articles through the shared target-aware pipeline
  // (every RSS_SCORE_INTERVAL_MS, default 10 min; RSS_SCORE_BATCH per run).
  // Without this, news carries the Python engine's sentiment but no stance,
  // and never joins the campaign taxonomy.
  startRssScorer();

  // Stamp an AP constituency onto new Alerts/NewsArticles as they arrive, so
  // Constituency Leader Popularity has somewhere to group upcoming posts by.
  // The existing backlog is drained separately via
  // `npm run backfill:locations` — see services/constituencyLocationSweepService.js.
  startConstituencySweep();

  // Start Content Availability Checker (every 6 hours)
  startAvailabilityChecker();

  // Start Mojibake Healer (every 30 minutes). Re-fetches any post stored with
  // double-encoded text — grievances especially, since they are never re-polled.
  startMojibakeHealer();

  // Start YouTube Live chat watcher. Reads live chat over InnerTube, so it
  // costs no YouTube Data API quota and runs in both engine and legacy modes.
  try {
    await require('./services/youtubeLiveService').startWatcher();
  } catch (err) {
    console.warn('[Server] Could not initialize YouTube Live watcher:', err.message);
  }

  // Start Telegram Auto-Sync/Scrape only in legacy mode.
  if (!useEngine) {
    try {
      const telegramService = require('./services/telegramService');
      telegramService.startTelegramAutoSync();
    } catch (err) {
      console.warn('[Server] Could not initialize Telegram Auto-Sync:', err.message);
    }
  } else {
    console.log('[Server] USE_ENGINE=true -> skipping backend Telegram Auto-Sync (handled by engine)');
  }

  const PORT = process.env.PORT || 8000;

  // ─── Start listening FIRST ───
  // These caches used to be awaited before app.listen(), which meant the port
  // stayed closed for as long as the warm-up took — nginx saw connection
  // refused (502) and then timeouts (504) on every restart. Both caches are
  // read-through, so a cold miss costs one slower request; it is never a
  // correctness issue. Serving immediately and warming in the background turns
  // a multi-minute outage per restart into about a second.
  app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  TELANGANA POLITICAL WATCH · KCR · BRS              ║`);
    console.log(`║  Social Media Intelligence backend listening on :${String(PORT).padEnd(6)}║`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);

    // ─── Warm caches in the background, after the port is open ───
    console.log('[Server] Warming caches in background (requests are already being served)...');
    warmGatedAlertIdsCache()
      .then(() => warmProfilesCache())
      .then(() => console.log('[Server] Cache warm-up complete.'))
      .catch((err) => console.warn('[Server] Cache warm-up failed (non-fatal):', err.message));
  });
};

startServer();