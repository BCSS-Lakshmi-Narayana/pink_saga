import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ExternalLink, Shield, AlertTriangle, TrendingUp, Tag, MessageSquare, Scale, FileWarning, Brain, ChevronDown, ChevronUp, Pencil, Check, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
// Shared resolver — the modal must derive sentiment/stance the same way the
// grievance card does, or the two disagree on screen for the same record.
import { getGrievanceSentiment, getGrievanceStance, needsReview, getReasoning } from '../../lib/sentiment';

// Same bands the backend uses when overriding risk level (low: 20, medium: 50, high: 75, critical: 92)
const RISK_LEVELS = [
    { value: 'low', label: 'Low', score: 20, color: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'medium', label: 'Medium', score: 50, color: 'bg-amber-100 text-amber-700 border-amber-200' },
    { value: 'high', label: 'High', score: 75, color: 'bg-red-100 text-red-700 border-red-200' },
    { value: 'critical', label: 'Critical', score: 92, color: 'bg-red-600 text-white border-red-700' }
];

const SENTIMENT_OPTIONS = [
    { value: 'positive', label: 'Positive', icon: '👍', color: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'neutral', label: 'Neutral', icon: '➖', color: 'bg-slate-100 text-slate-700 border-slate-200' },
    { value: 'negative', label: 'Negative', icon: '👎', color: 'bg-red-100 text-red-700 border-red-200' }
];

/**
 * Grievance Analysis Modal — displays full LLM analysis details.
 * Allows manual override of risk level (auto-derives risk score) and sentiment.
 */
