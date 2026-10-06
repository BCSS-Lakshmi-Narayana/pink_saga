const Alert = require('../models/Alert');
const Content = require('../models/Content');
const AlertThreshold = require('../models/AlertThreshold');
const Settings = require('../models/Settings');
const { sendAlertEmail } = require('./emailService');

/**
 * Pure function to check velocity metrics without creating alerts
 */
const checkVelocity = async (content, settings) => {
    if (!settings.velocity_alerts_enabled) return null;

    const threshold = await AlertThreshold.findOne({
        platform: content.platform,
        is_active: true
    });

    if (!threshold) return null;

    const currentEngagement = content.engagement || {};
    const postAge = Date.now() - new Date(content.published_at).getTime();
    const postAgeMinutes = postAge / (1000 * 60);

    // Only check posts that are within the configured time window
    if (postAgeMinutes > threshold.time_window_minutes) return null;

    // Check ALL metrics against the unified threshold
    const metricsToCheck = ['likes', 'retweets', 'comments', 'views'];
    let highestPriority = null;
    let triggeredMetrics = [];

    for (const metric of metricsToCheck) {
        const currentValue = currentEngagement[metric] || 0;

        if (currentValue >= threshold.high_threshold) {
            if (!highestPriority || highestPriority.priority !== 'HIGH') {
                highestPriority = { priority: 'HIGH', thresholdTriggered: threshold.high_threshold };
            }
            triggeredMetrics.push({ metric, value: currentValue, priority: 'HIGH' });
        } else if (currentValue >= threshold.medium_threshold) {
            if (!highestPriority || (highestPriority.priority !== 'HIGH' && highestPriority.priority !== 'MEDIUM')) {
                highestPriority = { priority: 'MEDIUM', thresholdTriggered: threshold.medium_threshold };
            }
            triggeredMetrics.push({ metric, value: currentValue, priority: 'MEDIUM' });
        } else if (currentValue >= threshold.low_threshold) {
            if (!highestPriority) {
                highestPriority = { priority: 'LOW', thresholdTriggered: threshold.low_threshold };
            }
            triggeredMetrics.push({ metric, value: currentValue, priority: 'LOW' });
        }
    }

    if (!highestPriority || triggeredMetrics.length === 0) return null;

    return {
        highestPriority,
        triggeredMetrics,
        threshold,
        postAgeMinutes
    };
};

/**
 * Check if a post has gone viral - ANY metric crossed threshold within time window from posting
 * @param {Object} content - Content document
 * @param {Object} settings - Global settings
 */
