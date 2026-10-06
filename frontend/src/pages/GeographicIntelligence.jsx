import React, { useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Map, LayoutGrid, MapPinned, Landmark, History } from 'lucide-react';
import GeoFilterBar from '../components/geographic/GeoFilterBar';
import StateOverviewTab from '../components/geographic/tabs/StateOverviewTab';
import DistrictExplorerTab from '../components/geographic/tabs/DistrictExplorerTab';
import ConstituencyExplorerTab from '../components/geographic/tabs/ConstituencyExplorerTab';
import HistoricalPlaybackTab from '../components/geographic/tabs/HistoricalPlaybackTab';
import { useGeoScope, useStateSummary, useDistrictLeaderboard } from '../hooks/useGeoIntel';
import { useGeoFilters } from '../hooks/useGeoFilters';

const TABS = [
  ['state', 'State Overview', LayoutGrid],
  ['district', 'District Explorer', MapPinned],
  ['constituency', 'Constituency Explorer', Landmark],
  ['playback', 'Historical Playback', History],
];

/**
 * Geographic Intelligence — landing page with four tabs: State Overview
 * (heatmap + KPIs + rankings), District Explorer (search + drill-down),
 * Constituency Explorer (reuses the existing Constituency War Room API),
 * and Historical Playback (time-scrubbed heatmap).
 */
const GeographicIntelligence = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { scope, loading: scopeLoading } = useGeoScope();
  const [filters, handleFilterChange] = useGeoFilters(searchParams, setSearchParams);

  const activeTab = searchParams.get('tab') || 'state';

  // Fetched once here (not inside each tab) so the Category filter's options
  // and the State Overview tab's data share a single request.
  const { data: summary, loading: summaryLoading } = useStateSummary(filters);
  // Also hoisted here — State Overview and District Explorer both need the
  // same district leaderboard for the same filters; fetching it once at the
  // page level (matching the useStateSummary pattern above) avoids the two
  // tabs independently issuing the identical request.
  const { data: leaderboard, loading: leaderboardLoading, error: leaderboardError } = useDistrictLeaderboard(filters);
  const topicOptions = useMemo(
    () => (summary?.top_issues_by_volume || []).map((t) => t.topic).slice(0, 12),
    [summary],
  );

  // District-scoped user with exactly one district → land directly on
  // District Explorer with their district preselected, instead of the
  // state-wide leaderboard they don't have visibility into.
  const singleDistrictRedirectPending = !scopeLoading && scope && !scope.can_see_all_districts
    && scope.districts?.length === 1 && !searchParams.get('tab');

  useEffect(() => {
    if (singleDistrictRedirectPending && activeTab === 'state') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'district');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopeLoading]);

  const setTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const initialDistrictKey = scope && !scope.can_see_all_districts ? scope.districts?.[0]?.key : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-500 to-yellow-700 text-white flex items-center justify-center shadow-sm">
              <Map className="h-4.5 w-4.5" />
            </span>
            <div>
              <h1 className="text-lg font-extrabold text-slate-800 leading-tight">Geographic Intelligence</h1>
              <p className="text-[11px] text-slate-400">Deep political intelligence across Telangana</p>
            </div>
          </div>
        </div>
        {activeTab !== 'playback' && (
          <GeoFilterBar filters={filters} onChange={handleFilterChange} topicOptions={topicOptions} />
        )}
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-100/70 p-1 rounded-xl w-fit">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all duration-150 ${
              activeTab === key
                ? 'bg-white text-yellow-800 shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/*
        All four tabs stay mounted at all times (visibility toggled via CSS,
        not conditional rendering) so switching tabs preserves each tab's
        local state — search text, selected district/seat, sub-tab,
        Playback's scrubber position — instead of resetting it every time.
        Each tab receives `active` and gates its own data-fetching hooks on
        it, so a hidden tab doesn't keep polling/fetching in the background;
        only the page-level `summary`/`leaderboard` fetches (shared by
        multiple tabs and needed for the filter bar regardless of which tab
        is showing) stay unconditional.
      */}
      {activeTab === 'state' && singleDistrictRedirectPending && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-10 flex items-center justify-center text-slate-400 text-sm">
          Loading your district…
        </div>
      )}
      <div className={activeTab === 'state' && !singleDistrictRedirectPending ? 'animate-[fadeIn_0.25s_ease-out]' : 'hidden'}>
        <StateOverviewTab
          filters={filters}
          summary={summary}
          summaryLoading={summaryLoading}
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          leaderboardError={leaderboardError}
        />
      </div>
      <div className={activeTab === 'district' ? 'animate-[fadeIn_0.25s_ease-out]' : 'hidden'}>
        <DistrictExplorerTab
          filters={filters}
          initialDistrictKey={initialDistrictKey}
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          leaderboardError={leaderboardError}
          active={activeTab === 'district'}
        />
      </div>
      <div className={activeTab === 'constituency' ? 'animate-[fadeIn_0.25s_ease-out]' : 'hidden'}>
        <ConstituencyExplorerTab filters={filters} active={activeTab === 'constituency'} />
      </div>
      <div className={activeTab === 'playback' ? 'animate-[fadeIn_0.25s_ease-out]' : 'hidden'}>
        <HistoricalPlaybackTab sharedFilters={filters} active={activeTab === 'playback'} />
      </div>

      <style>{'@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}'}</style>
    </div>
  );
};

export default GeographicIntelligence;
