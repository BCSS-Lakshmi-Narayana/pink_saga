import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '../../lib/api';
import { partyStyle } from '../../config/partyColors';
import { platformMeta } from '../geographic/platformScale';

/*
 * Social Media & Communication Channels (client requirement 2) — the second tab
 * of the Intelligence Brief, sharing its 7 / 30 / 90-day switch.
 *
 *   "Sentiments in digital platforms, rallies, or community outreach.
 *    Top discussion topics: sentiments towards the party and opposition.
 *    Platform, volume, source type. Response strategy."
 *
 * One sub-tab per part of that sentence. Every figure is a count of posts and
 * articles the platform already collected and scored
 * (GET /api/social-channels/overview).
 */

// Diverging pair (validated: CVD-safe, ≥3:1 on white) with a grey midpoint.
const POS = '#2563eb';
const NEG = '#dc5a14';
const VOLUME = '#4f46e5';
const TABS = [
  { id: 'channels', label: 'Channels' },
  { id: 'topics', label: 'Top topics' },
  { id: 'platforms', label: 'Platforms & sources' },
  { id: 'offline', label: 'Rallies & outreach' },
  { id: 'strategy', label: 'Response strategy' },
];
const TAB_NOTES = {
  channels: 'Sentiment towards BRS and towards the opposition in each channel — digital platforms, rallies and community outreach — and towards each party.',
  topics: 'The most discussed topics, each with sentiment towards BRS and towards the opposition, its volume, main platform and main source type.',
  platforms: 'Volume and sentiment on each platform, and by who is posting — the public, news media, rival party and government accounts, or BRS\'s own accounts.',
  offline: 'What is being said about rallies, public meetings and protests, and about community outreach — read from the posts and reports about them.',
  strategy: 'What to do: topics where BRS is criticised (counter), topics where the opposition is criticised (amplify), and which channels need a response first.',
};
const ACTION_STYLE = {
  Rebut: 'bg-orange-50 text-orange-800 border-orange-200',
  Respond: 'bg-sky-50 text-sky-800 border-sky-200',
  'Brief the press': 'bg-violet-50 text-violet-800 border-violet-200',
  Amplify: 'bg-blue-50 text-blue-800 border-blue-200',
};
const SOURCE_ORDER = ['organic', 'news', 'opposition', 'owned'];

