import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ExternalLink, Shield, AlertTriangle, TrendingUp, Tag, MessageSquare, Scale, FileWarning, Brain, ChevronDown, ChevronUp, ShieldCheck, Pencil, X as XIcon, Loader2, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import ForensicResults from './ForensicResults';
// Shared resolver — the modal MUST derive sentiment/stance the same way the
// card does, or the two disagree on screen for the same record.
import { getAlertSentiment, getAlertStance, needsReview, getReasoning } from '../lib/sentiment';

// Backend-aligned bands (alertController RISK_LEVEL_SCORE_MAP). 'critical' is
// not in the Alert model enum so we limit to low/medium/high.
const RISK_LEVEL_OPTIONS = [
    { value: 'low', label: 'Low', score: 20, color: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'medium', label: 'Medium', score: 50, color: 'bg-amber-100 text-amber-700 border-amber-200' },
    { value: 'high', label: 'High', score: 75, color: 'bg-red-100 text-red-700 border-red-200' }
];

const SENTIMENT_OPTIONS = [
    { value: 'positive', label: 'Positive', icon: '👍', color: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'neutral', label: 'Neutral', icon: '➖', color: 'bg-slate-100 text-slate-700 border-slate-200' },
    { value: 'negative', label: 'Negative', icon: '👎', color: 'bg-red-100 text-red-700 border-red-200' }
];

/**
 * Reusable Reason Modal — renders the full analyzeContent() result for an alert.
 * Matches GrievanceAnalysisModal for UI consistency. Supports manual override of
 * risk level and sentiment, plus alert deletion.
 */
