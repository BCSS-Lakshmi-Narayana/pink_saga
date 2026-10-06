import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import {
  Sparkles, TrendingUp, ShieldAlert, Megaphone, Newspaper, X, Send, RefreshCw, Pencil,
  FileSearch, ChevronDown, ChevronUp, ExternalLink, RotateCcw, Archive, SlidersHorizontal,
} from 'lucide-react';
// The same creative editor the manual request form uses, so an AI draft gets media
// upload, tag pills and per-platform variants rather than a thinner second form.
import {
  PLATFORMS, CONTENT_TYPES_BY_PLATFORM, todayStr,
  inp, ta, Field, CreativeEditor, PlatformBreakdown,
} from '../components/viral/creative';

// ── Source options (Mentions = grievances feed · Alerts · Events) ──────────────
const SOURCE_OPTIONS = [
  { v: 'all', label: 'All sources' },
  { v: 'mentions', label: 'Mentions' },
  { v: 'alerts', label: 'Alerts' },
  { v: 'events', label: 'Events' },
  { v: 'news', label: 'RSS news' },
];
const DAY_OPTIONS = [
  { v: 1, label: 'Last 24 hrs' },
  { v: 3, label: 'Last 3 days' },
  { v: 7, label: 'Last 7 days' },
  { v: 30, label: 'Last 30 days' },
];
/**
 * What the operator can narrow the run to.
 *
 * "All posts" is the engine's own behaviour: it counts both sides and lets the majority
 * decide the direction. The other two are an explicit instruction, so they also fix the
 * direction — filtering the evidence to criticism and THEN counting it would make
 * "counter" true by construction on every run.
 */
const STANCE_OPTIONS = [
  { v: 'all', label: 'Both sides', hint: 'Default — the bigger side decides Counter or Amplify' },
  { v: 'criticize', label: 'Criticism only', hint: 'Always Counter, written from the critical posts' },
  { v: 'support', label: 'Support only', hint: 'Always Amplify, written from the supportive posts' },
];

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  // Earlier runs. Generate archives the previous batch instead of deleting it, so this
  // is where a suggestion you were still weighing up goes when you regenerate.
  { key: 'superseded', label: 'Previous runs' },
  { key: 'converted', label: 'Sent to Campaign' },
  { key: 'dismissed', label: 'Dismissed' },
];

const PRIORITY_CLS = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-gray-50 text-gray-500 border-gray-200',
};
const SENT_CLS = {
  negative: 'bg-red-50 text-red-600', positive: 'bg-green-50 text-green-700',
  neutral: 'bg-gray-100 text-gray-500', mixed: 'bg-indigo-50 text-indigo-700',
};