const checkAndCreateVelocityAlerts = async (content, settings) => {
    try {
        if (!settings.velocity_alerts_enabled) return;
        // An admin deleted a previous alert for this exact post — don't
        // silently recreate it just because it's still inside the velocity
        // window.
        if (content.alert_suppressed) return;

        // REMOVED CHECK: User requested viral alerts for ALL posts, not just risky ones.
        // const riskLevel = String(content.risk_level || '').toLowerCase();
        // const hasRiskLevel = ['medium', 'high', 'critical'].includes(riskLevel);
        // const hasRiskEvidence = Array.isArray(content.risk_factors) && content.risk_factors.length > 0;
        // if (!hasRiskLevel && !hasRiskEvidence) return;

        // Get unified threshold for this platform
        const threshold = await AlertThreshold.findOne({
            platform: content.platform,
            is_active: true
        });

        if (!threshold) return;

        const currentEngagement = content.engagement || {};
        const postAge = Date.now() - new Date(content.published_at).getTime();
        const postAgeMinutes = postAge / (1000 * 60);

        // Only check posts that are within the configured time window
        if (postAgeMinutes > threshold.time_window_minutes) {
            return;
        }

        // Check ALL metrics against the unified threshold
        const metricsToCheck = ['likes', 'retweets', 'comments', 'views'];
        let highestPriority = null;
        let triggeredMetrics = [];

        for (const metric of metricsToCheck) {
            const currentValue = currentEngagement[metric] || 0;

            if (currentValue >= threshold.high_threshold) {
                if (!highestPriority || highestPriority.priority !== 'HIGH') {
                    highestPriority = { priority: 'HIGH', thresholdTriggered: threshold.high_threshold };
                }
                triggeredMetrics.push({ metric, value: currentValue, priority: 'HIGH' });
            } else if (currentValue >= threshold.medium_threshold) {
                if (!highestPriority || (highestPriority.priority !== 'HIGH' && highestPriority.priority !== 'MEDIUM')) {
                    highestPriority = { priority: 'MEDIUM', thresholdTriggered: threshold.medium_threshold };
                }
                triggeredMetrics.push({ metric, value: currentValue, priority: 'MEDIUM' });
            } else if (currentValue >= threshold.low_threshold) {
                if (!highestPriority) {
                    highestPriority = { priority: 'LOW', thresholdTriggered: threshold.low_threshold };
                }
                triggeredMetrics.push({ metric, value: currentValue, priority: 'LOW' });
            }
        }

        if (!highestPriority || triggeredMetrics.length === 0) return;

        // Format triggered metrics for display
        const metricsDisplay = triggeredMetrics
            .map(m => `${m.value.toLocaleString()} ${m.metric}`)
            .join(', ');

        // Check if we already have a viral alert for this content
        const existingAlert = await Alert.findOne({
            content_id: content.id,
            alert_type: 'velocity'
        });

        if (existingAlert) {
            if (getPriorityWeight(highestPriority.priority) > getPriorityWeight(existingAlert.priority)) {
                await Alert.findOneAndUpdate(
                    { id: existingAlert.id },
                    {
                        priority: highestPriority.priority,
                        // risk_level intentionally left untouched here — it reflects
                        // the AI content analysis, not viral engagement velocity.
                        title: `🔥 VIRAL: ${metricsDisplay} in ${Math.round(postAgeMinutes)} min`,
                        description: `Post crossed ${highestPriority.priority} threshold (${highestPriority.thresholdTriggered.toLocaleString()}) within ${threshold.time_window_minutes} minutes of posting`,
                        velocity_data: {
                            metric: triggeredMetrics.map(m => m.metric).join(', '),
                            current_value: Math.max(...triggeredMetrics.map(m => m.value)),
                            previous_value: 0,
                            velocity: Math.max(...triggeredMetrics.map(m => m.value)),
                            time_window_minutes: threshold.time_window_minutes,
                            threshold_triggered: highestPriority.thresholdTriggered,
                            post_age_minutes: Math.round(postAgeMinutes),
                            triggered_metrics: triggeredMetrics
                        }
                    }
                );
                console.log(`[ViralAlert] Upgraded to ${highestPriority.priority} for ${content.content_id} - ${metricsDisplay}`);

                if (highestPriority.priority === 'HIGH' && settings.enable_email_alerts && settings.alert_emails?.length > 0) {
                    const updatedAlert = await Alert.findOne({ id: existingAlert.id });
                    await sendViralAlertEmail(settings, updatedAlert, content);
                }
            }
            return;
        }

        // Create new viral alert
        // Fetch Analysis ID if available (from content object or lookup)
        const analysisId = content.analysis_id || (await require('../models/Analysis').findOne({ content_id: content.id }))?._id;

        // Build nuanced threat details that combine Viral info + AI Analysis info
        const aiReasons = content.threat_reasons || [];
        const combinedReasons = [
            `Viral Verification: Crossed ${highestPriority.priority} threshold (${highestPriority.thresholdTriggered.toLocaleString()})`,
            ...aiReasons
        ];

        const velocityData = {
            metric: triggeredMetrics.map(m => m.metric).join(', '),
            current_value: Math.max(...triggeredMetrics.map(m => m.value)),
            previous_value: 0,
            velocity: Math.max(...triggeredMetrics.map(m => m.value)),
            time_window_minutes: threshold.time_window_minutes,
            threshold_triggered: highestPriority.thresholdTriggered,
            post_age_minutes: Math.round(postAgeMinutes),
            triggered_metrics: triggeredMetrics
        };

        // risk_level/risk_score reflect the AI content analysis only. Virality
        // is still surfaced via `priority` and the "VIRAL" title/alert itself —
        // it just no longer inflates the risk bucket for benign viral posts.
        const finalRiskScore = Number(content.risk_score) || 0;

        const alertData = {
            content_id: content.id,
            alert_type: 'velocity',
            priority: highestPriority.priority,
            published_at: content.published_at || null,
            risk_level: content.risk_level || 'low',
            title: `🔥 VIRAL: ${metricsDisplay} (${aiReasons.length > 0 ? 'Risk Detected' : 'Trending'})`,
            description: `Post crossed ${highestPriority.priority} threshold within ${threshold.time_window_minutes}min.`,
            content_url: content.content_url,
            platform: content.platform,
            author: content.author,
            analysis_id: analysisId, // LINK THE ANALYSIS
            velocity_data: velocityData,
            threat_details: {
                intent: content.threat_intent || 'Viral Surge',
                reasons: combinedReasons,
                highlights: content.risk_factors ? content.risk_factors.map(r => r.keyword) : [],
                risk_score: finalRiskScore, // Enforced Score
                violated_policies: content.violated_policies || [], // Pass policies
                legal_sections: content.legal_sections || []        // Pass laws
            }
        };

        // Create new viral alert
        const alert = new Alert(alertData);

        await alert.save();
        console.log(`[ViralAlert] Created ${highestPriority.priority} alert for ${content.content_id} - ${metricsDisplay} in ${Math.round(postAgeMinutes)}min`);

        if (highestPriority.priority === 'HIGH' && settings.enable_email_alerts && settings.alert_emails?.length > 0) {
            await sendViralAlertEmail(settings, alert, content);
        }
    } catch (error) {
        console.error(`[ViralAlert] Error processing alerts: ${error.message}`);
    }
};