const ReasonModal = ({ open, onClose, alert, content, analysis, onRiskLevelChange, onSentimentChange, onDelete }) => {
    const [isContentExpanded, setIsContentExpanded] = useState(false);
    const [isReasoningExpanded, setIsReasoningExpanded] = useState(true);
    const [showForensics, setShowForensics] = useState(false);
    const [isEditingRisk, setIsEditingRisk] = useState(false);
    const [isEditingSentiment, setIsEditingSentiment] = useState(false);
    const [savingRisk, setSavingRisk] = useState(false);
    const [savingSentiment, setSavingSentiment] = useState(false);
    const [deleting, setDeleting] = useState(false);

    if (!open) return null;

    // ─── Unified extraction ───
    const llm = alert?.llm_analysis || analysis?.llm_analysis || content?.analysis?.llm_analysis || {};
    const fullAnalysis = analysis || content?.analysis || {};
    
    const rawRiskLevel = String(alert?.risk_level || fullAnalysis.risk_level || 'low').toLowerCase();

    /**
     * Resolved by the SAME helper the card badge uses, so the modal can no
     * longer show a different verdict from the card that opened it.
     *
     * The override control below offers positive/neutral/negative, so the
     * retired 'moderate' is mapped onto 'neutral' for display only — without
     * that, a 'moderate' record matched no option and the selected state never
     * highlighted.
     */
    const resolvedSentiment = getAlertSentiment(alert, content || { analysis: fullAnalysis });
    const sentiment = resolvedSentiment === 'moderate' ? 'neutral' : resolvedSentiment;
    const stance = getAlertStance(alert, content || { analysis: fullAnalysis });
    const isUnreviewed = needsReview(alert) || needsReview(fullAnalysis);

    /**
     * Prefer the pipeline's own risk_score over Pass A's `llm.score`.
     * `threat_details.risk_score` is what the override endpoint writes and what
     * the card displays; `llm.score` is Pass A's separate number and made the
     * modal disagree with the card on un-overridden records.
     */
    const riskScore = alert?.threat_details?.risk_score ?? fullAnalysis.risk_score ?? alert?.risk_score ?? llm.score ?? 0;
    const category = llm.category || alert?.threat_details?.intent || fullAnalysis.intent || alert?.primary_intent || '';
    
    const grievanceType = llm.grievance_type || fullAnalysis.llm_analysis?.grievance_type || fullAnalysis.grievance_type || '';
    const displayGrievanceType = (() => {
        const normalized = String(grievanceType || '').trim().toLowerCase();
        if (normalized === 'government praise' || normalized === 'govt praise' || normalized === 'general praise') {
            return 'General Complaint';
        }
        return grievanceType;
    })();
    const grievanceTopicReasoning = llm.grievance_reasoning || fullAnalysis.grievance_topic_reasoning || '';
    
    const violatedPolicies = (alert?.violated_policies?.length ? alert.violated_policies
        : (fullAnalysis.violated_policies || llm.platform_policies_violated || []));
    const legalSections = (alert?.legal_sections?.length ? alert.legal_sections
        : (fullAnalysis.legal_sections || llm.bns_sections_violated || []));
    
    /**
     * `political_reasoning` is STAGE 4's rationale — the one that actually
     * produced the sentiment and stance shown above. `llm.reasoning` and
     * `classification_explanation` come from Pass A, an earlier and separate
     * LLM call that does its own (unused) political read. Showing Pass A's text
     * here is what made the explanation contradict the badge beside it, e.g.
     * reasoning reading "tone is critical" next to a POSITIVE badge.
     */
    const explanation = getReasoning(alert) || getReasoning({ analysis: fullAnalysis })
        || alert?.classification_explanation || llm.reasoning
        || alert?.threat_details?.explanation || fullAnalysis.explanation || '';
    const reasons = Array.isArray(alert?.threat_details?.reasons) ? alert.threat_details.reasons : (fullAnalysis.reasons || []);

    // Show only matched keywords (keywords from the configured keywords list)
    // For alerts created after the matched_keywords field was added, use matched_keywords
    // For older alerts, they may not have this field yet (backfill in progress)
    const highlights = alert?.matched_keywords?.map(k => k.keyword || k) || [];

    const contentText = content?.text || alert?.description || 'No content preview available';

    // UI Config
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

    const scoreBarColor = riskScore >= 80 ? 'bg-red-500' : riskScore >= 50 ? 'bg-amber-500' : 'bg-green-500';

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold border-b pb-3 flex items-center gap-2">
                        <Brain className="h-5 w-5 text-indigo-600" />
                        Alert Analysis Details
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-4 space-y-0">
                    {/* ── Political stance + review flag ──
                        Stance is what the pipeline actually concluded about the
                        client; showing it beside the sentiment badge makes the
                        two legible together instead of leaving the operator to
                        infer one from the other. */}
                    {(stance || isUnreviewed) && (
                        <div className="flex items-center gap-2 pb-3 border-b flex-wrap">
                            {stance && !stance.inferred && (
                                <Badge className={cn('text-xs px-2.5 py-0.5 uppercase tracking-wide', stance.cls)}>
                                    <Shield className="h-3 w-3 mr-1" />{stance.label}
                                </Badge>
                            )}
                            {isUnreviewed && (
                                <Badge className="text-xs px-2.5 py-0.5 bg-amber-50 text-amber-800 border-amber-300">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Needs review — model confidence was low
                                </Badge>
                            )}
                        </div>
                    )}

                    {/* ── Risk Level + Score ── */}
                    <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Risk Level
                                </p>
                                {!isEditingRisk && onRiskLevelChange && (
                                    <button type="button" onClick={() => setIsEditingRisk(true)} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5" title="Override risk level">
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
                                        {RISK_LEVEL_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                disabled={savingRisk}
                                                onClick={async () => {
                                                    if (opt.value === rawRiskLevel) { setIsEditingRisk(false); return; }
                                                    try {
                                                        setSavingRisk(true);
                                                        await onRiskLevelChange(alert, opt.value);
                                                        setIsEditingRisk(false);
                                                    } catch (e) { /* parent toasts */ } finally { setSavingRisk(false); }
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
                                    <button type="button" onClick={() => setIsEditingRisk(false)} disabled={savingRisk} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-0.5">
                                        {savingRisk ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : <><XIcon className="h-3 w-3" /> Cancel</>}
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
                                <button type="button" onClick={() => setIsEditingSentiment(true)} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5" title="Override sentiment">
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
                                                if (opt.value === sentiment) { setIsEditingSentiment(false); return; }
                                                try {
                                                    setSavingSentiment(true);
                                                    await onSentimentChange(alert, opt.value);
                                                    setIsEditingSentiment(false);
                                                } catch (e) { /* parent toasts */ } finally { setSavingSentiment(false); }
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
                                <button type="button" onClick={() => setIsEditingSentiment(false)} disabled={savingSentiment} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-0.5">
                                    {savingSentiment ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : <><XIcon className="h-3 w-3" /> Cancel</>}
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

                    {/* ── Topic Classification ── */}
                    <div className="py-4 border-b">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                            <Tag className="h-3 w-3" /> Topic Classification
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
                                {explanation ? (
                                    <div>{explanation}</div>
                                ) : (
                                    <ul className="list-disc pl-4 space-y-1">
                                        {reasons.length > 0 ? reasons.map((r, i) => (
                                            <li key={i}>{r}</li>
                                        )) : (
                                            <li className="text-gray-400 italic">No detailed reasoning available.</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Flagged Keywords ── */}
                    {highlights.length > 0 && (
                        <div className="py-4 border-b">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-amber-500" /> Flagged Keywords
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {highlights.map((kw, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs bg-amber-50 border-amber-200 text-amber-800">
                                        {kw}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}

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
                            {contentText}
                        </div>
                        {contentText.length > 100 && (
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
                        {(fullAnalysis?.forensic_results || content?.analysis?.forensic_results) && (
                            <Button
                                variant="outline"
                                className="w-full border-blue-200 text-blue-700 hover:bg-blue-50 transition-all"
                                onClick={() => setShowForensics(!showForensics)}
                            >
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                {showForensics ? 'Hide Forensic Analysis' : 'View Deep Fake Analysis'}
                            </Button>
                        )}

                        {showForensics && (fullAnalysis?.forensic_results || content?.analysis?.forensic_results) && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300 mb-2">
                                <ForensicResults results={fullAnalysis?.forensic_results || content?.analysis?.forensic_results} />
                            </div>
                        )}

                        {alert?.content_url && (
                            <Button asChild className="w-full">
                                <a href={alert.content_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Review Original Source
                                </a>
                            </Button>
                        )}

                        {onDelete && (
                            <Button
                                variant="outline"
                                disabled={deleting}
                                onClick={async () => {
                                    if (!window.confirm('Delete this alert permanently? This cannot be undone.')) return;
                                    try {
                                        setDeleting(true);
                                        await onDelete(alert);
                                    } catch (e) { /* parent toasts */ } finally { setDeleting(false); }
                                }}
                                className="w-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 transition-all"
                            >
                                {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                                {deleting ? 'Deleting...' : 'Delete Alert'}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ReasonModal;