const num = (v) => Number(v || 0).toLocaleString('en-IN');
const fmtNet = (n) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`);
const netClass = (n) => (n == null ? 'text-slate-400' : n > 0 ? 'text-blue-700' : n < 0 ? 'text-orange-700' : 'text-slate-600');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const platformLabel = (p) => platformMeta(p).label;

const Box = ({ title, sub, children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
    {title && <div className="text-[13px] font-semibold text-slate-800">{title}</div>}
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    <div className={title || sub ? 'mt-3' : ''}>{children}</div>
  </section>
);
const Empty = ({ children }) => <div className="text-[12px] text-slate-400 py-6 text-center">{children}</div>;

/** One side's sentiment: a positive/negative split bar, the counts, and the net score. */
const SentimentRow = ({ label, s, compact = false }) => {
  const decided = (s?.positive || 0) + (s?.negative || 0);
  return (
    <div className={compact ? '' : 'py-1'}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-slate-600">{label}</span>
        <span className={`font-bold tabular-nums ${netClass(s?.net)}`}>{decided ? fmtNet(s.net) : '—'}</span>
      </div>
      <div className="mt-1 flex h-2 rounded-full overflow-hidden bg-slate-100">
        {decided > 0 && <>
          <div style={{ width: `${(s.positive / decided) * 100}%`, background: POS }} />
          <div style={{ width: `${(s.negative / decided) * 100}%`, background: NEG }} />
        </>}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
        <span className="text-blue-700">{num(s?.positive)} positive</span> · <span className="text-orange-700">{num(s?.negative)} negative</span>
      </div>
    </div>
  );
};

/** "+5 (1,018 / 926)" in a table cell. */
const NetCell = ({ s }) => {
  const decided = (s?.positive || 0) + (s?.negative || 0);
  if (!decided) return <span className="text-slate-300">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className={`font-semibold ${netClass(s.net)}`}>{fmtNet(s.net)}</span>
      <span className="text-slate-400 text-[11px]"> ({num(s.positive)} / {num(s.negative)})</span>
    </span>
  );
};

const SentimentKey = () => (
  <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: POS }} />positive</span>
    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: NEG }} />negative</span>
    <span>Net = −100 (all negative) to +100 (all positive). Sentiment counts the public and news media only — party and government accounts are publicity, not opinion; volume counts every post.</span>
  </p>
);

const ExamplePosts = ({ items }) => (
  <div className="space-y-1">
    {items.map((e) => (
      <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer" className="block rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-100">
        <span className="font-semibold">{e.author || 'Post'}</span>
        <span className="text-slate-400"> · {platformLabel(e.platform)} · {e.source_type}{e.engagement ? ` · ${num(e.engagement)} engagements` : ''}</span>
        <div className="line-clamp-2">{e.text}</div>
      </a>
    ))}
  </div>
);

/* ── 1 · channels: digital platforms, rallies, community outreach ───────── */

function ChannelsTab({ d, onOpen }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {d.channels.map((c) => (
          <section key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
            <div className="text-[14px] font-bold text-slate-900">{c.label}</div>
            <div className="text-[11px] text-slate-500">{c.sub}</div>
            <div className="mt-2 text-[24px] font-bold tabular-nums text-slate-900">{num(c.posts)}<span className="text-[12px] font-normal text-slate-500"> posts</span></div>
            <div className="mt-2 space-y-1.5">
              <SentimentRow label="Towards BRS" s={c.brs} />
              <SentimentRow label="Towards opposition" s={c.opposition} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {c.top_platform && <>Mostly on {platformLabel(c.top_platform)}</>}
              {!!c.top_topics.length && <> · about {c.top_topics.join(', ')}</>}
            </div>
            {c.id !== 'digital' && (
              <button type="button" onClick={() => onOpen('offline')} className="mt-auto pt-2 text-left text-[12px] font-medium text-indigo-700 hover:underline">
                See what was said →
              </button>
            )}
          </section>
        ))}
      </div>

      <Box title="Sentiment towards the party and the opposition" sub="Posts by the public and news media that praise or criticise each party, and what for">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {d.parties.map((p) => (
            <div key={p.party} className={`rounded-lg border p-3 ${p.ours ? 'border-pink-300 bg-pink-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: partyStyle(p.party).hex }} />
                <span className="text-[13px] font-bold text-slate-900">{p.party}</span>
                {p.ours && <span className="text-[10px] font-semibold uppercase tracking-wide text-pink-700">Our party</span>}
                <span className={`ml-auto text-[18px] font-bold tabular-nums ${netClass(p.net)}`}>{fmtNet(p.net)}</span>
              </div>
              <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-slate-100">
                {p.positive + p.negative > 0 && <>
                  <div style={{ width: `${(p.positive / (p.positive + p.negative)) * 100}%`, background: POS }} />
                  <div style={{ width: `${(p.negative / (p.positive + p.negative)) * 100}%`, background: NEG }} />
                </>}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                <span className="text-blue-700">{num(p.positive)} positive</span> · <span className="text-orange-700">{num(p.negative)} negative</span>
                <span className="text-slate-400"> · previous {d.days} days {fmtNet(p.prev_net)}</span>
              </div>
              <div className="mt-2 text-[11px]">
                <span className="text-slate-400">Praised for </span><span className="text-slate-700">{p.praised_for.join(', ') || '—'}</span>
              </div>
              <div className="text-[11px]">
                <span className="text-slate-400">Attacked for </span><span className="text-slate-700">{p.attacked_for.join(', ') || '—'}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Criticism of "the state government" with no party named counts against INC, which forms it.</p>
      </Box>
      <SentimentKey />
    </div>
  );
}

/* ── 2 · top discussion topics ──────────────────────────────────────────── */

