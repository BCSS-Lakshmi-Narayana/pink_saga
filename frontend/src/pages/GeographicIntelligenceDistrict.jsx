import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import GeoBreadcrumb from '../components/geographic/GeoBreadcrumb';
import GeoFilterBar from '../components/geographic/GeoFilterBar';
import DistrictDetailPanel from '../components/geographic/DistrictDetailPanel';
import { formatGeoName } from '../components/geographic/sentimentScale';
import { useGeoScope } from '../hooks/useGeoIntel';
import { useGeoFilters } from '../hooks/useGeoFilters';

/**
 * Standalone deep-link for a single district — the target of "View Full
 * District" links from the State Overview map/snapshot and any external
 * ?location= link. Renders the same DistrictDetailPanel used inside the
 * District Explorer tab's split pane, so drill-down logic lives in one place.
 */
const GeographicIntelligenceDistrict = () => {
  const { districtKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { scope } = useGeoScope();
  const [filters, handleFilterChange] = useGeoFilters(searchParams, setSearchParams);

  const canSeeAll = scope?.can_see_all_districts;
  const districtLabel = formatGeoName(districtKey);

  return (
    <div className="space-y-4">
      <div>
        <GeoBreadcrumb
          crumbs={
            canSeeAll
              ? [{ label: 'Geographic Intelligence', to: '/geographic-intelligence' }, { label: districtLabel }]
              : [{ label: 'Your District' }, { label: districtLabel }]
          }
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-lg font-extrabold text-slate-800">District Intelligence</h1>
          <GeoFilterBar filters={filters} onChange={handleFilterChange} />
        </div>
      </div>

      <DistrictDetailPanel districtKey={districtKey} filters={filters} />
    </div>
  );
};

export default GeographicIntelligenceDistrict;
