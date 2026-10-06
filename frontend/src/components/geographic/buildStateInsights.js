/**
 * Rule-based "insights summary" for the State Overview tab — computed
 * client-side from data the page already has (summary + district
 * leaderboard), the same "real aggregates, no LLM call" approach
 * constituencyIntelligenceController uses for its narrative insights.
 * Returns [{ tone: 'critical'|'warning'|'positive'|'info', text }].
 */
const buildStateInsights = (summary, districts = []) => {
  if (!summary) return [];
  const notes = [];

  const risingTopic = summary.emerging_topics?.[0];
  if (risingTopic) {
    notes.push({
      tone: 'warning',
      text: `"${risingTopic.topic}" is emerging fast — up ${risingTopic.trend_change_pct}% vs the previous period (${risingTopic.mention_count.toLocaleString()} mentions).`,
    });
  }

  const topRisk = [...districts].sort((a, b) => b.risk_index - a.risk_index)[0];
  if (topRisk && topRisk.risk_index >= 40) {
    notes.push({
      tone: 'critical',
      text: `${topRisk.name} carries the highest political risk (index ${topRisk.risk_index}) — ${topRisk.negative_pct}% negative sentiment across ${topRisk.total_mentions.toLocaleString()} mentions.`,
    });
  }

  const mostImproved = [...districts].sort((a, b) => b.sentiment_index - a.sentiment_index)[0];
  if (mostImproved && mostImproved.sentiment_index > 20) {
    notes.push({
      tone: 'positive',
      text: `${mostImproved.name} shows the strongest net-positive sentiment (index ${mostImproved.sentiment_index}) this period.`,
    });
  }

  if (summary.trend?.total_mentions_change_pct !== undefined) {
    const chg = summary.trend.total_mentions_change_pct;
    if (Math.abs(chg) >= 10) {
      // Volume change is inherently neutral information (unlike sentiment
      // share) — always 'info', matching TrendIndicator's rationale, rather
      // than tagging a decline "positive" while the KPI strip above colors
      // the same kind of change amber-neutral too.
      notes.push({
        tone: 'info',
        text: `Overall conversation volume ${chg > 0 ? 'grew' : 'declined'} ${Math.abs(chg)}% versus the previous period.`,
      });
    }
  }

  const topPlatform = summary.platform_distribution?.[0];
  if (topPlatform) {
    notes.push({
      tone: 'info',
      text: `${topPlatform.platform === 'x' ? 'X (Twitter)' : topPlatform.platform} carries the most volume (${topPlatform.pct}% of all monitored mentions).`,
    });
  }

  if (!notes.length) {
    notes.push({ tone: 'info', text: 'No significant sentiment or volume swings detected in this window.' });
  }

  return notes.slice(0, 5);
};

export default buildStateInsights;