function TopicsTab({ d }) {
  if (!d.topics.length) return <Box><Empty>No topic-tagged posts in this period.</Empty></Box>;
  return (
    <div className="space-y-4">
      <Box title="Top discussion topics" sub={`Posts and news articles per topic, last ${d.days} days`}>
        <ResponsiveContainer width="100%" height={d.topics.length * 30 + 30}>
          <BarChart data={d.topics} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="topic" width={170} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [num(v), 'Posts']} />
            <Bar dataKey="posts" fill={VOLUME} radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', fontSize: 11, fill: '#475569' }} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Box title="Each topic: sentiment, platform, volume and source type" sub={`Net sentiment (positive / negative posts) towards each side. Share of conversation = the topic's share of all posts, with its change from the previous ${d.days} days in points (collection grows over time, so shares compare fairly where raw counts do not).`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[11px] text-slate-400 border-b border-slate-100">
              <tr>
                <th className="text-left font-normal py-1">Topic</th>
                <th className="text-right font-normal">Volume</th>
                <th className="text-right font-normal pl-3">Towards BRS</th>
                <th className="text-right font-normal pl-3">Towards opposition</th>
                <th className="text-left font-normal pl-4">Main platform</th>
                <th className="text-left font-normal pl-3">Main source type</th>
                <th className="text-right font-normal pl-3">Share of conversation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {d.topics.map((t) => (
                <tr key={t.topic}>
                  <td className="py-1.5 text-slate-800 font-medium">{t.topic}</td>
                  <td className="text-right font-semibold">{num(t.posts)}</td>
                  <td className="text-right pl-3"><NetCell s={t.brs} /></td>
                  <td className="text-right pl-3"><NetCell s={t.opposition} /></td>
                  <td className="pl-4 text-slate-600">{t.top_platform ? platformLabel(t.top_platform) : '—'}</td>
                  <td className="pl-3 text-slate-600">{t.top_source_label || '—'} <span className="text-slate-400">({Math.round(((t.sources[t.top_source] || 0) / t.posts) * 100)}%)</span></td>
                  <td className="text-right pl-3 text-slate-700 whitespace-nowrap">
                    {t.share_pct}%
                    <span className="text-[11px] text-slate-400" title={`Share of all posts in the previous ${d.days} days`}>
                      {t.share_change == null ? ' (new)' : ` (${t.share_change > 0 ? '+' : t.share_change < 0 ? '−' : '±'}${Math.abs(t.share_change)} pts)`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      <SentimentKey />
    </div>
  );
}

/* ── 3 · platforms and source types ─────────────────────────────────────── */

function PlatformsTab({ d }) {
  const sources = SOURCE_ORDER.map((v) => d.source_types.find((s) => s.voice === v)).filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Volume by platform" sub={`Posts and news articles, last ${d.days} days`}>
          {d.platforms.length ? (
            <ResponsiveContainer width="100%" height={d.platforms.length * 34 + 30}>
              <BarChart data={d.platforms.map((p) => ({ ...p, label: platformLabel(p.platform) }))} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [num(v), 'Posts']} />
                <Bar dataKey="posts" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', fontSize: 11, fill: '#475569' }}>
                  {d.platforms.map((p) => <Cell key={p.platform} fill={platformMeta(p.platform).color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No posts in this period.</Empty>}
        </Box>
        <Box title="Volume by source type" sub="Who is posting">
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.voice} className="flex items-center gap-2 text-[12px]">
                <span className="w-52 text-slate-700">{s.label}</span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(s.posts / Math.max(...sources.map((x) => x.posts))) * 100}%`, background: VOLUME }} />
                </div>
                <span className="w-16 text-right tabular-nums font-semibold text-slate-800">{num(s.posts)}</span>
              </div>
            ))}
          </div>
        </Box>
      </div>

      <Box title="Each platform: volume and sentiment" sub="Net sentiment (positive / negative posts) from the public and news media on that platform">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[11px] text-slate-400 border-b border-slate-100">
              <tr>
                <th className="text-left font-normal py-1">Platform</th><th className="text-right font-normal">Volume</th>
                <th className="text-right font-normal pl-3">Towards BRS</th><th className="text-right font-normal pl-3">Towards opposition</th>
                <th className="text-left font-normal pl-4">Main source type</th><th className="text-left font-normal pl-3">Top topics</th>
                <th className="text-right font-normal pl-3">Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {d.platforms.map((p) => (
                <tr key={p.platform}>
                  <td className="py-1.5 text-slate-800"><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: platformMeta(p.platform).color }} />{platformLabel(p.platform)}</td>
                  <td className="text-right font-semibold">{num(p.posts)}</td>
                  <td className="text-right pl-3"><NetCell s={p.brs} /></td>
                  <td className="text-right pl-3"><NetCell s={p.opposition} /></td>
                  <td className="pl-4 text-slate-600">{p.top_source_label}</td>
                  <td className="pl-3 text-slate-600">{p.top_topics.join(', ') || '—'}</td>
                  <td className="text-right pl-3 text-slate-500">{p.platform === 'news' ? '—' : num(p.engagement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>

      <Box title="Each source type: what that group says" sub="Here party and government accounts are included — this row is what they themselves post">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[11px] text-slate-400 border-b border-slate-100">
              <tr>
                <th className="text-left font-normal py-1">Source type</th><th className="text-right font-normal">Volume</th>
                <th className="text-right font-normal pl-3">Towards BRS</th><th className="text-right font-normal pl-3">Towards opposition</th>
                <th className="text-left font-normal pl-4">Main platform</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sources.map((s) => (
                <tr key={s.voice}>
                  <td className="py-1.5 text-slate-800">{s.label}</td>
                  <td className="text-right font-semibold">{num(s.posts)}</td>
                  <td className="text-right pl-3"><NetCell s={s.brs} /></td>
                  <td className="text-right pl-3"><NetCell s={s.opposition} /></td>
                  <td className="pl-4 text-slate-600">{s.top_platform ? platformLabel(s.top_platform) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      <SentimentKey />
    </div>
  );
}

/* ── 4 · rallies and community outreach ─────────────────────────────────── */

function OfflineTab({ d }) {
  const offline = d.channels.filter((c) => c.id !== 'digital');
  return (
    <div className="space-y-4">
      {offline.map((c) => (
        <Box key={c.id} title={`${c.label} · ${num(c.posts)} posts`} sub={c.sub}>
          {c.posts ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <SentimentRow label="Towards BRS" s={c.brs} />
                <SentimentRow label="Towards opposition" s={c.opposition} />
                <div className="pt-1 text-[11px] text-slate-500">
                  Platforms: {Object.entries(c.platforms).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${platformLabel(p)} ${num(n)}`).join(' · ')}
                </div>
                {!!c.top_topics.length && <div className="text-[11px] text-slate-500">Topics: {c.top_topics.join(', ')}</div>}
                {c.posts < 20 && <div className="text-[11px] text-amber-700">Low volume — read the posts rather than the figures.</div>}
              </div>
              <div className="lg:col-span-2">
                <div className="text-[11px] text-slate-400 mb-1">Most engaged posts</div>
                <ExamplePosts items={c.examples} />
              </div>
            </div>
          ) : <Empty>No posts about {c.label.toLowerCase()} in this period.</Empty>}
        </Box>
      ))}

      <Box title="Events tracked under Events monitoring" sub="Rallies or programmes set up with keywords, and the posts matched to each">
        {d.events.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-[11px] text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="text-left font-normal py-1">Event</th><th className="text-left font-normal">Dates</th>
                  <th className="text-right font-normal">Posts</th><th className="text-right font-normal">Positive</th>
                  <th className="text-right font-normal">Negative</th><th className="text-left font-normal pl-4">Platforms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className="py-1.5 text-slate-800">{e.name}{e.location ? <span className="text-slate-400"> · {e.location}</span> : null}</td>
                    <td className="text-slate-500">{fmtDate(e.start_date)}{e.end_date && e.end_date !== e.start_date ? ` – ${fmtDate(e.end_date)}` : ''}</td>
                    <td className="text-right font-semibold">{e.posts}</td>
                    <td className="text-right text-blue-700">{e.positive}</td>
                    <td className="text-right text-orange-700">{e.negative}</td>
                    <td className="pl-4 text-slate-600">{Object.entries(e.platforms).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${platformLabel(p)} ${n}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {d.scoped ? 'Events are statewide and shown to statewide users.' : <>None set up for this period. To follow a specific rally closely, add it with its keywords under <Link to="/events" className="text-indigo-700 hover:underline">Events</Link>.</>}
          </Empty>
        )}
      </Box>
    </div>
  );
}

