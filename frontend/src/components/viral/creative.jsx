/**
 * Shared viral-campaign creative editing + preview.
 *
 * Extracted from ViralCampaigns.js so the AI Suggestions flow can offer the SAME
 * facilities as a manual request — media upload, per-platform overrides, tag pills —
 * instead of a thinner second implementation that would drift from it. Both pages now
 * post the identical payload shape, so the backend's one sanitizer (utils/viralCreative)
 * stays the single place this is validated.
 */
import React, { useState } from 'react';
import {
  X, Upload, Video, Music, FileText, Link as LinkIcon, ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '../../lib/api';

export const PLATFORMS = ['Instagram', 'X', 'YouTube', 'Facebook'];

// Platform-appropriate content formats. "_shared" drives the default creative.
export const CONTENT_TYPES_BY_PLATFORM = {
  _shared: ['post', 'image', 'video', 'reel', 'story', 'audio', 'text'],
  Instagram: ['reel', 'post', 'story', 'image', 'video'],
  X: ['tweet', 'post', 'image', 'video'],
  YouTube: ['video', 'short'],
  Facebook: ['post', 'reel', 'story', 'image', 'video'],
};

// Today as YYYY-MM-DD in the user's OWN timezone. Deliberately not
// toISOString().slice(0,10), which is UTC and reads as yesterday for the first 5½ hours
// of every IST day — letting an actual past date slip past the min= guard.
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const kindOf = (file) => {
  const t = (file.type || '').split('/')[0];
  return ['image', 'video', 'audio'].includes(t) ? t : 'document';
};

// Split a raw hashtags string into clean tags (no leading #, no blanks, deduped).
export const splitTags = (s) => {
  const seen = new Set();
  return String(s || '')
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
};

// Hashtags arrive as an array from the API but as a raw string from the live form,
// so normalise before rendering pills.
export const asTags = (v) => (Array.isArray(v) ? v : splitTags(v));

export const inp = 'w-full h-10 px-3 text-sm border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-orange-500/20';

// Same skin as `inp` minus the fixed h-10, which fought every rows= we set and pinned
// long captions to a three-line slot. resize-y lets the operator drag it taller still.
export const ta = 'w-full px-3 py-2 text-sm leading-relaxed border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-orange-500/20 resize-y';

export const Field = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</label>
    {children}
  </div>
);

