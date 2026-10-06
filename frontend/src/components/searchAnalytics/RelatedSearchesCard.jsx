import React, { useMemo, useState } from 'react';
import { Card } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import {
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Flame
} from 'lucide-react';

const PAGE_SIZE = 10;

const downloadCsv = (rows, filename) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const ChangeBadge = ({ item }) => {
  if (item.breakout) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded">
        <Flame className="h-3 w-3" />
        Breakout
      </span>
    );
  }
  const pct = item.changePct;
  if (pct == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-500">
        <ArrowUp className="h-3 w-3" /> +{pct}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-500">
        <ArrowDown className="h-3 w-3" /> {pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" /> 0%
    </span>
  );
};

const InterestBar = ({ value, max }) => {
  if (typeof value !== 'number' || value <= 0) {
    return <div className="h-1.5 rounded-full bg-muted/60 w-2" />;
  }
  const pct = Math.max(2, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="h-1.5 rounded-full bg-muted/60 w-full overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-sky-400"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

const QueryTable = ({ title, items, kind, total, page, onPageChange, accent, onDownload }) => {
  const maxValue = items.length ? Math.max(...items.map((i) => i.value || 0), 1) : 1;
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {total}
          </span>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={!items.length}
          className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          title="Download CSV"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No {kind === 'rising' ? 'rising' : 'top'} data for this keyword.
        </div>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
            <div className="col-span-1">#</div>
            <div className="col-span-5">Query</div>
            <div className="col-span-4">Search interest</div>
            <div className="col-span-2 text-right">
              {kind === 'rising' ? 'Change' : 'Score'}
            </div>
          </div>
          <ul className="divide-y divide-border">
            {pageItems.map((item) => (
              <li key={`${title}-${item.rank}-${item.query}`} className="grid grid-cols-12 gap-3 px-4 py-2.5 items-center text-sm hover:bg-muted/30 transition-colors">
                <div className="col-span-1 text-muted-foreground tabular-nums text-xs">{item.rank}</div>
                <div className="col-span-12 sm:col-span-5 flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-medium" title={item.query}>{item.query}</span>
                  {item.topicType && (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                      {item.topicType}
                    </span>
                  )}
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Open in Google Trends"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="col-span-7 sm:col-span-4">
                  <InterestBar value={item.value} max={maxValue} />
                </div>
                <div className="col-span-5 sm:col-span-2 text-right">
                  {kind === 'rising' ? (
                    <ChangeBadge item={item} />
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">{item.value ?? '—'}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs">
              <span className="text-muted-foreground tabular-nums">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, items.length)} of {items.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className={`h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors ${accent}`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className={`h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors ${accent}`}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TablesPair = ({ topItems, risingItems, kind, keyword }) => {
  const [topPage, setTopPage] = useState(1);
  const [risingPage, setRisingPage] = useState(1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <QueryTable
        title={`Top ${kind}`}
        items={topItems}
        kind="top"
        total={topItems.length}
        page={topPage}
        onPageChange={setTopPage}
        accent="hover:border-blue-500/40"
        onDownload={() =>
          downloadCsv(
            topItems.map((i) => ({ rank: i.rank, query: i.query, score: i.value })),
            `top-${kind}-${keyword || 'trends'}.csv`
          )
        }
      />
      <QueryTable
        title={`Rising ${kind}`}
        items={risingItems}
        kind="rising"
        total={risingItems.length}
        page={risingPage}
        onPageChange={setRisingPage}
        accent="hover:border-emerald-500/40"
        onDownload={() =>
          downloadCsv(
            risingItems.map((i) => ({
              rank: i.rank,
              query: i.query,
              change: i.breakout ? 'Breakout' : i.changePct != null ? `${i.changePct}%` : ''
            })),
            `rising-${kind}-${keyword || 'trends'}.csv`
          )
        }
      />
    </div>
  );
};

const RelatedSearchesCard = ({ data }) => {
  const queries = data?.queries || { top: [], rising: [] };
  const topics = data?.topics || { top: [], rising: [] };
  const keyword = data?.query || '';

  const hasQueries = queries.top.length > 0 || queries.rising.length > 0;
  const hasTopics = topics.top.length > 0 || topics.rising.length > 0;

  const defaultTab = useMemo(() => (hasQueries ? 'queries' : hasTopics ? 'topics' : 'queries'), [hasQueries, hasTopics]);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-heading font-semibold">Commonly searched queries</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            People who searched for <span className="font-medium text-foreground">{keyword}</span> also searched for these queries
          </p>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="queries" disabled={!hasQueries}>
            Queries
            <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
              {queries.top.length + queries.rising.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="topics" disabled={!hasTopics}>
            Topics
            <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
              {topics.top.length + topics.rising.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queries">
          {hasQueries ? (
            <TablesPair topItems={queries.top} risingItems={queries.rising} kind="queries" keyword={keyword} />
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Google Trends doesn't have enough search volume to surface related queries for "{keyword}".
              Try a longer date range or a broader term.
            </p>
          )}
        </TabsContent>

        <TabsContent value="topics">
          {hasTopics ? (
            <TablesPair topItems={topics.top} risingItems={topics.rising} kind="topics" keyword={keyword} />
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No related topics surfaced for this keyword. Topics group multiple search variations together.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
};

export default RelatedSearchesCard;
