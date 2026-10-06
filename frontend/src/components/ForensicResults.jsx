import React from 'react';
import { ShieldCheck, AlertTriangle, AlertCircle } from 'lucide-react';

const ForensicResults = ({ results }) => {
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    return (
        <div className="mt-3 p-3 rounded-md bg-muted/30 border border-border/50">
            <div className="flex items-center gap-2 mb-2 text-primary">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Deepfake Analysis</span>
            </div>
            <div className="space-y-2">
                {results.map((res, idx) => {
                    const isFake = (res.verdict === 'FAKE' || res.status === 'DANGER');
                    const isError = res.error || (res.verdict === null && res.confidence === null);
                    const Icon = isError ? AlertCircle : (isFake ? AlertTriangle : ShieldCheck);

                    let statusText = res.verdict || res.status || 'ANALYZING...';
                    if (statusText === 'SAFE') statusText = 'REAL';
                    if (statusText === 'DANGER') statusText = 'FAKE';
                    if (isError) statusText = 'SCAN FAILED';

                    const confidenceValue = typeof res.confidence === 'number' ? res.confidence : parseFloat(res.confidence);

                    return (
                        <div key={idx} className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                    <Icon className={`h-3.5 w-3.5 shrink-0 ${isError ? 'text-amber-500' : (isFake ? 'text-red-500' : 'text-emerald-500')}`} />
                                    <span className={`text-[11px] font-bold ${isError ? 'text-amber-600' : (isFake ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}`}>
                                        {res.type?.toUpperCase() || (res.url?.includes('.mp4') ? 'VIDEO' : 'IMAGE')} : {statusText}
                                    </span>
                                </div>
                                {!isNaN(confidenceValue) && confidenceValue !== null && (
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                        {(confidenceValue * 100).toFixed(1)}%
                                    </span>
                                )}
                            </div>
                            {(res.message || res.error) && (
                                <p className="text-[10px] text-muted-foreground italic pl-5 line-clamp-1">
                                    {res.error || res.message}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ForensicResults;