// ── Hashtags "tags input" (bootstrap-tagsinput style) ─────────────────────────
// Type + Enter/comma turns text into a removable #pill; Backspace on an empty box
// deletes the last tag. Kept string-in / string-out (space-joined) so the payload
// contract and the backend's hashtag splitter are untouched — only the UI changed.
export const TagsInput = ({ value, onChange, placeholder }) => {
  const [draft, setDraft] = useState('');
  const tags = splitTags(value);
  const commit = (next) => onChange(splitTags(next.join(' ')).join(' '));
  const addDraft = () => {
    const parts = splitTags(draft);
    setDraft('');
    if (parts.length) commit([...tags, ...parts]);
  };
  const removeAt = (i) => commit(tags.filter((_, idx) => idx !== i));
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDraft(); }
    else if (e.key === 'Backspace' && !draft && tags.length) { e.preventDefault(); commit(tags.slice(0, -1)); }
  };
  return (
    <div className={inp + ' h-auto min-h-10 flex flex-wrap items-center gap-1.5 py-1.5'}
      onClick={(e) => { const el = e.currentTarget.querySelector('input'); if (el) el.focus(); }}>
      {tags.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full pl-2 pr-1 py-0.5">
          #{t}
          <button type="button" onClick={(e) => { e.stopPropagation(); removeAt(i); }} className="hover:text-orange-900" aria-label={`Remove ${t}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input className="flex-1 min-w-[8ch] bg-transparent outline-none text-sm"
        value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={addDraft}
        placeholder={tags.length ? '' : (placeholder || 'Type a tag, press Enter')} />
    </div>
  );
};

export const MediaThumb = ({ m }) => {
  if (m.kind === 'image') {
    return <img src={m.url} alt={m.name || ''} className="w-16 h-16 rounded-lg border border-gray-200 object-cover" />;
  }
  const Icon = m.kind === 'video' ? Video : m.kind === 'audio' ? Music : m.kind === 'link' ? LinkIcon : FileText;
  return (
    <a href={m.url} target="_blank" rel="noreferrer" title={m.name || m.url}
      className="w-16 h-16 rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50 text-gray-400 hover:text-gray-600">
      <Icon className="h-6 w-6" />
    </a>
  );
};

// ── Reusable creative editor (used for the shared creative AND per-platform) ──
export const CreativeEditor = ({ value, onChange, platform, compact, withTitle, captionLabel, captionHint, captionRows, captionWarn }) => {
  const types = CONTENT_TYPES_BY_PLATFORM[platform || '_shared'] || CONTENT_TYPES_BY_PLATFORM._shared;
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [upErr, setUpErr] = useState('');
  const patch = (p) => onChange({ ...value, ...p });

  const MAX_MB = 200;
  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    // Fail fast with a clear message rather than a slow, silent failure.
    const tooBig = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) {
      setUpErr(`"${tooBig.name}" is ${(tooBig.size / 1048576).toFixed(0)}MB — max ${MAX_MB}MB. Compress it or paste a URL instead.`);
      return;
    }
    setUploading(true); setUpErr('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const res = await api.post('/uploads/s3', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000, // large videos need time to upload
      });
      const uploaded = (res.data?.uploads || []).map((u, i) => ({ url: u.url, kind: kindOf(files[i]), name: files[i].name }));
      patch({ media: [...(value.media || []), ...uploaded] });
    } catch (e) {
      setUpErr(
        e.response?.data?.message
        || (e.code === 'ECONNABORTED'
          ? 'Upload timed out — the file may be too large. Try a smaller file or paste a URL.'
          : 'Upload failed — you can paste a URL instead.'),
      );
    } finally { setUploading(false); }
  };
  const addUrl = () => {
    if (!urlInput.trim()) return;
    patch({ media: [...(value.media || []), { url: urlInput.trim(), kind: 'link', name: urlInput.trim() }] });
    setUrlInput('');
  };
  const removeMedia = (i) => patch({ media: (value.media || []).filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-2.5">
      {/* Per-platform only. The shared creative already runs under the campaign's own
          Title field above this editor, so rendering a second one there would just
          duplicate it. Left blank the override inherits that campaign title — so it is
          deliberately NOT pre-filled: a copy would silently stop tracking the original. */}
      {withTitle && (
        <Field label="Title (optional)">
          <input className={inp} value={value.title || ''}
            placeholder="Defaults to the campaign title"
            onChange={(e) => patch({ title: e.target.value })} />
        </Field>
      )}
      <Field label="Content type">
        <select className={inp} value={value.content_type} onChange={(e) => patch({ content_type: e.target.value })}>
          {types.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label={captionLabel || 'Caption / post text'}>
        {/* The caption IS the post. A ten-line message read through a three-line window
            meant scrolling to check your own copy, so this sizes to the content it is
            given and stays draggable. */}
        <textarea rows={captionRows || (compact ? 4 : 8)} className={ta}
          placeholder="The exact copy the influencer should post…"
          value={value.caption || ''} onChange={(e) => patch({ caption: e.target.value })} />
        <div className="flex items-start justify-between gap-3">
          {captionHint ? <p className="text-[11px] text-gray-400 flex-1">{captionHint}</p> : <span className="flex-1" />}
          <span className={`text-[11px] shrink-0 tabular-nums ${captionWarn ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
            {String(value.caption || '').length} chars
          </span>
        </div>
      </Field>
      <Field label="Hashtags">
        <TagsInput value={value.hashtags || ''} onChange={(v) => patch({ hashtags: v })}
          placeholder="#campaign #topic — Enter or comma to add" />
      </Field>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Media (image / video / audio)</label>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
            <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
            <input type="file" multiple accept="image/*,video/*,audio/*" className="hidden" disabled={uploading}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <input className={inp + ' flex-1'} placeholder="…or paste a URL" value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }} />
          <button type="button" onClick={addUrl}
            className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Add</button>
        </div>
        {upErr && <p className="text-xs text-red-500">{upErr}</p>}
        {(value.media || []).length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {value.media.map((m, i) => (
              <div key={i} className="relative">
                <MediaThumb m={m} />
                <button type="button" onClick={() => removeMedia(i)}
                  className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-400 hover:text-red-500 shadow-sm">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── "What gets posted where" ─────────────────────────────────────────────────
// The per-platform creative IS the answer to "what will actually be published",
// so it renders as a first-class section rather than the grey "Custom content
// for: …" footnote it used to be — a tenant could not tell their per-platform
// copy had saved at all.
//
// Two rules make it honest:
//  · EVERY selected platform gets a row, not only the customized ones. A platform
//    running on the shared creative is a decision worth showing, not an absence
//    the reader has to infer.
//  · Fields fall back individually, so a row shows what really goes out: the
//    override's value when it has one, otherwise the shared value rendered muted.

// -> { value, inherited }. `inherited` drives the visual de-emphasis, so a reader
// can always tell a typed-per-platform value from one showing through from above.
export const pickValue = (own, sharedValue) => {
  const filled = Array.isArray(own) ? own.length > 0 : String(own ?? '').trim() !== '';
  return filled ? { value: own, inherited: false } : { value: sharedValue, inherited: true };
};

// An override toggled on but never filled in is not a custom variant — it inherits.
export const isCustomised = (pc) => !!pc && !!(
  String(pc.title || '').trim() || String(pc.content_type || '').trim() || String(pc.caption || '').trim()
  || asTags(pc.hashtags).length || (pc.media || []).length
);

export const PlatformRow = ({ platform, pc, shared }) => {
  const custom = isCustomised(pc);
  const title = pickValue(pc && pc.title, shared.title);
  const type = pickValue(pc && pc.content_type, shared.content_type);
  const caption = pickValue(pc && pc.caption, shared.caption);
  const hashtags = pickValue(pc && pc.hashtags, shared.hashtags);
  const media = pickValue(pc && pc.media, shared.media);
  const tagList = asTags(hashtags.value);
  const mediaList = Array.isArray(media.value) ? media.value : [];
  const empty = !String(caption.value || '').trim() && !tagList.length && !mediaList.length;

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-gray-800">{platform}</span>
            {type.value && (
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${type.inherited ? 'bg-gray-50 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                {type.value}
              </span>
            )}
          </div>
          {title.value && (
            <p className={`text-xs mt-0.5 break-words ${title.inherited ? 'text-gray-400' : 'font-semibold text-gray-700'}`}>
              {title.value}
            </p>
          )}
        </div>
        <span className={`shrink-0 whitespace-nowrap text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
          custom ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-white text-gray-400 border-gray-200'}`}>
          {custom ? 'Custom' : 'Uses shared creative'}
        </span>
      </div>
      {String(caption.value || '').trim() && (
        <p className={`text-xs mt-1.5 whitespace-pre-wrap break-words ${caption.inherited ? 'text-gray-400' : 'text-gray-700'}`}>
          {caption.value}
        </p>
      )}
      {tagList.length > 0 && (
        <p className={`text-[11px] mt-1 break-words ${hashtags.inherited ? 'text-gray-400' : 'text-orange-600'}`}>
          {tagList.map((h) => `#${h}`).join(' ')}
        </p>
      )}
      {mediaList.length > 0 && (
        <div className={`flex flex-wrap gap-2 mt-1.5 ${media.inherited ? 'opacity-60' : ''}`}>
          {mediaList.map((m, i) => <MediaThumb key={i} m={m} />)}
        </div>
      )}
      {empty && <p className="text-[11px] text-gray-300 mt-1">No creative attached — the brief is the description above.</p>}
    </div>
  );
};

export const PlatformBreakdown = ({ platforms, shared, overrides, defaultOpen = true, className = '' }) => {
  // One toggle for the WHOLE section, open by default — never one per platform.
  // The reader's question is "is the X copy right?", which a click can only delay.
  const [open, setOpen] = useState(defaultOpen);
  const list = (platforms || []).filter(Boolean);
  if (!list.length) return null; // nothing selected → nothing to say

  const byPlatform = {};
  (overrides || []).forEach((pc) => { if (pc && pc.platform) byPlatform[pc.platform] = pc; });
  const customCount = list.filter((p) => isCustomised(byPlatform[p])).length;

  return (
    <div className={`mt-3 rounded-xl border border-gray-100 bg-gray-50/40 ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">What gets posted where</span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
          {customCount ? `${customCount} of ${list.length} custom` : 'all shared'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {list.map((p) => <PlatformRow key={p} platform={p} pc={byPlatform[p]} shared={shared || {}} />)}
        </div>
      )}
    </div>
  );
};
