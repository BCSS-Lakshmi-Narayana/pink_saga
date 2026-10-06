import React, { useState } from 'react';
import { Card } from '../ui/card';
import { MapPin, Download, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 10;

const downloadCsv = (regions) => {
  if (!regions.length) return;
  const csv = [
    'geoCode,geoName,value,formatted',
    ...regions.map((r) => `${r.geoCode || ''},${(r.geoName || '').replace(/,/g, ' ')},${r.value},${r.formatted || ''}`)
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'top-regions.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const TopRegionsCard = ({ regions = [] }) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(regions.length / PAGE_SIZE));
  const pageItems = regions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const max = regions.length ? Math.max(...regions.map((r) => r.value || 0), 1) : 1;

  return (
    <Card className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-heading font-semibold">Interest by region</h2>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(regions)}
          disabled={!regions.length}
          className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          title="Download CSV"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>

      {regions.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No regional data for this keyword.
        </div>
      ) : (
        <>
          <ul className="space-y-3 flex-1">
            {pageItems.map((region) => {
              const pct = Math.round(((region.value || 0) / max) * 100);
              return (
                <li key={region.geoCode || region.geoName} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="font-medium text-foreground truncate pr-2">{region.geoName}</span>
                    <span className="text-muted-foreground tabular-nums text-xs">
                      {region.formatted || `${region.value}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-xs">
              <span className="text-muted-foreground tabular-nums">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, regions.length)} of {regions.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default TopRegionsCard;