/* ── 5 · response strategy ──────────────────────────────────────────────── */

function StrategyTab({ d }) {
  const { counter, amplify, where } = d.strategy;
  return (
    <div className="space-y-4">
      <Box title="Counter — where BRS is criticised" sub={`Topics with the most posts criticising BRS in the last ${d.days} days`}>
        {counter.length ? (
          <div className="space-y-3">
            {counter.map((s, i) => (
              <div key={s.topic} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-slate-400">{i + 1}</span>
                  <span className="text-[14px] font-bold text-slate-900">{s.topic}</span>
                  <span className={`text-[11px] font-semibold rounded-md border px-2 py-0.5 ${ACTION_STYLE[s.action.type]}`}>{s.action.type}</span>
                  {s.rising && <span className="text-[11px] font-semibold rounded-md bg-orange-600 text-white px-2 py-0.5">Rising</span>}
                </div>
                <div className="mt-1 text-[12px] text-slate-500 tabular-nums">
                  {num(s.criticism)} posts criticising BRS — {s.share_pct}% of all posts (previous {d.days} days: {s.prev_share_pct}%) · driven by {s.driven_by_label} ({s.driven_by_pct}%) · mostly on {platformLabel(s.top_platform)}
                </div>
                <p className="mt-2 text-[13px] text-slate-800">{s.action.text}</p>
                {!!s.examples.length && <div className="mt-2"><ExamplePosts items={s.examples} /></div>}
              </div>
            ))}
          </div>
        ) : <Empty>No topic has 3 or more posts criticising BRS in this period.</Empty>}
      </Box>

      <Box title="Amplify — where the opposition is criticised" sub="Topics where the public and press are already criticising the government or a rival">
        {amplify.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {amplify.map((a) => (
              <div key={a.topic} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-900">{a.topic}</span>
                  <span className={`text-[11px] font-semibold rounded-md border px-2 py-0.5 ${ACTION_STYLE.Amplify}`}>Amplify</span>
                </div>
                <p className="mt-1.5 text-[12px] text-slate-700">{a.action.text}</p>
              </div>
            ))}
          </div>
        ) : <Empty>No topic has 3 or more posts criticising the opposition in this period.</Empty>}
      </Box>

      <Box title="Where to respond first" sub="Each channel and platform, by how the public and press feel about BRS there">
        <div className="divide-y divide-slate-100">
          {where.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12px]">
              <span className={`w-2.5 h-2.5 rounded-full ${w.tone === 'negative' ? 'bg-orange-600' : w.tone === 'positive' ? 'bg-blue-600' : 'bg-slate-300'}`} />
              <span className="w-40 font-semibold text-slate-800">{w.label}</span>
              <span className="w-24 tabular-nums text-slate-500">{num(w.posts)} posts</span>
              <span className={`w-14 tabular-nums font-semibold ${netClass(w.brs.net)}`}>{fmtNet(w.brs.net)}</span>
              <span className="flex-1 text-slate-700">{w.text}</span>
            </div>
          ))}
        </div>
      </Box>

      <p className="text-[12px] text-slate-500">
        To draft the actual posts and hashtags for any of these topics, use <Link to="/ai-suggestions" className="text-indigo-700 font-medium hover:underline">AI Campaigns</Link>.
      </p>
    </div>
  );
}

