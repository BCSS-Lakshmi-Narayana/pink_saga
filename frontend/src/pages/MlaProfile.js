import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2, Calendar, ExternalLink, Swords } from 'lucide-react';
import VoterProfilePanel from '../components/VoterProfilePanel';
import SocialNarrativePanel from '../components/SocialNarrativePanel';
import CompareModal from '../components/compare/CompareModal';
import DistrictNewsPanel from '../components/DistrictNewsPanel';
import api from '../lib/api';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { GrievanceCard } from '../components/grievances/GrievanceCard';
import GrievanceAnalysisModal from '../components/grievances/GrievanceAnalysisModal';
import { getMlaByConstituency } from '../data/stateMLAs';
import { useAuth } from '../contexts/AuthContext';
import { canManageRestrictedGrievanceUi } from '../lib/grievanceUiPermissions';
import { toast } from 'sonner';
import { partyStyle as partyStyleFor } from '../config/partyColors';
import { BRAND } from '../config/partyMedia';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';


const titleCase = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const getProxiedMediaUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  if (rawUrl.startsWith('/api/media/stream') || rawUrl.startsWith('/api/media/proxy'))
    return `${BACKEND_URL}${rawUrl}`;
  if (rawUrl.startsWith('/') || rawUrl.startsWith(BACKEND_URL)) return rawUrl;
  const needsProxy =
    rawUrl.includes('twimg.com') ||
    rawUrl.includes('fbcdn.net') ||
    rawUrl.includes('cdninstagram.com') ||
    rawUrl.includes('fbsbx.com') ||
    rawUrl.includes('googleusercontent.com');
  if (needsProxy) return `${BACKEND_URL}/api/media/stream?url=${encodeURIComponent(rawUrl)}`;
  return rawUrl;
};

