import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, CheckCircle, Clock } from 'lucide-react';

const RISK_ICONS = {
  critical: ShieldAlert,
  high: AlertTriangle,
  medium: Clock,
  low: CheckCircle,
};

const RISK_COLORS = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  high: 'text-orange-600 bg-orange-50 border-orange-200',
  medium: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  low: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  neutral: 'text-slate-500 bg-slate-50 border-slate-200',
};

// Risk follows sentiment exactly — see backend/scripts/test_sentiment_risk_sync.js:
//   positive -> low (15),  neutral -> low (20),  negative -> high (75)
// So the pipeline only ever produces 'low' and 'high'. 'medium' and 'critical'
// can exist only on rows analysed before that rule landed, which is why this
// panel used to show two permanently-zero cards. They are now rendered only
// when they actually hold something.
const RISK_META = {
  critical: { label: 'Critical', hint: 'Legacy' },
  high: { label: 'High', hint: 'Negative' },
  medium: { label: 'Medium', hint: 'Legacy' },
  low: { label: 'Low', hint: 'Positive' },
  // Carved out of `low` by the API so routine neutral chatter is not counted
  // as praise. Grey on purpose — it is not a good signal or a bad one.
  neutral: { label: 'Neutral', hint: 'No stance' },
};
const ALWAYS_SHOWN = ['high', 'neutral', 'low'];

const APAlertsWidget = ({ data, loading }) => {
  const navigate = useNavigate();
  const summary = data?.summary || { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const recent = data?.recent || [];

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse h-full flex flex-col">
        <div className="h-4 w-32 bg-slate-200 rounded mb-4" />
        <div className="grid grid-cols-4 gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded" />
          ))}
        </div>
        <div className="flex-1 space-y-2 bg-slate-50/50 rounded-xl p-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-lg border border-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-full flex flex-col shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-bold text-slate-800">Alerts Summary</h3>
        <span className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
          {summary.total} Active Alerts
        </span>
      </div>

      {/* Risk breakdown. Dead buckets are hidden rather than shown as zeros. */}
      {(() => {
        const levels = ['critical', 'high', 'medium', 'neutral', 'low']
          .filter((l) => ALWAYS_SHOWN.includes(l) || (summary[l] || 0) > 0);
        return (
          <div
            className="grid gap-2 mb-4 flex-shrink-0"
            style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}
          >
            {levels.map((level) => {
              const count = summary[level] || 0;
              const meta = RISK_META[level] || { label: level, hint: '' };
              const style = RISK_COLORS[level] || 'text-slate-600 bg-slate-50 border-slate-200';
              return (
                <div
                  key={level}
                  title={level === 'neutral' ? 'Neutral — no stance for or against' : `${meta.label} risk — ${meta.hint}`}
                  className={`border rounded-lg px-2 py-1.5 text-center ${style}`}
                >
                  <div className="text-[10px] font-semibold opacity-85">{meta.label}</div>
                  <div className="text-base font-bold leading-tight">{count}</div>
                  <div className="text-[8px] font-medium opacity-70 leading-tight">{meta.hint}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex-shrink-0">
        Recent Alerts
      </div>

      {/* Recent Alerts List (Flex-1 to scroll nicely in 580px container) */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2">
        {recent.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-12">No recent alerts in this period</div>
        ) : (
          recent.map((alert) => {
            const Icon = RISK_ICONS[alert.risk_level] || Clock;
            const style = RISK_COLORS[alert.risk_level] || '';
            const statusColor = alert.status === 'active' ? 'bg-red-500' : 'bg-slate-400';

            return (
              <div
                key={alert.id || alert._id}
                onClick={() => {
                  const authorClean = alert.author_handle || alert.author || '';
                  const searchVal = authorClean ? (authorClean.startsWith('@') ? authorClean : `@${authorClean}`) : '';
                  navigate(`/alerts?alertId=${alert.id || alert._id}&search=${encodeURIComponent(searchVal)}`);
                }}
                className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-yellow-400 cursor-pointer shadow-sm hover:shadow transition-all duration-150"
              >
                <div className={`p-2 rounded-md ${style.split(' ')[0]} ${style.split(' ')[1]} flex-shrink-0`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      @{alert.author_handle || alert.author || 'system'}
                    </span>
                    <span className="text-[9px] text-slate-400 whitespace-nowrap">
                      {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-normal">
                    {alert.post_text || alert.description}
                  </p>
                  
                  {/* Category & Status Badges */}
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    <span className={`inline-flex items-center text-[8px] font-bold px-1.5 py-0.5 rounded capitalize ${style}`}>
                      {alert.risk_level} Risk
                    </span>
                    {/* MEDIUM is every alert's default priority, so priority alone does not mean viral. */}
                    {(alert.alert_type === 'velocity' || String(alert.title).toLowerCase().includes('viral')) && (
                      <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100">
                        🔥 Viral: {alert.priority || 'Medium'}
                      </span>
                    )}
                    {alert.intent && alert.intent !== 'Neutral' && alert.intent !== 'Unknown' && alert.intent !== 'Normal' && alert.intent !== 'Monitor' && (
                      <span className="inline-flex items-center text-[8px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100 capitalize">
                        {String(alert.intent).replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100/50">
                    <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                      {alert.platform} &middot; By {alert.author || 'system'}
                    </span>
                    <span className="flex items-center gap-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
                      <span className="text-[8px] font-bold uppercase text-slate-500">
                        {alert.status}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default APAlertsWidget;