//Create an alert for every new post (when enabled)
const createNewPostAlert = async (content, settings) => {
    try {
        if (!settings.alert_for_every_post) return;
        if (content.alert_suppressed) return; // admin deleted the alert for this post

        // Check for existing HIGH/AI risk alert (Deduplication)
        // If an AI risk or Keyword risk alert exists, we DON'T need a duplicate "New Post" notification
        const riskAlert = await Alert.findOne({
            content_id: content.id,
            alert_type: { $in: ['ai_risk', 'keyword_risk'] }
        });
        if (riskAlert) {
            console.log(`[NewPostAlert] Skipping for ${content.content_id} - Risk Alert already handles this.`);
            return;
        }

        let existingAlert = await Alert.findOne({
            content_id: content.id,
            alert_type: 'new_post'
        });

        if (!existingAlert) {
            const sameContents = await Content.find({ content_id: content.content_id, platform: content.platform });
            const sameContentIds = sameContents.map(c => c.id);

            existingAlert = await Alert.findOne({
                content_id: { $in: sameContentIds },
                alert_type: 'new_post'
            });
        }

        if (existingAlert) return;

        // Inherit risk level if content was already analyzed
        const riskLevel = content.risk_level || 'low';

        // Build highlights from risk_factors keywords
        const highlights = (content.risk_factors || [])
            .map(rf => rf.keyword)
            .filter(Boolean);

        // Enforce Minimum Score based on Risk Level (UI Consistency)
        let finalScore = Number(content.risk_score) || 0;
        const rLevel = String(riskLevel).toLowerCase();

        if (rLevel === 'high' || rLevel === 'critical') {
            finalScore = Math.max(finalScore, 80);
        } else if (rLevel === 'medium') {
            finalScore = Math.max(finalScore, 45);
        }

        console.log(`[NewPostAlert] Creating alert for ${content.id}. RiskLevel:${rLevel}, OriginalScore:${content.risk_score}, FinalScore:${finalScore}`);

        const alert = new Alert({
            content_id: content.id,
            alert_type: 'new_post',
            priority: 'LOW',
            risk_level: riskLevel, // Inherit or default to low
            published_at: content.published_at || null,
            title: `New Post: ${content.author}`,
            description: `New content detected from ${content.author} on ${content.platform}`,
            content_url: content.content_url,
            platform: content.platform,
            author: content.author,
            // Copy threat details if they were attached to content during analysis
            threat_details: {
                intent: content.threat_intent || 'New Post',
                reasons: content.threat_reasons?.length > 0
                    ? content.threat_reasons
                    : [`New content from monitored source: ${content.author}`],
                highlights: highlights,
                risk_score: finalScore || (rLevel === 'medium' ? 45 : finalScore),
                violated_policies: content.violated_policies || [], // Inherit policies
                legal_sections: content.legal_sections || []        // Inherit laws
            }
        });

        await alert.save();
        console.log(`[NewPostAlert] Created alert for ${content.content_id} from ${content.author} (Risk: ${riskLevel})`);
    } catch (error) {
        console.error(`[NewPostAlert] Error creating new post alert: ${error.message}`);
    }
};

//Send viral alert email
const sendViralAlertEmail = async (settings, alert, content) => {
    try {
        if (!settings.smtp_config?.host) return;

        const alertData = {
            risk_level: alert.priority.toLowerCase(),
            platform: alert.platform,
            author: alert.author,
            content_url: alert.content_url,
            description: alert.description,
            triggered_keywords: [
                `Metrics: ${alert.velocity_data.metric}`,
                `Time: ${alert.velocity_data.post_age_minutes || alert.velocity_data.time_window_minutes} minutes`
            ],
            created_at: new Date().toISOString()
        };

        await sendAlertEmail(settings.smtp_config, settings.alert_emails, alertData);
    } catch (error) {
        console.error(`[ViralAlert] Failed to send email: ${error.message}`);
    }
};

const getPriorityWeight = (priority) => {
    const weights = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    return weights[priority] || 0;
};

const updateEngagementHistory = async (contentId, engagement) => {
    try {
        await Content.findOneAndUpdate(
            { id: contentId },
            {
                $push: {
                    engagement_history: {
                        $each: [{
                            timestamp: new Date(),
                            views: engagement.views || 0,
                            likes: engagement.likes || 0,
                            comments: engagement.comments || 0
                        }],
                        $slice: -50
                    }
                }
            }
        );
    } catch (error) {
        console.error(`[ViralAlert] Error updating engagement history: ${error.message}`);
    }
};

//Seed default thresholds - ONE per platform (unified for all metrics)
const seedDefaultThresholds = async () => {
    try {
        const count = await AlertThreshold.countDocuments();
        if (count > 0) return;

        const defaults = [
            // One unified threshold per platform
            { platform: 'x', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 },
            { platform: 'youtube', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 },
            { platform: 'facebook', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 }
        ];

        for (const threshold of defaults) {
            await AlertThreshold.create(threshold);
        }
        console.log('[ViralAlert] Seeded default thresholds (unified per platform)');
    } catch (error) {
        console.error(`[ViralAlert] Error seeding thresholds: ${error.message}`);
    }
};

module.exports = {
    checkAndCreateVelocityAlerts,
    createNewPostAlert,
    updateEngagementHistory,
    seedDefaultThresholds,
    getPriorityWeight,
    checkVelocity
};