const AlertItem = ({ alert }) => {
  const sev = String(alert.severity || alert.risk_level || 'medium').toLowerCase();
  const sevColor =
    sev === 'critical' || sev === 'high'
      ? 'bg-red-100 text-red-700 border-red-300'
      : sev === 'medium'
      ? 'bg-amber-100 text-amber-700 border-amber-300'
      : 'bg-slate-100 text-slate-700 border-slate-300';
  const title = alert.title || alert.description || alert.content_data?.text || 'Alert';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 hover:bg-slate-50 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 line-clamp-2">{title}</div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
            <Badge className={`border ${sevColor} text-[10px] py-0`}>{sev.toUpperCase()}</Badge>
            {alert.platform && <span>{alert.platform}</span>}
            {alert.created_at && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(alert.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <Link
          to={`/alerts?search=${encodeURIComponent(alert.id || alert._id || '')}`}
          className="text-blue-600 hover:text-blue-800"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
};

const NegativeMentionItem = ({ item }) => (
  <div className="rounded-md border border-red-100 bg-red-50/40 p-3">
    <div className="text-sm text-slate-800 line-clamp-3">{item.text || '—'}</div>
    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
      {item.display_name && <span className="font-medium">{item.display_name}</span>}
      {item.handle && <span>@{item.handle}</span>}
      {item.platform && <span>· {item.platform}</span>}
      {item.post_date && <span>· {new Date(item.post_date).toLocaleDateString()}</span>}
    </div>
  </div>
);

const MlaProfile = () => {
  const { constituency } = useParams();
  const navigate = useNavigate();
  const decoded = decodeURIComponent(constituency || '');
  const mla = useMemo(() => getMlaByConstituency(decoded), [decoded]);
  const { user, isScoped, isSuperAdmin, assignedConstituency, canAccessConstituency } = useAuth();
  const canManageSpecialGrievanceUi = canManageRestrictedGrievanceUi(user);

  // RBAC guard: scoped users (MLA / MP / Senior Leader) can't view other seats —
  // bounce them back to their own constituency on URL manipulation.
  useEffect(() => {
    if (isScoped && !isSuperAdmin && !canAccessConstituency(decoded)) {
      if (assignedConstituency) {
        navigate(`/mla/${encodeURIComponent(titleCase(assignedConstituency))}`, { replace: true });
      } else {
        navigate('/state-map', { replace: true });
      }
    }
  }, [decoded, isScoped, isSuperAdmin, assignedConstituency, canAccessConstituency, navigate]);

  const [topIssues, setTopIssues] = useState([]);
  const [recentNegative, setRecentNegative] = useState([]);
  const [grievances, setGrievances] = useState([]);
  const [alerts, setAlerts] = useState([]);
  // Full evidence counts (the lists below are capped at 100 / 50 cards).
  const [grievancesTotal, setGrievancesTotal] = useState(0);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [voterProfile, setVoterProfile] = useState(null);
  const [voterProfileLoading, setVoterProfileLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const constName = mla?.constituency || decoded;

    setLoading(true);
    setAlertsLoading(true);
    setError(null);
    setVoterProfileLoading(true);

    // Fire every request in PARALLEL so the fast static voter profile isn't
    // blocked behind the slower grievance/alert aggregations. Each response
    // updates its own slice + loading flag as soon as it arrives.

    // Voter profile — static ECI data, fastest; drives the left panel.
    api.get(`/voter-profiles/${encodeURIComponent(constName)}`)
      .then((res) => { if (!cancelled) setVoterProfile(res.data?.data || null); })
      .catch(() => { if (!cancelled) setVoterProfile(null); })
      .finally(() => { if (!cancelled) setVoterProfileLoading(false); });

    // Everything below is the MLA's EVIDENCE — posts tagging their handle,
    // naming them, or naming their seat — the same posts behind their count on
    // the Statewide MLA Sentiment leaderboard (basis=leader / leader_seat).

    // Constituency intel — top issues + recent negative mentions.
    api.get(`/constituency-intel/${encodeURIComponent(constName)}`, { params: { days: 365, basis: 'leader' } })
      .then((res) => {
        if (cancelled) return;
        setTopIssues(res.data?.top_issues || []);
        setRecentNegative(res.data?.recent_negative || []);
      })
      .catch(() => { if (!cancelled) { setTopIssues([]); setRecentNegative([]); } });

    // Mentions evidencing the MLA (same 365-day window as the leaderboard).
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
    api.get('/grievances', { params: { leader_seat: constName, from: yearAgo, limit: 100, tab: 'all' } })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data?.grievances) ? res.data.grievances : [];
        setGrievances(list);
        setGrievancesTotal(res.data?.pagination?.total ?? list.length);
      })
      .catch(() => { if (!cancelled) setError('Could not load grievances for this constituency.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Alerts whose post tags / names the MLA or names the seat.
    api.get('/alerts', { params: { leader_seat: constName, limit: 50, status: 'all' } })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.alerts || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
        setAlerts(list);
        setAlertsTotal(res.data?.pagination?.total ?? list.length);
      })
      .catch(() => { if (!cancelled) setAlerts([]); })
      .finally(() => { if (!cancelled) setAlertsLoading(false); });

    return () => {
      cancelled = true;
    };
  }, [decoded, mla?.constituency]);

  const [analysisGrievance, setAnalysisGrievance] = useState(null);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const handleAction = useCallback(async (action, payload) => {
    const g = payload?.grievance;
    if (action === 'view') {
      const url = g?.tweet_url || g?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } else if (action === 'view_analysis') {
      setAnalysisGrievance(g || null);
      setIsAnalysisOpen(true);
    } else if (action === 'delete') {
      if (!canManageSpecialGrievanceUi) {
        toast.error('You do not have access to delete grievances');
        return;
      }
      if (!g?.id) return;
      try {
        await api.delete(`/grievances/${g.id}`);
        setGrievances((prev) => prev.filter((item) => item.id !== g.id));
        toast.success('Grievance deleted successfully');
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Failed to delete grievance');
      }
    }
  }, [canManageSpecialGrievanceUi]);

  // Risk-level / sentiment overrides on the analysis modal — same
  // /risk-level endpoint the main Grievances page uses, gated behind the
  // same whitelisted-admin-email check.
  const handleRiskLevelChange = useCallback(async (g, newLevel) => {
    try {
      const res = await api.put(`/grievances/${g.id}/risk-level`, { risk_level: newLevel });
      const updatedAnalysis = res?.data?.analysis;
      if (!updatedAnalysis) throw new Error('No analysis returned');
      const patch = { ...updatedAnalysis, risk_level: newLevel };
      setGrievances((prev) => prev.map((item) => (
        item.id === g.id ? { ...item, analysis: { ...(item.analysis || {}), ...patch } } : item
      )));
      setAnalysisGrievance((prev) => (
        prev && prev.id === g.id ? { ...prev, analysis: { ...(prev.analysis || {}), ...patch } } : prev
      ));
      toast.success(`Risk level updated to ${newLevel.toUpperCase()} (${updatedAnalysis.risk_score}%)`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update risk level');
      throw err;
    }
  }, []);

  const handleSentimentChange = useCallback(async (g, newSentiment) => {
    try {
      const res = await api.put(`/grievances/${g.id}/risk-level`, { sentiment: newSentiment });
      const updatedAnalysis = res?.data?.analysis;
      if (!updatedAnalysis) throw new Error('No analysis returned');
      const patch = { ...updatedAnalysis, sentiment: newSentiment };
      setGrievances((prev) => prev.map((item) => (
        item.id === g.id ? { ...item, analysis: { ...(item.analysis || {}), ...patch } } : item
      )));
      setAnalysisGrievance((prev) => (
        prev && prev.id === g.id ? { ...prev, analysis: { ...(prev.analysis || {}), ...patch } } : prev
      ));
      toast.success(`Sentiment updated to ${newSentiment.toUpperCase()}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update sentiment');
      throw err;
    }
  }, []);

  const partyStyle = mla ? partyStyleFor(mla.party).badge : '';

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-500">{BRAND.stateName}</span>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">{titleCase(decoded)}</span>
      </div>

      {/* Compact MLA identity header */}
      <Card className="p-4 border border-slate-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-500 text-xs">
              <MapPin className="h-3.5 w-3.5" />
              <span className="uppercase tracking-wide">{titleCase(decoded)} Constituency</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              {!mla ? 'No MLA on record' : mla.vacant ? 'Seat vacant' : mla.mla}
            </h1>
          </div>
          {mla && !mla.vacant && (
            <div className="flex items-center gap-2">
              <Badge className={`border ${partyStyle}`}>{mla.party}</Badge>
              <Badge variant="outline" className="border-slate-300 text-slate-600">{mla.alliance}</Badge>
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white px-3 py-1.5 text-sm font-semibold shadow-sm hover:from-indigo-500 hover:to-violet-500 transition-all active:scale-95"
              >
                <Swords className="h-4 w-4" /> Draw Comparison
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Voter Profiling first, then Social Media Narrative — each full width,
          stacked top-to-bottom. Non-dense mode (lg: breakpoints, wider gaps) is
          the right fit now that each panel owns the whole row. */}
      <div className="space-y-6">
        <div className="min-w-0">
          <VoterProfilePanel
            sectionNumber={1}
            profile={voterProfile}
            loading={voterProfileLoading}
            topIssues={topIssues}
            constituencyDisplayName={titleCase(decoded)}
          />
        </div>
        <div className="min-w-0">
          <SocialNarrativePanel
            sectionNumber={2}
            constituency={mla?.constituency || decoded}
          />
        </div>
        <div className="min-w-0">
          <DistrictNewsPanel
            sectionNumber={3}
            constituency={mla?.constituency || decoded}
            constituencyDisplayName={titleCase(decoded)}
          />
        </div>
      </div>

      {/* Detail tabs — grievances / alerts / negative mentions for this seat */}
      <Card className="p-4 border border-slate-200">
        <Tabs defaultValue="grievances" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-xl">
            <TabsTrigger value="grievances">Mentions ({grievancesTotal})</TabsTrigger>
            <TabsTrigger value="alerts">Alerts ({alertsTotal})</TabsTrigger>
            <TabsTrigger value="negative">Negative Mentions</TabsTrigger>
          </TabsList>

          <TabsContent value="grievances" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                Posts tagging or naming{' '}
                <span className="font-medium text-slate-700">{mla?.mla || titleCase(decoded)}</span>
                {' '}or naming {titleCase(decoded)} · last 365 days
                {grievancesTotal > grievances.length ? ` · showing latest ${grievances.length}` : ''}
              </div>
              <Link
                to={`/grievances?leader=${encodeURIComponent(mla?.constituency || decoded)}`}
                className="text-xs text-blue-600 hover:underline"
              >
                Open in Grievances →
              </Link>
            </div>

            {loading ? (
              <div className="h-40 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : error ? (
              <div className="text-sm text-red-600 py-8 text-center">{error}</div>
            ) : grievances.length === 0 ? (
              <div className="text-sm text-slate-500 py-10 text-center">
                No posts tag or name this MLA, or name this constituency, yet.
              </div>
            ) : (
              // Masonry (Pinterest-style) layout: CSS columns let each card keep
              // its natural height instead of a rigid row-grid stretching every
              // card to match its tallest neighbour.
              <div className="columns-1 md:columns-2 xl:columns-3 gap-3 [column-fill:_balance]">
                {grievances.map((g) => (
                  <div key={g._id || g.id} className="break-inside-avoid mb-3">
                    <GrievanceCard
                      grievance={g}
                      onAction={handleAction}
                      getProxiedMediaUrl={getProxiedMediaUrl}
                      compact
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="alerts" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                Alerts whose post tags or names{' '}
                <span className="font-medium text-slate-700">{mla?.mla || titleCase(decoded)}</span>
                {' '}or names {titleCase(decoded)}
              </div>
              <Link
                to={`/alerts?leader=${encodeURIComponent(mla?.constituency || decoded)}`}
                className="text-xs text-blue-600 hover:underline"
              >
                Open in Alerts →
              </Link>
            </div>

            {alertsLoading ? (
              <div className="h-40 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-sm text-slate-500 py-10 text-center">
                No alerts tag or name this MLA, or name this constituency.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {alerts.slice(0, 30).map((a) => (
                  <AlertItem key={a.id || a._id} alert={a} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="negative" className="mt-4">
            <div className="text-xs text-slate-500 mb-3">
              Most recent negative posts tagging or naming{' '}
              <span className="font-medium text-slate-700">{mla?.mla || titleCase(decoded)}</span>
              {' '}or naming {titleCase(decoded)}
            </div>

            {recentNegative.length === 0 ? (
              <div className="text-sm text-slate-500 py-10 text-center">
                No negative mentions captured in the active window.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recentNegative.map((item, idx) => (
                  <NegativeMentionItem key={idx} item={item} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      <GrievanceAnalysisModal
        open={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        grievance={analysisGrievance}
        onRiskLevelChange={canManageSpecialGrievanceUi ? handleRiskLevelChange : undefined}
        onSentimentChange={canManageSpecialGrievanceUi ? handleSentimentChange : undefined}
      />

      {mla && (
        <CompareModal
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          me={mla}
        />
      )}
    </div>
  );
};

export default MlaProfile;