export default function AiSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState('');
  const [days, setDays] = useState(7);
  const [source, setSource] = useState('all');
  const [statusTab, setStatusTab] = useState('all');

  // ── Optional narrowing. Every one of these empty = the engine picks, exactly as before.
  const [showFilters, setShowFilters] = useState(false);
  const [topicOptions, setTopicOptions] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [selTopics, setSelTopics] = useState([]);
  const [perTopic, setPerTopic] = useState('');
  const [maxTopics, setMaxTopics] = useState('');
  const [stance, setStance] = useState('all');
  const [perTopicCampaigns, setPerTopicCampaigns] = useState('');
  const filtersActive = selTopics.length > 0 || perTopic !== '' || maxTopics !== '' || stance !== 'all' || perTopicCampaigns !== '';
  const resetFilters = () => { setSelTopics([]); setPerTopic(''); setMaxTopics(''); setStance('all'); setPerTopicCampaigns(''); };

  /**
   * The same ceiling the server applies, mirrored so the hint can name a real number.
   * A topic with four posts has one story in it, not three.
   */
  const allowanceFor = (posts) => {
    if (posts < 10) return 1;
    if (posts <= 20) return 3;
    if (posts <= 30) return 5;
    if (posts <= 40) return 7;
    return 10;
  };
  // Across the topics in play, the most any single one of them will actually produce.
  // What "How many topics" resolves to right now — used to light the chips it would
  // take, so the number is not an invisible decision.
  const autoCount = selTopics.length ? 0 : Math.min(Number(maxTopics) || 5, 10, topicOptions.length);
  const inPlay = selTopics.length
    ? topicOptions.filter((t) => selTopics.includes(t.topic))
    : topicOptions.slice(0, autoCount);
  const bestAllowance = inPlay.length ? Math.max(...inPlay.map((t) => allowanceFor(t.posts))) : 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/campaign-suggestions', { params: { status: statusTab } });
      setSuggestions(res.data.suggestions || []);
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => { load(); }, [load]);

  /**
   * The issues that actually have posts in this window, with their stance split.
   *
   * Fetched rather than hardcoded from the 16-value taxonomy: most of those have no
   * posts on any given week, and offering "Electricity" when nobody mentioned it would
   * produce a run that returns nothing and looks broken. Re-fetched when the window
   * changes, because the counts and the list both depend on it.
   */
  useEffect(() => {
    if (!showFilters) return;
    let cancelled = false;
    setTopicsLoading(true);
    api.get('/campaign-suggestions/topics', { params: { days } })
      .then((res) => {
        if (cancelled) return;
        const list = res.data.topics || [];
        setTopicOptions(list);
        // Drop any selection that no longer exists in the new window, so the panel can
        // never submit a topic the server will silently ignore.
        setSelTopics((cur) => cur.filter((t) => list.some((o) => o.topic === t)));
      })
      .catch(() => { if (!cancelled) setTopicOptions([]); })
      .finally(() => { if (!cancelled) setTopicsLoading(false); });
    return () => { cancelled = true; };
  }, [showFilters, days]);


  const generate = async () => {
    setGenerating(true); setMsg('');
    try {
      const sources = source === 'all' ? ['mentions', 'alerts', 'events'] : [source];
      // Only what the operator actually chose. An omitted key means "use the default",
      // so the server never has to distinguish "not set" from "set to the default".
      const payload = { days, sources };
      if (selTopics.length) payload.topics = selTopics;
      if (perTopic !== '') payload.per_topic = Number(perTopic);
      if (!selTopics.length && maxTopics !== '') payload.max_topics = Number(maxTopics);
      if (stance !== 'all') payload.stance = stance;
      if (perTopicCampaigns !== '') payload.campaigns_per_topic = Number(perTopicCampaigns);
      await api.post('/campaign-suggestions/generate', payload);
      setStatusTab('new');
      await load();
      setMsg('Suggestions generated.');
    } catch (e) {
      setMsg(e?.response?.status === 503
        ? 'AI is not configured on the server (check OLLAMA_BASE_URL / OLLAMA_MODEL).'
        : (e?.response?.data?.message || 'Failed to generate suggestions.'));
    } finally {
      setGenerating(false);
    }
  };

  const dismiss = async (s) => {
    try {
      await api.put(`/campaign-suggestions/${s.id}`, { status: 'dismissed' });
      load();
    } catch (e) { setMsg(e?.response?.data?.message || 'Failed to dismiss.'); }
  };

  // Undo a dismissal. Restores to the archive rather than to 'new', so it does not
  // silently reappear alongside the current batch as if it had just been generated.
  const restore = async (s, status) => {
    try {
      await api.put(`/campaign-suggestions/${s.id}`, { status });
      load();
    } catch (e) { setMsg(e?.response?.data?.message || 'Failed to restore.'); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-3 justify-between mb-4">
        <div className="flex items-center gap-2 text-gray-800 font-bold text-lg">
          <Sparkles className="h-5 w-5 text-orange-500" /> AI Campaign Suggestions
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500 block">Content source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}
              className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-orange-300">
              {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500 block">Time range</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-orange-300">
              {DAY_OPTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </div>
          <button onClick={generate} disabled={generating}
            className="h-9 px-5 rounded-lg font-bold text-xs text-white flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60">
            {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? 'Analysing…' : 'Generate suggestions'}
          </button>
        </div>
      </div>

      {/* ── Optional narrowing ──
          Collapsed by default and empty by default: the engine's own choices (top 5
          topics by volume, 8 posts each, both sides counted) are what runs unless
          something here is set. */}
      <div className="mb-3">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-orange-600"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Choose topics &amp; posts
          {filtersActive && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold">on</span>}
          {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showFilters && (
          <div className="mt-2 rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Topics</label>
                <span className="text-[11px] text-gray-400">
                  {selTopics.length
                    ? `${selTopics.length} selected`
                    : `Auto — the ${autoCount} highlighted below will be used`}
                </span>
              </div>
              {topicsLoading && <p className="text-xs text-gray-400">Loading topics…</p>}
              {!topicsLoading && !topicOptions.length && (
                <p className="text-xs text-gray-400">No classified topics in this window — widen the time range.</p>
              )}
              {(source === 'news' || source === 'all') && (
                <p className="text-[10px] text-gray-400 mb-1.5">
                  RSS news is grouped by its own categories (Politics, Development, Law &amp; Order…) and is not affected by these topics.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {topicOptions.map((t, i) => {
                  const on = selTopics.includes(t.topic);
                  // In auto mode the number in "How many topics" decides silently, so the
                  // chips show its answer: the ones it would take are lit, the rest are
                  // dimmed. Change the number and you watch the selection move.
                  const auto = !selTopics.length && i < autoCount;
                  const out = !selTopics.length && i >= autoCount;
                  return (
                    <button
                      key={t.topic}
                      onClick={() => setSelTopics((cur) => (on ? cur.filter((x) => x !== t.topic) : [...cur, t.topic]))}
                      title={out
                        ? `${t.posts} posts — outside the top ${autoCount}. Click to use it anyway.`
                        : `${t.posts} posts — ${t.anti} critical, ${t.pro} supportive`}
                      className={`px-2.5 py-1 rounded-lg border text-xs transition ${on
                        ? 'bg-orange-500 border-orange-500 text-white font-semibold'
                        : auto
                          ? 'bg-orange-50 border-orange-300 text-orange-700 font-semibold'
                          : out
                            ? 'bg-white border-gray-150 text-gray-400 hover:border-gray-300'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      {t.topic}
                      {/* The split is the whole reason to pick one topic over another. */}
                      <span className={`ml-1.5 text-[10px] ${on ? 'text-orange-100' : 'text-gray-400'}`}>
                        {t.posts} · {t.anti}&#8595; {t.pro}&#8593;
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                {selTopics.length
                  ? 'Only the highlighted topics will be used. Click one again to remove it.'
                  : 'Change "How many topics" to move the highlight, or click any topic to choose them yourself.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Posts per topic</label>
                <input
                  type="number" min={3} max={100} placeholder="8"
                  value={perTopic} onChange={(e) => setPerTopic(e.target.value)}
                  className="h-9 w-full px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-300"
                />
                {/* Said here rather than discovered later: the ceiling is real but the
                    useful range is lower, and a run of 100 is minutes not seconds. */}
                <p className={`text-[10px] mt-1 ${Number(perTopic) > 30 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {Number(perTopic) > 30
                    ? 'Above ~30 the model starts summarising instead of citing, and each topic takes noticeably longer.'
                    : '3–100. More posts means more evidence but a longer prompt.'}
                </p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">How many topics</label>
                <input
                  type="number" min={1} max={10} placeholder="5"
                  value={maxTopics} onChange={(e) => setMaxTopics(e.target.value)}
                  disabled={selTopics.length > 0}
                  className="h-9 w-full px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-300 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  {selTopics.length ? 'Set by your topic selection.' : 'Each topic is one campaign, and one more AI call.'}
                </p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Campaigns per topic</label>
                <input
                  type="number" min={1} max={10} placeholder="Auto"
                  value={perTopicCampaigns} onChange={(e) => setPerTopicCampaigns(e.target.value)}
                  className="h-9 w-full px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-300"
                />
                {/* The cap is per topic and comes from that topic's own post count, so
                    asking for 5 across a mixed selection quietly gives fewer on the
                    thinner ones. Said here so the result is not a surprise. */}
                <p className={`text-[10px] mt-1 ${Number(perTopicCampaigns) > bestAllowance ? 'text-amber-600' : 'text-gray-400'}`}>
                  {Number(perTopicCampaigns) > bestAllowance
                    ? `No topic here has the posts for ${perTopicCampaigns} — you will get up to ${bestAllowance}.`
                    : 'Auto: 2 for a topic with 10+ posts, 1 below that. Bigger topics allow more (up to 10).'}
                </p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Posts to use</label>
                <select
                  value={stance} onChange={(e) => setStance(e.target.value)}
                  className="h-9 w-full px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-orange-300"
                >
                  {STANCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">{STANCE_OPTIONS.find((o) => o.v === stance)?.hint}</p>
              </div>
            </div>

            {filtersActive && (
              <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                <p className="text-[11px] text-gray-500">
                  {/* Said plainly, because a filtered run's counts still describe the whole
                      topic — the card would otherwise look like it contradicts itself. */}
                  The post counts shown on each card stay the true totals for the topic, not just the posts used.
                </p>
                <button onClick={resetFilters} className="text-[11px] font-semibold text-gray-500 hover:text-orange-600 whitespace-nowrap ml-3">
                  Reset to auto
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Suggestions are generated from your own selected content (mentions, alerts, events), analysed by AI and ranked by impact and urgency.
        Generating again archives the current batch under &ldquo;Previous runs&rdquo; rather than deleting it.
      </p>
      {msg && <p className="text-sm text-gray-500 mb-3">{msg}</p>}

      {/* ── Status tabs ── */}
      <div className="flex items-center gap-2 mb-4">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatusTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
              statusTab === t.key ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </div>
      ) : !suggestions.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <Sparkles className="h-10 w-10 mb-2" />
          <p className="text-sm">No suggestions here yet. Pick your sources and click Generate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} s={s} onDismiss={() => dismiss(s)} onRestore={(st) => restore(s, st)} onChanged={load} setMsg={setMsg} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, onDismiss, onRestore, onChanged, setMsg }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const IntentIcon = s.intent === 'counter' ? ShieldAlert : Megaphone;
  const converted = s.status === 'converted';

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-gray-800">
          {s.status === 'superseded' && (
            <span className="inline-flex items-center gap-1 align-middle mr-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              <Archive className="h-3 w-3" /> earlier run
            </span>
          )}
          {s.title}
        </h3>
        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${PRIORITY_CLS[s.priority] || PRIORITY_CLS.low}`}>{s.priority}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${s.intent === 'counter' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
          <IntentIcon className="h-3 w-3" /> {s.intent === 'counter' ? 'Counter' : 'Amplify'}
        </span>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${SENT_CLS[s.sentiment] || ''}`}>{s.sentiment}</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><TrendingUp className="h-3 w-3" /> Impact {s.impact_score} · Urgency {s.urgency_score}</span>
      </div>

      {/* The issue and its scale — the aggregation's numbers, not the model's. This is
          what tells an operator whether the campaign is worth a budget. */}
      {(s.topic || s.evidence?.topic_posts) && (
        <p className="text-[11px] text-gray-500 mt-1.5">
          {s.topic && <span className="font-semibold text-gray-600">{s.topic}</span>}
          {/* Sibling campaigns share this whole line — same topic, same counts, same
              scores, because it is the same issue. Without this they read as a bug. */}
          {s.variant_count > 1 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-bold">
              {(s.variant_index || 0) + 1} of {s.variant_count}
            </span>
          )}
          {s.evidence?.topic_posts ? (
            <span>
              {s.topic ? ' · ' : ''}
              {s.evidence.topic_posts} post{s.evidence.topic_posts === 1 ? '' : 's'}
              {(s.evidence.topic_pro || s.evidence.topic_anti)
                ? ` — ${s.evidence.topic_pro || 0} supportive, ${s.evidence.topic_anti || 0} critical`
                : ''}
            </span>
          ) : null}
        </p>
      )}

      {s.summary && <p className="text-sm text-gray-600 mt-2">{s.summary}</p>}

      {/* What the influencer will be shown. Surfaced here so it is reviewed before it
          leaves the tenant — this text goes to an external creator. */}
      {s.brief && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-white p-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Brief for the creator</p>
          <p className="text-xs text-gray-600 whitespace-pre-line">{s.brief}</p>
        </div>
      )}
      {s.suggested_message && (
        <div className="mt-2 text-sm bg-gray-50 rounded-lg p-2 text-gray-700 whitespace-pre-line">
          <span className="font-semibold">Message to post: </span>{s.suggested_message}
        </div>
      )}
      {(s.suggested_hashtags || []).length > 0 && (
        <p className="text-[11px] text-orange-600 mt-1.5">{s.suggested_hashtags.map((h) => `#${h}`).join(' ')}</p>
      )}

      {(s.suggested_news || []).length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Newspaper className="h-3 w-3" /> Points to work in</p>
          <ul className="list-disc list-inside text-xs text-gray-500">{s.suggested_news.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {/* Labelled, because the editor now opens with EVERY platform ticked. Unlabelled
          chips read as "this campaign is X and Facebook only", which was never true —
          they are the two the AI thinks fit best. */}
      {(s.target_platforms || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Best fit</span>
          {(s.target_platforms || []).map((p) => (
            <span key={p} className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p}</span>
          ))}
        </div>
      )}

      <SourcePosts evidence={s.evidence} />
      <p className="text-[11px] text-gray-400 mt-1">
        {s.generated_by ? `Generated by ${s.generated_by}${s.generated_by_role ? ` (${s.generated_by_role})` : ''}` : 'Generated'}
        {s.generated_at ? ` · ${new Date(s.generated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
      </p>
      {s.converted_by && (
        <p className="text-[11px] text-green-600 mt-0.5 flex items-center gap-1">
          <Send className="h-3 w-3" /> Sent to campaign by {s.converted_by}
          {s.converted_at ? ` · ${new Date(s.converted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      )}

      {/* ── Actions ── */}
      {converted ? (
        <div className="mt-4 pt-3 border-t border-gray-50 text-xs font-semibold text-green-600 flex items-center gap-1">
          <Send className="h-3.5 w-3.5" /> Sent to campaign
        </div>
      ) : (
        <div className="mt-4 pt-4 border-t border-gray-50 flex flex-wrap gap-2">
          {/* Archived suggestions stay fully usable — they were valid when generated and
              a newer run does not make them wrong, only older. */}
          <button onClick={() => setEditing(true)} disabled={busy || s.status === 'dismissed'}
            className="flex items-center gap-1 h-9 px-4 rounded-lg text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-60">
            <Pencil className="h-4 w-4" /> Edit &amp; send
          </button>
          {s.status === 'dismissed' ? (
            <button onClick={() => onRestore('superseded')} disabled={busy}
              className="flex items-center gap-1 h-9 px-4 rounded-lg text-xs font-bold text-gray-500 border border-gray-200 hover:bg-gray-50">
              <RotateCcw className="h-4 w-4" /> Restore
            </button>
          ) : (
            <button onClick={onDismiss} disabled={busy}
              className="flex items-center gap-1 h-9 px-4 rounded-lg text-xs font-bold text-gray-500 border border-gray-200 hover:bg-gray-50">
              <X className="h-4 w-4" /> Dismiss
            </button>
          )}
        </div>
      )}

      {editing && (
        <EditAndSendModal
          s={s}
          onClose={() => setEditing(false)}
          onSent={() => { setEditing(false); setMsg && setMsg('Campaign created as a draft.'); onChanged(); }}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}

/**
 * The posts this particular suggestion was built from.
 *
 * The pool counts ("30 mentions") describe the whole batch and are the same on every
 * card, so they never answered "why does THIS campaign exist?". The model now cites the
 * samples it used and we resolve them back to real posts, so the claim is checkable —
 * and when nothing was cited the card says so rather than implying evidence.
 */
function SourcePosts({ evidence }) {
  const [open, setOpen] = useState(false);
  const posts = evidence?.source_posts || [];
  const pool = (evidence?.grievance_count || 0) + (evidence?.alert_count || 0) + (evidence?.event_count || 0);
  const filters = evidence?.retrieval?.filters;

  if (!posts.length) {
    return (
      <p className="text-[11px] text-gray-400 mt-3">
        Analysed {pool} item{pool === 1 ? '' : 's'} · no specific posts cited for this campaign
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700">
        <FileSearch className="h-3 w-3" />
        Built from {posts.length} post{posts.length === 1 ? '' : 's'}
        <span className="font-normal text-gray-400">of {pool} analysed</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {/* A card built from a narrowed run has to say so. Its Counter/Amplify badge was
          chosen by the operator rather than by the counts, and read months later that is
          not something anyone would guess from the numbers on the card. */}
      {filters && filters.defaults === false && (
        <p className="text-[10px] text-gray-400 mt-0.5">
          Narrowed run:
          {filters.topics?.length ? ` topic chosen manually ·` : ''}
          {filters.stance && filters.stance !== 'all' ? ` ${filters.stance === 'criticize' ? 'critical' : 'supportive'} posts only ·` : ''}
          {` up to ${filters.per_topic} posts per topic`}
        </p>
      )}
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {posts.map((p, i) => (
            <li key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {p.platform && <span className="font-bold uppercase text-gray-500">{p.platform}</span>}
                {p.author && <span className="text-gray-400">@{p.author}</span>}
                {p.sentiment && (
                  <span className={`px-1.5 py-0.5 rounded-full font-semibold ${SENT_CLS[p.sentiment] || 'bg-gray-100 text-gray-500'}`}>
                    {p.sentiment}
                  </span>
                )}
                {p.at && <span className="text-gray-300">{new Date(p.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline inline-flex items-center gap-0.5">
                    open <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-1 break-words">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Edit & send — the AI's draft opened in the SAME editor a manual request uses, so a
 * suggestion can be reworked (copy, media, per-platform variants, platforms themselves)
 * before it becomes an influencer brief rather than after it has been reviewed.
 *
 * Everything is prefilled from the suggestion; whatever the operator changes wins on the
 * server, because send-to-campaign only falls back to the suggestion for fields left blank.
 */
function EditAndSendModal({ s, onClose, onSent, setBusy }) {
  // What the AI thought fit best. Kept only to mark those chips — it no longer decides
  // what is ticked, because a two-platform default silently narrowed every campaign and
  // the operator had to notice the omission to undo it. Opting OUT is the safe direction.
  const recommended = (s.target_platforms || []).filter((p) => PLATFORMS.includes(p));
  const [form, setForm] = useState({
    title: s.title || '',
    description: s.brief || '',
    target_platforms: [...PLATFORMS],
    target_reach: '', budget: '', location: '', deadline: '',
    content_type: 'post',
    caption: s.suggested_message || '',
    hashtags: (s.suggested_hashtags || []).join(' '),
    media: [],
  });
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const togglePlatform = (p) => setForm((f) => ({
    ...f,
    target_platforms: f.target_platforms.includes(p)
      ? f.target_platforms.filter((x) => x !== p)
      : [...f.target_platforms, p],
  }));

  const toggleOverride = (p, on) => setOverrides((o) => {
    const next = { ...o };
    if (on) {
      // X caps a post at 280 characters and the shared caption is now a full-length
      // post, so an X override that opened blank left the operator retyping it. The AI
      // writes a compressed variant for exactly this; start from that instead.
      const short = p === 'X' ? (s.suggested_message_short || '') : '';
      next[p] = {
        title: '',
        content_type: (CONTENT_TYPES_BY_PLATFORM[p] || ['post'])[0],
        caption: short,
        hashtags: short ? (s.suggested_hashtags || []).slice(0, 2).join(' ') : '',
        media: [],
      };
    } else delete next[p];
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    if (form.deadline && form.deadline < todayStr()) {
      setErr('Deadline cannot be in the past — pick today or a future date.');
      return;
    }
    if (!form.target_platforms.length) {
      setErr('Select at least one platform — we need to know where this should be posted.');
      return;
    }
    if (!form.title.trim()) {
      setErr('Give the campaign a title.');
      return;
    }
    setSaving(true); setBusy(true); setErr('');
    try {
      await api.post(`/campaign-suggestions/${s.id}/send-to-campaign`, {
        title: form.title,
        description: form.description,
        target_platforms: form.target_platforms,
        target_reach: form.target_reach,
        budget: form.budget,
        location: form.location,
        deadline: form.deadline,
        content_type: form.content_type,
        caption: form.caption,
        hashtags: form.hashtags,   // string; the backend splits it into an array
        media: form.media,
        platform_content: form.target_platforms
          .filter((p) => overrides[p])
          .map((p) => ({ platform: p, ...overrides[p] })),
      });
      onSent();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Failed to create the campaign.');
      setSaving(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* ── header ────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800 text-lg">Edit &amp; send campaign</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              AI draft · {s.intent === 'counter' ? 'Counter' : 'Amplify'} · edit anything before sending
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-300 hover:text-gray-600 shrink-0"><X className="h-5 w-5" /></button>
        </div>

        {/* Two columns from `lg` up: the copy you are writing on the left with room to
            actually read it, and everything deciding where it goes on the right. Below
            `lg` it stacks in the same order. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── left: what gets written ───────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">
            <Field label="Campaign title">
              <input className={inp} required value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>

            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/40 space-y-3">
              <p className="text-xs font-bold text-gray-600">Creative <span className="font-normal text-gray-400">— used for every platform by default</span></p>
              <CreativeEditor
                captionLabel="Caption / post text"
                captionRows={14}
                captionWarn={form.target_platforms.includes('X') && form.caption.length > 280}
                captionHint={
                  form.target_platforms.includes('X') && form.caption.length > 280
                    ? 'This is what actually gets published. X allows 280 — tick "Customize" under X on the right for the short version.'
                    : "Prefilled with the AI's suggested message — this is what actually gets published."
                }
                value={{ content_type: form.content_type, caption: form.caption, hashtags: form.hashtags, media: form.media }}
                onChange={(v) => setForm((f) => ({ ...f, ...v }))}
              />
            </div>

            {/* This is what an EXTERNAL influencer reads. Editable here because it leaves
                the tenant, and nothing internal should travel with it. */}
            <Field label="Brief for the creator — this is shown to the influencer">
              <textarea rows={6} className={ta}
                placeholder="What the campaign is about, the angle, the tone, what to avoid."
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <p className="text-[11px] text-gray-400">Your monitoring numbers and the amplify/counter label are never sent with this.</p>
            </Field>
          </div>

          {/* ── right: where it goes ──────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* The brief the reviewer will read is composed server-side from the
                suggestion; shown here so the operator knows what accompanies their
                creative. */}
            {s.summary && (
              <div className="rounded-xl bg-orange-50/50 border border-orange-100 p-3">
                <p className="text-[10px] font-bold text-orange-700/70 uppercase tracking-widest mb-1">Situation the AI found</p>
                <p className="text-xs text-gray-600 leading-relaxed">{s.summary}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Platforms <span className="text-orange-600">*</span>
                </label>
                <button type="button"
                  onClick={() => setForm((f) => ({
                    ...f,
                    target_platforms: f.target_platforms.length === PLATFORMS.length ? [] : [...PLATFORMS],
                  }))}
                  className="text-[11px] font-semibold text-orange-600 hover:text-orange-700">
                  {form.target_platforms.length === PLATFORMS.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const on = form.target_platforms.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => togglePlatform(p)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-orange-600 text-white border-orange-600' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                      {p}{recommended.includes(p) ? ' ★' : ''}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400">
                All platforms are on — switch off any you don&apos;t want.
                {recommended.length ? ' ★ marks the AI’s best fit for this campaign.' : ''}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Target reach"><input type="number" min={0} className={inp} value={form.target_reach} onChange={(e) => setForm({ ...form, target_reach: e.target.value })} /></Field>
              <Field label="Budget (₹)"><input type="number" min={0} className={inp} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
              <Field label="Location (optional)"><input className={inp} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
              <Field label="Deadline"><input type="date" min={todayStr()} className={inp} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            </div>

            {form.target_platforms.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Platform-specific content (optional)</label>
                <p className="text-[11px] text-gray-400 -mt-1">Toggle a platform to give it its own format, caption and media. Otherwise it uses the creative on the left.</p>
                {form.target_platforms.map((p) => {
                  const on = !!overrides[p];
                  return (
                    <div key={p} className={`border rounded-xl p-3 ${on ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700">{p}</span>
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                          <input type="checkbox" checked={on} onChange={(e) => toggleOverride(p, e.target.checked)} /> Customize
                        </label>
                      </div>
                      {on && (
                        <div className="mt-3">
                          <CreativeEditor platform={p} compact withTitle value={overrides[p]} onChange={(v) => setOverrides((o) => ({ ...o, [p]: v }))} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Same preview the reviewer sees, so there is no surprise after submitting. */}
            <PlatformBreakdown
              platforms={form.target_platforms}
              shared={{ title: s.title, content_type: form.content_type, caption: form.caption, hashtags: form.hashtags, media: form.media }}
              overrides={form.target_platforms.filter((p) => overrides[p]).map((p) => ({ platform: p, ...overrides[p] }))}
            />
          </div>
        </div>

        {/* ── footer ──────────────────────────────────────────────────────── */}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button type="submit" disabled={saving}
          className="w-full h-11 rounded-xl font-bold text-sm text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-60">
          {saving ? 'Creating…' : 'Create campaign'}
        </button>
        <p className="text-center text-xs text-gray-400">This creates the campaign as a draft — nothing is published until you move it on.</p>
      </form>
    </div>
  );
}
