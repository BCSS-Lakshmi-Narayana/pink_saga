import React from 'react';
import { Card } from '../ui/card';
import { Flame, Activity, TrendingUp, Sparkles } from 'lucide-react';

const scoreColor = (score) => {
  if (score >= 75) return { ring: 'text-red-500', glow: 'shadow-red-500/30', label: 'Viral' };
  if (score >= 50) return { ring: 'text-orange-500', glow: 'shadow-orange-500/30', label: 'Hot' };
  if (score >= 25) return { ring: 'text-amber-500', glow: 'shadow-amber-500/20', label: 'Warm' };
  return { ring: 'text-emerald-500', glow: 'shadow-emerald-500/20', label: 'Cool' };
};

const Stat = ({ icon: Icon, label, value, sublabel }) => (
  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
    <div className="h-9 w-9 rounded-full bg-background flex items-center justify-center">
      <Icon className="h-4 w-4 text-orange-500" />
    </div>
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-base font-semibold leading-tight truncate">{value}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground truncate">{sublabel}</p>}
    </div>
  </div>
);

const TrendingScoreCard = ({ summary, lastUpdated }) => {
  const score = Math.max(0, Math.min(100, summary?.trendingScore || 0));
  const tone = scoreColor(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <Card className="p-6 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="h-5 w-5 text-orange-500" />
        <h2 className="text-lg font-heading font-semibold">Trending Score</h2>
      </div>

      <div className="flex flex-col items-center justify-center mb-5">
        <div className={`relative h-32 w-32 ${tone.glow} rounded-full`}>
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r={radius}
              stroke="currentColor"
              strokeWidth="10"
              className="text-muted/40"
              fill="none"
            />
            <circle
              cx="60"
              cy="60"
              r={radius}
              stroke="currentColor"
              strokeWidth="10"
              strokeLinecap="round"
              className={tone.ring}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums">{score}</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{tone.label}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <Stat
          icon={Activity}
          label="Average Interest"
          value={`${summary?.averageInterest ?? 0} / 100`}
        />
        <Stat
          icon={TrendingUp}
          label="Peak Interest"
          value={summary?.peakInterest ? `${summary.peakInterest.value} / 100` : '—'}
          sublabel={summary?.peakInterest?.time || ''}
        />
        <Stat
          icon={Sparkles}
          label="Data Coverage"
          value={`${summary?.dataPoints ?? 0} points · ${summary?.topRegionsCount ?? 0} regions`}
          sublabel={lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleString()}` : ''}
        />
      </div>
    </Card>
  );
};

export default TrendingScoreCard;
