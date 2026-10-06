import React, { useEffect, useState, useCallback } from 'react';
import { Newspaper, Loader2, MapPin, ArrowRight, X } from 'lucide-react';
import { Card } from './ui/card';
import RssNewsCard from './grievances/RssNewsCard';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { canManageRestrictedGrievanceUi } from '../lib/grievanceUiPermissions';

/**
 * DistrictNewsPanel
 * ─────────────────────────────────────────────────────────────────────
 * Newspaper coverage for the district a constituency belongs to
 * (Kunkuri → Jashpur, Kawardha → Kabirdham, Konta → Sukma …). Shows a per-outlet breakdown
 * — which paper is covering the area and how much — and clicking an outlet
 * reveals exactly its articles as proof of what they're publishing.
 * AC → district mapping + fetch happen on the backend.
 */
const DistrictNewsPanel = ({ constituency, constituencyDisplayName, sectionNumber }) => {
  const { user } = useAuth();
  const canManage = canManageRestrictedGrievanceUi(user);
  const [articles, setArticles] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [district, setDistrict] = useState(null);
  const [activeSource, setActiveSource] = useState(null); // null = all outlets
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchNews = useCallback(async (page = 1, append = false) => {
    if (!constituency) return;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '6' });
      if (activeSource) params.set('source', activeSource);
      const res = await api.get(`/news/constituency/${encodeURIComponent(constituency)}?${params.toString()}`);
      setDistrict(res.data?.district ?? null);
      // Outlet list is district-wide (stable regardless of the active filter).
      if (res.data?.outlets) setOutlets(res.data.outlets);
      setArticles((prev) => (append ? [...prev, ...(res.data?.articles || [])] : (res.data?.articles || [])));
      setPagination(res.data?.pagination || { page: 1, pages: 0, total: 0 });
    } catch (err) {
      console.error('[DistrictNews] fetch error:', err);
      if (!append) setArticles([]);
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }, [constituency, activeSource]);

  // Refetch page 1 whenever the constituency or the selected outlet changes.
  useEffect(() => { fetchNews(1, false); }, [fetchNews]);

  // Admin-only: delete / re-label an article. Both refetch so the outlet
  // breakdown (counts + sentiment split) stays in sync.
  const handleDelete = async (article) => {
    const id = article?._id;
    if (!id) return;
    try {
      await api.delete(`/news/${id}`);
      setArticles((prev) => prev.filter((a) => a._id !== id));
      fetchNews(1, false);
    } catch (err) {
      console.error('[DistrictNews] delete error:', err);
    }
  };

  const handleSentiment = async (article, sentiment) => {
    const id = article?._id;
    if (!id) return;
    try {
      await api.patch(`/news/${id}/sentiment`, { sentiment });
      setArticles((prev) => prev.map((a) => (a._id === id ? { ...a, sentiment } : a)));
      fetchNews(1, false);
    } catch (err) {
      console.error('[DistrictNews] sentiment error:', err);
    }
  };

  const totalDistrictArticles = outlets.reduce((s, o) => s + (o.count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Section banner */}
      <div className="rounded-xl bg-white border border-slate-200 px-5 py-3 flex items-center justify-between flex-wrap gap-2 shadow-sm">
        <div className="flex items-center gap-3">
          {sectionNumber != null && (
            <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold shrink-0">{sectionNumber}</div>
          )}
          <div>
            <div className="text-sm font-bold text-slate-800 flex items-center gap-2 flex-wrap">
              District News Coverage
              {district && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                  <MapPin className="h-3 w-3" /> {district} district
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              Which newspaper is covering {constituencyDisplayName || constituency}&rsquo;s district — click a paper to read exactly what they published.
            </div>
          </div>
        </div>
        {totalDistrictArticles > 0 && (
          <span className="text-[11px] text-slate-400 whitespace-nowrap">{totalDistrictArticles} article{totalDistrictArticles !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Per-outlet breakdown with sentiment split (clickable → shows articles) */}
      {!loading && outlets.length > 0 && (() => {
        const d = outlets.reduce((a, o) => ({
          p: a.p + (o.positive || 0), n: a.n + (o.negative || 0), m: a.m + (o.neutral ?? o.moderate ?? 0),
        }), { p: 0, n: 0, m: 0 });
        const dTotal = (d.p + d.n + d.m) || 1;
        const pctW = (n, t) => `${((n || 0) / (t || 1)) * 100}%`;
        return (
          <Card className="p-4 border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                <Newspaper className="h-3 w-3" /> Coverage by outlet · who&rsquo;s covering {district || 'the district'}
              </div>
              <div className="flex items-center gap-2.5 text-[10px] font-semibold">
                <span className="text-emerald-600">{d.p} Pos</span>
                <span className="text-amber-600">{d.m} Mod</span>
                <span className="text-rose-600">{d.n} Neg</span>
              </div>
            </div>

            {/* District-wide sentiment bar */}
            <div className="h-2 rounded-full overflow-hidden flex bg-slate-100">
              <div style={{ width: pctW(d.p, dTotal), background: '#22c55e' }} />
              <div style={{ width: pctW(d.m, dTotal), background: '#f59e0b' }} />
              <div style={{ width: pctW(d.n, dTotal), background: '#f43f5e' }} />
            </div>

            {/* Outlet rows — click one to see its articles below */}
            <div className="space-y-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setActiveSource(null)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 border text-left transition-colors ${
                  activeSource === null ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-xs font-semibold text-slate-700 flex-1">All papers</span>
                <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{totalDistrictArticles}</span>
              </button>
              {outlets.map((o) => {
                const total = o.count || 1;
                const isActive = activeSource === o.source_name;
                return (
                  <button
                    key={o.source_name}
                    type="button"
                    onClick={() => setActiveSource(isActive ? null : o.source_name)}
                    title={`Show ${o.count} article${o.count !== 1 ? 's' : ''} from ${o.source_name}`}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 border text-left transition-colors ${
                      isActive ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xs font-semibold text-slate-700 flex-1 min-w-0 truncate">{o.source_name}</span>
                    {o.negative > 0 && (
                      <span className="text-[10px] font-bold text-rose-600 shrink-0">{o.negative} neg</span>
                    )}
                    <div className="w-20 sm:w-24 h-2 rounded-full overflow-hidden flex bg-slate-100 shrink-0">
                      <div style={{ width: pctW(o.positive, total), background: '#22c55e' }} />
                      <div style={{ width: pctW(o.neutral ?? o.moderate, total), background: '#94a3b8' }} />
                      <div style={{ width: pctW(o.negative, total), background: '#f43f5e' }} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 w-6 text-right shrink-0">{o.count}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* Article list (the "proof") */}
      {loading ? (
        <Card className="p-8 border-slate-200 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </Card>
      ) : articles.length === 0 ? (
        <Card className="p-8 border-slate-200 flex flex-col items-center gap-2 text-center">
          <Newspaper className="h-8 w-8 text-slate-300" />
          <div className="text-sm font-medium text-slate-600">
            No district news collected yet{district ? ` for ${district}` : ''}.
          </div>
        </Card>
      ) : (
        <>
          {activeSource && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Showing <span className="font-semibold text-slate-800">{pagination.total}</span> from <span className="font-semibold text-slate-800">{activeSource}</span></span>
              <button
                type="button"
                onClick={() => setActiveSource(null)}
                className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium"
              >
                <X className="h-3 w-3" /> clear
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {articles.map((a, i) => (
              <RssNewsCard
                key={a._id || a.id || i}
                article={a}
                canManage={canManage}
                onDelete={handleDelete}
                onSentimentChange={handleSentiment}
              />
            ))}
          </div>
          {pagination.page < pagination.pages && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => fetchNews(pagination.page + 1, true)}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 px-4 py-2 text-xs font-semibold hover:bg-violet-100 transition-colors disabled:opacity-50"
              >
                {loadingMore
                  ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>)
                  : (<>Load more <ArrowRight className="h-3.5 w-3.5" /></>)}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DistrictNewsPanel;