const GrievanceAnalysisModal = ({ open, onClose, grievance, onRiskLevelChange, onSentimentChange }) => {
    const [isContentExpanded, setIsContentExpanded] = useState(false);
    const [isReasoningExpanded, setIsReasoningExpanded] = useState(true);
    const [isEditingRisk, setIsEditingRisk] = useState(false);
    const [savingRisk, setSavingRisk] = useState(false);
    const [isEditingSentiment, setIsEditingSentiment] = useState(false);
    const [savingSentiment, setSavingSentiment] = useState(false);

    if (!grievance) return null;

    const analysis = grievance.analysis || {};
    const rawRiskLevel = (analysis.risk_level || 'low').toLowerCase();
    /**
     * Resolved by the shared helper so the modal, the card badge and the card
     * border all agree. The override control offers positive/neutral/negative,
     * so a record still carrying the retired 'moderate' is shown as 'neutral'
     * — otherwise it matched no option and none highlighted as selected.
     */
    const resolvedSentiment = getGrievanceSentiment(grievance);
    const sentiment = resolvedSentiment === 'moderate' ? 'neutral' : resolvedSentiment;
    const stance = getGrievanceStance(grievance);
    const isUnreviewed = needsReview(grievance);
    const riskScore = analysis.risk_score || 0;
    const category = analysis.category || '';
    const grievanceType = analysis.grievance_type || '';
    const displayGrievanceType = (() => {
        const normalized = String(grievanceType || '').trim().toLowerCase();
        if (normalized === 'government praise' || normalized === 'govt praise' || normalized === 'general praise') {
            return 'General Complaint';
        }
        return grievanceType;
    })();
    const grievanceTopicReasoning = analysis.grievance_topic_reasoning || analysis.llm_analysis?.grievance_reasoning || '';
    const violatedPolicies = analysis.violated_policies || [];
    const legalSections = analysis.legal_sections || [];
    const reasons = analysis.reasons || [];
    const llmAnalysis = analysis.llm_analysis || {};
    /**
     * Stage 4's rationale is what produced the badge above. `analysis.explanation`
     * and `llm_analysis.reasoning` come from Pass A — a separate, earlier LLM
     * call — and showing those made the explanation contradict the label.
     */
    const explanation = getReasoning(grievance) || analysis.explanation || '';
    const contentText = grievance.content?.full_text || grievance.content?.text || '';

    // Use raw LLM values directly
    const riskLabel = (() => {
        if (rawRiskLevel === 'critical') return 'Critical';
        if (rawRiskLevel === 'high') return 'High';
        if (rawRiskLevel === 'medium') return 'Medium';
        if (rawRiskLevel === 'low') return 'Low';
        return rawRiskLevel.charAt(0).toUpperCase() + rawRiskLevel.slice(1);
    })();

    const riskColorClass = (() => {
        if (rawRiskLevel === 'critical') return 'bg-red-600 text-white border-red-700';
        if (rawRiskLevel === 'high') return 'bg-red-100 text-red-700 border-red-200';
        if (rawRiskLevel === 'medium') return 'bg-amber-100 text-amber-700 border-amber-200';
        return 'bg-green-100 text-green-700 border-green-200';
    })();

    const sentimentConfig = (() => {
        if (sentiment === 'positive') return { label: 'Positive', color: 'bg-green-100 text-green-700 border-green-200', icon: '👍' };
        if (sentiment === 'negative') return { label: 'Negative', color: 'bg-red-100 text-red-700 border-red-200', icon: '👎' };
        return { label: 'Neutral', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: '➖' };
    })();

    const safeReasons = Array.isArray(reasons)
        ? reasons.filter(r => r && typeof r === 'string' && r.trim().length > 0)
        : [];

    // Score bar color
    const scoreBarColor = riskScore >= 80 ? 'bg-red-500' : riskScore >= 50 ? 'bg-amber-500' : 'bg-green-500';

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold border-b pb-3 flex items-center gap-2">
                        <Brain className="h-5 w-5 text-indigo-600" />
                        LLM Analysis Details
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-4 space-y-0">

                    {/* ── Risk Level + Score (side by side) ── */}
                    <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Risk Level
                                </p>
                                {!isEditingRisk && onRiskLevelChange && (
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingRisk(true)}
                                        className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5"
                                        title="Override risk level"
                                    >
                                        <Pencil className="h-3 w-3" /> Edit
                                    </button>
                                )}
                            </div>
                            {!isEditingRisk ? (
                                <Badge className={cn('text-sm px-3 py-1', riskColorClass)}>
                                    {riskLabel.toUpperCase()}
                                </Badge>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap gap-1">
                                        {RISK_LEVELS.map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                disabled={savingRisk}
                                                onClick={async () => {
                                                    if (opt.value === rawRiskLevel) {
                                                        setIsEditingRisk(false);
                                                        return;
                                                    }
                                                    try {
                                                        setSavingRisk(true);
                                                        await onRiskLevelChange(grievance, opt.value);
                                                        setIsEditingRisk(false);
                                                    } catch (e) {
                                                        // Parent toasts the error; keep editor open.
                                                    } finally {
                                                        setSavingRisk(false);
                                                    }
                                                }}
                                                className={cn(
                                                    'text-[11px] font-semibold px-2 py-1 rounded border transition-all',
                                                    opt.value === rawRiskLevel ? 'ring-2 ring-offset-1 ring-indigo-400' : 'hover:opacity-80',
                                                    opt.color,
                                                    savingRisk && 'opacity-50 cursor-not-allowed'
                                                )}
                                            >
                                                {opt.label} ({opt.score}%)
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingRisk(false)}
                                        disabled={savingRisk}
                                        className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-0.5"
                                    >
                                        {savingRisk ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : <><X className="h-3 w-3" /> Cancel</>}
                                    </button>
                                </div>
                            )}
                        </div>
                        <div>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" /> Risk Score
                            </p>
                            <div className="flex items-center gap-3">
                                <span className="text-2xl font-bold text-gray-800">{riskScore}%</span>
                                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={cn('h-full rounded-full transition-all', scoreBarColor)} style={{ width: `${Math.min(100, riskScore)}%` }} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Sentiment ── */}
                    <div className="py-4 border-b">
                        <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" /> Sentiment
                            </p>
                            {!isEditingSentiment && onSentimentChange && (
                                <button
                                    type="button"
                                    onClick={() => setIsEditingSentiment(true)}
                                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5"
                                    title="Override sentiment"
                                >
                                    <Pencil className="h-3 w-3" /> Edit
                                </button>
                            )}
                        </div>
                        {!isEditingSentiment ? (
                            <Badge className={cn('text-sm px-3 py-1', sentimentConfig.color)}>
                                {sentimentConfig.icon} {sentimentConfig.label}
                            </Badge>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-1">
                                    {SENTIMENT_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            disabled={savingSentiment}
                                            onClick={async () => {
                                                if (opt.value === sentiment) {
                                                    setIsEditingSentiment(false);
                                                    return;
                                                }
                                                try {
                                                    setSavingSentiment(true);
                                                    await onSentimentChange(grievance, opt.value);
                                                    setIsEditingSentiment(false);
                                                } catch (e) {
                                                    // parent toasts; keep editor open
                                                } finally {
                                                    setSavingSentiment(false);
                                                }
                                            }}
                                            className={cn(
                                                'text-[11px] font-semibold px-2 py-1 rounded border transition-all',
                                                opt.value === sentiment ? 'ring-2 ring-offset-1 ring-indigo-400' : 'hover:opacity-80',
                                                opt.color,
                                                savingSentiment && 'opacity-50 cursor-not-allowed'
                                            )}
                                        >
                                            {opt.icon} {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsEditingSentiment(false)}
                                    disabled={savingSentiment}
                                    className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-0.5"
                                >
                                    {savingSentiment ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : <><X className="h-3 w-3" /> Cancel</>}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Category ── */}
                    <div className="py-4 border-b">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                            <Shield className="h-3 w-3" /> Moderation Category
                        </p>
                        {category ? (
                            <Badge variant="outline" className="text-indigo-700 border-indigo-200 bg-indigo-50 text-sm px-3 py-1">
                                {category}
                            </Badge>
                        ) : (
                            <span className="text-gray-400 italic text-sm">Uncategorized</span>
                        )}
                    </div>

                    {/* ── Grievance Topic ── */}
                    <div className="py-4 border-b">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                            <Tag className="h-3 w-3" /> Grievance Topic
                        </p>
                        {displayGrievanceType && displayGrievanceType !== 'Normal' && displayGrievanceType !== 'Not a Grievance' ? (
                            <div>
                                <Badge variant="outline" className="text-teal-700 border-teal-200 bg-teal-50 text-sm px-3 py-1">
                                    {displayGrievanceType}
                                </Badge>
                                {grievanceTopicReasoning && (
                                    <p className="text-sm text-gray-600 mt-2 leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
                                        {grievanceTopicReasoning}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <span className="text-gray-400 italic text-sm">{displayGrievanceType || 'Not classified'}</span>
                        )}
                    </div>

                    {/* ── LLM Reasoning ── */}
                    <div className="py-4 border-b">
                        <button
                            onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                            className="flex items-center justify-between w-full text-left"
                        >
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                <Brain className="h-3 w-3" /> LLM Reasoning
                            </p>
                            {isReasoningExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                        </button>
                        {isReasoningExpanded && (
                            <div className="mt-2 text-sm text-gray-700 leading-relaxed bg-indigo-50/50 rounded-lg p-3 border border-indigo-100">
                                {/* `explanation` is Stage 4's political_reasoning (see above)
                                    and must win over Pass A's llm_analysis.reasoning, which
                                    describes a different call's verdict. */}
                                {(explanation || llmAnalysis?.reasoning) ? (
                                    <div>{explanation || llmAnalysis?.reasoning}</div>
                                ) : (
                                    <ul className="list-disc pl-4 space-y-1">
                                        {safeReasons.length > 0 ? safeReasons.map((r, i) => (
                                            <li key={i}>{r}</li>
                                        )) : (
                                            <li className="text-gray-400 italic">No detailed reasoning available.</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Indian Laws Violated ── */}
                    <div className="py-4 border-b">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                            <Scale className="h-3 w-3" /> Indian Laws Violated
                        </p>
                        {legalSections.length > 0 ? (
                            <div className="space-y-2">
                                {legalSections.map((law, idx) => (
                                    <div key={idx} className="bg-red-50/50 rounded-lg p-2.5 border border-red-100">
                                        <span className="font-semibold text-sm text-red-800">{law.act || 'BNS 2023'} Section {law.section || law.code}</span>
                                        <p className="text-xs text-gray-600 mt-0.5">{law.description || law.title}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-400 italic text-sm">None detected</span>
                        )}
                    </div>

                    {/* ── Platform Policies Violated ── */}
                    <div className="py-4 border-b">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                            <FileWarning className="h-3 w-3" /> Platform Policies Violated
                        </p>
                        {violatedPolicies.length > 0 ? (
                            <div className="space-y-3">
                                {['x', 'youtube', 'meta'].map(platformGroup => {
                                    let policies = [];
                                    let platformName = '';

                                    if (platformGroup === 'x') {
                                        policies = violatedPolicies.filter(p => (p.platform || '').toLowerCase() === 'x');
                                        platformName = 'X (Twitter)';
                                    } else if (platformGroup === 'youtube') {
                                        policies = violatedPolicies.filter(p => (p.platform || '').toLowerCase() === 'youtube');
                                        platformName = 'YouTube';
                                    } else if (platformGroup === 'meta') {
                                        policies = violatedPolicies.filter(p => ['facebook', 'instagram'].includes((p.platform || '').toLowerCase()));
                                        platformName = 'Meta';
                                        const uniqueNames = new Set();
                                        policies = policies.filter(p => {
                                            const name = p.name || p.policy_name || p.policy_id || String(p);
                                            if (uniqueNames.has(name)) return false;
                                            uniqueNames.add(name);
                                            return true;
                                        });
                                    }

                                    if (policies.length === 0) return null;

                                    return (
                                        <div key={platformGroup}>
                                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{platformName}</div>
                                            <div className="space-y-1">
                                                {policies.map((p, idx) => (
                                                    <div key={idx} className="text-sm border-l-2 border-amber-300 pl-2 py-0.5 bg-amber-50/50 rounded-r">
                                                        {p.name || p.policy_name || p.policy_id || String(p)}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <span className="text-gray-400 italic text-sm">None detected</span>
                        )}
                    </div>

                    {/* ── Subject Content ── */}
                    <div className="py-4">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Subject Content</p>
                        <div className={cn('text-sm whitespace-pre-wrap text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100', !isContentExpanded && 'line-clamp-3')}>
                            {contentText || 'No content preview available'}
                        </div>
                        {((contentText).length > 100 || ((contentText).match(/\n/g) || []).length >= 2) && (
                            <button
                                onClick={() => setIsContentExpanded(!isContentExpanded)}
                                className="text-xs text-blue-600 font-medium mt-1.5 hover:underline flex items-center gap-1"
                            >
                                {isContentExpanded ? <><ChevronUp className="h-3 w-3" /> View Less</> : <><ChevronDown className="h-3 w-3" /> View More</>}
                            </button>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2 border-t pt-4">
                        {(grievance.tweet_url || grievance.url) && (
                            <Button asChild className="w-full">
                                <a href={grievance.tweet_url || grievance.url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Review Original Source
                                </a>
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default GrievanceAnalysisModal;