/* ── the tab ─────────────────────────────────────────────────────────────── */

/*
 * One request per window, shared and kept for the session: switching back to a
 * window already seen is instant, and once the first window has loaded the
 * other two are fetched in the background so switching to them is too. The
 * server answers from memory, so the extra requests are cheap. Entries expire
 * with the server's own refresh interval.
 */
const WINDOWS = [7, 30, 90];
const CLIENT_TTL_MS = 10 * 60 * 1000;
const windowCache = new Map();
const fetchWindow = (days) => {
  // Keyed by the login as well: a different user on the same tab has a different seat scope.
  let who = '';
  try { who = localStorage.getItem('token') || ''; } catch { /* storage blocked */ }
  const key = `${who.slice(-16)}:${days}`;
  const hit = windowCache.get(key);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.promise;
  const promise = api.get('/social-channels/overview', { params: { days } }).then((r) => r.data);
  windowCache.set(key, { at: Date.now(), promise });
  promise.catch(() => windowCache.delete(key));
  return promise;
};

export default function SocialChannelsView({ days = 7 }) {
  const [tab, setTab] = useState('channels');
  const [state, setState] = useState({ data: null, scoped: false, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchWindow(days)
      .then((body) => {
        if (cancelled) return;
        setState({ data: body.data, scoped: body.scoped, loading: false, error: null });
        WINDOWS.filter((w) => w !== days).forEach((w) => fetchWindow(w).catch(() => {}));
      })
      .catch((error) => { if (!cancelled) setState({ data: null, scoped: false, loading: false, error }); });
    return () => { cancelled = true; };
  }, [days]);

  const d = state.data ? { ...state.data, scoped: state.scoped } : null;

  return (
    <div className="space-y-4">
      {d && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[22px] font-bold tabular-nums text-slate-900">{num(d.totals.posts + d.totals.articles)}</div>
            <div className="text-[12px] text-slate-600">Posts and articles</div>
            <div className="text-[11px] text-slate-400">{num(d.totals.posts)} social · {num(d.totals.articles)} news · last {d.days} days</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className={`text-[22px] font-bold tabular-nums ${netClass(d.totals.brs.net)}`}>{fmtNet(d.totals.brs.net)}</div>
            <div className="text-[12px] text-slate-600">Net sentiment towards BRS</div>
            <div className="text-[11px] text-slate-400">{num(d.totals.brs.positive)} positive · {num(d.totals.brs.negative)} negative</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className={`text-[22px] font-bold tabular-nums ${netClass(d.totals.opposition.net)}`}>{fmtNet(d.totals.opposition.net)}</div>
            <div className="text-[12px] text-slate-600">Net sentiment towards the opposition</div>
            <div className="text-[11px] text-slate-400">{num(d.totals.opposition.positive)} positive · {num(d.totals.opposition.negative)} negative</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[22px] font-bold tabular-nums text-slate-900">{d.topics[0]?.topic || '—'}</div>
            <div className="text-[12px] text-slate-600">Most discussed topic</div>
            <div className="text-[11px] text-slate-400">{d.topics[0] ? `${num(d.topics[0].posts)} posts` : ''}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <nav className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Social and channels">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        {state.scoped && <span className="text-[12px] text-slate-500">Your constituencies only</span>}
        {d?.as_of && (
          <span className="text-[11px] text-slate-400 ml-auto" title="Posts are reloaded every 10 minutes while this page is in use">
            Data as of {new Date(d.as_of).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-[13px] text-slate-700">{TAB_NOTES[tab]}</p>

      {state.loading && !d && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-400">Loading…</div>}
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
          {state.error?.response?.status === 403 ? 'You do not have access to this view.' : 'Could not load the social channels overview.'}
        </div>
      )}
      {d && (
        <div className={state.loading ? 'opacity-60 transition-opacity' : ''}>
          {tab === 'channels' && <ChannelsTab d={d} onOpen={setTab} />}
          {tab === 'topics' && <TopicsTab d={d} />}
          {tab === 'platforms' && <PlatformsTab d={d} />}
          {tab === 'offline' && <OfflineTab d={d} />}
          {tab === 'strategy' && <StrategyTab d={d} />}
        </div>
      )}
    </div>
  );
}
