import React, { useState, useEffect, useMemo } from 'react';
import {
    Shield, AlertTriangle, AlertOctagon, AlertCircle, Activity,
    MessageSquare, TrendingUp, TrendingDown, User, Calendar,
    ExternalLink, BrainCircuit, Eye, ThumbsUp, MessageCircle,
    RefreshCw
} from 'lucide-react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import api from '../lib/api';
import { toast } from 'sonner';

export const RiskBadge = ({ level, score, showScore = true, keywords = [], explanation }) => {
    const colors = {
        low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        medium: 'bg-amber-50 text-amber-700 border-amber-200',
        high: 'bg-orange-50 text-orange-700 border-orange-200',
        critical: 'bg-red-50 text-red-700 border-red-200'
    };

    const icons = {
        low: Shield,
        medium: AlertTriangle,
        high: AlertOctagon,
        critical: AlertCircle
    };

    const Icon = icons[level] || Shield;

    const badge = (
        <Badge
            variant="outline"
            className={cn(
                colors[level] || colors.low,
                "font-semibold px-2.5 py-0.5 flex items-center gap-1.5 whitespace-nowrap shadow-sm cursor-help"
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            <span>{level?.toUpperCase()}</span>
            {showScore && (
                <>
                    <span className="opacity-30">|</span>
                    <span>{score}</span>
                </>
            )}
        </Badge>
    );

    if ((keywords && keywords.length > 0) || explanation) {
        return (
            <TooltipProvider delayDuration={100}>
                <Tooltip>
                    <TooltipTrigger asChild>{badge}</TooltipTrigger>
                    <TooltipContent className="max-w-xs p-3">
                        <div className="space-y-2">
                            <p className="font-semibold text-xs">Risk Analysis</p>
                            {keywords && keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {keywords.map(k => (
                                        <span key={k} className="text-[10px] bg-white/10 px-1 py-0.5 rounded border border-white/20">
                                            {k}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {explanation && <p className="text-xs text-muted-foreground">{explanation}</p>}
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    return badge;
};

const RiskBreakdown = ({ score, threatComments, keywords = [], explanation, evidence = [] }) => {
    return (
        <div className="space-y-5">
            {/* Score Header */}
            <div className="flex items-center justify-between text-sm border-b pb-3">
                <span className="text-muted-foreground font-medium">Risk Confidence Score</span>
                <span className={cn("font-mono font-bold text-lg",
                    score >= 70 ? "text-red-600" : score >= 40 ? "text-orange-600" : "text-emerald-600"
                )}>{score}/100</span>
            </div>

            {/* Visual Bar */}
            <div className="space-y-1.5">
                <div className="h-2.5 w-full bg-secondary/20 rounded-full overflow-hidden">
                    <div
                        className={cn("h-full transition-all duration-1000 ease-out",
                            score >= 70 ? 'bg-gradient-to-r from-orange-500 to-red-600' :
                                score >= 40 ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-emerald-500'
                        )}
                        style={{ width: `${Math.min(score, 100)}%` }}
                    />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    <span>Safe</span>
                    <span>Warning</span>
                    <span>Critical</span>
                </div>
            </div>

            {/* Evidence List */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wide">
                    <Activity className="h-3.5 w-3.5" />
                    Detected Risk Signals
                </div>

                {threatComments > 0 && (
                    <div className="group flex items-start gap-3 p-3 bg-red-50/50 border border-red-100/50 rounded-lg hover:bg-red-50 transition-colors">
                        <MessageSquare className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-red-900">User Threat Detected</p>
                            <p className="text-xs text-red-700 mt-0.5">
                                {threatComments} comment{threatComments > 1 ? 's' : ''} contain explicit threatening language.
                            </p>
                        </div>
                    </div>
                )}

                {evidence && evidence.length > 0 ? (
                    <div className="space-y-2">
                        {evidence.slice(0, 5).map((item, i) => (
                            <div key={i} className="group p-3 rounded-lg border bg-card hover:shadow-sm transition-all text-sm">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0",
                                        item.category === 'violence' ? "border-red-200 text-red-700 bg-red-50" :
                                            item.category === 'threat' ? "border-orange-200 text-orange-700 bg-orange-50" :
                                                "border-amber-200 text-amber-700 bg-amber-50"
                                    )}>
                                        {item.category?.toUpperCase() || 'RISK'}
                                    </Badge>
                                    <span className="font-mono text-xs font-semibold text-foreground">{item.keyword}</span>
                                </div>
                                <p className="text-muted-foreground text-xs leading-relaxed font-mono bg-muted/30 p-2 rounded block">
                                    "{item.context}"
                                </p>
                            </div>
                        ))}
                        {evidence.length > 5 && (
                            <p className="text-xs text-center text-muted-foreground italic">
                                +{evidence.length - 5} more signals hidden
                            </p>
                        )}
                    </div>
                ) : (
                    keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 align-top">
                            {keywords.map((kw, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                    {kw}
                                </Badge>
                            ))}
                        </div>
                    )
                )}

                {explanation && (
                    <div className="mt-4 p-3 bg-blue-50/50 border border-blue-100 text-blue-900 rounded-lg text-xs leading-relaxed">
                        <span className="font-semibold block mb-1 text-blue-700 flex items-center gap-1.5">
                            <Shield className="h-3 w-3" /> System Analysis
                        </span>
                        {explanation}
                    </div>
                )}
            </div>
        </div>
    );
};

const EngagementCard = ({ icon: Icon, value, label, subtext, trend, riskLevel }) => {
    return (
        <Card className="hover:shadow-md transition-all duration-200 border-border bg-card">
            <CardContent className="p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{label}</p>
                        <h3 className="text-2xl font-bold mt-2 tracking-tight">
                            {value?.toLocaleString() || '0'}
                        </h3>
                    </div>
                    <div className={cn("p-2 rounded-lg",
                        riskLevel === 'critical' ? "bg-red-100 text-red-700" :
                            riskLevel === 'high' ? "bg-orange-100 text-orange-700" :
                                "bg-primary/10 text-primary"
                    )}>
                        <Icon className="h-5 w-5" />
                    </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                    {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
                    {trend !== undefined && (
                        <div className={cn("flex items-center text-xs font-medium px-2 py-0.5 rounded-full",
                            trend > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        )}>
                            {trend > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                            {Math.abs(trend)}%
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export const VideoModal = ({ video, onClose }) => {
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showThreatsOnly, setShowThreatsOnly] = useState(false);

    useEffect(() => {
        if (video) {
            fetchComments();
        }
    }, [video]);

    const fetchComments = async () => {
        try {
            const res = await api.get(`/youtube/videos/${video.content_id}/comments`);
            setComments(res.data);
        } catch (e) {
            console.error(e);
            toast.error('Failed to load comments');
        } finally {
            setLoading(false);
        }
    };

    const filteredComments = useMemo(() => {
        return showThreatsOnly
            ? comments.filter(c => c.is_threat)
            : comments;
    }, [comments, showThreatsOnly]);

    if (!video) return null;

    const videoTitle = video.text?.split('\n')[0] || 'Untitled Video';
    const videoDescription = video.text?.split('\n').slice(1).join(' ') || 'No description available';

    return (
        <div className="h-[80vh] flex flex-col">
            {/* Header / Title Area */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold line-clamp-1">{videoTitle}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <User className="h-4 w-4" />
                            <span className="font-medium text-foreground">{video.author}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(video.published_at).toLocaleDateString()}</span>
                        </div>
                        <RiskBadge level={video.risk_level} score={video.risk_score} />
                    </div>
                </div>
                <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open(`https://www.youtube.com/watch?v=${video.content_id}`, '_blank')}
                >
                    <ExternalLink className="h-4 w-4" />
                    Open in YouTube
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
                {/* LEFT COLUMN: Player & Context (7 cols) */}
                <div className="lg:col-span-7 flex flex-col gap-6 overflow-y-auto pr-2">
                    <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden bg-black border shadow-sm">
                        <iframe
                            className="absolute top-0 left-0 w-full h-full"
                            src={`https://www.youtube.com/embed/${video.content_id}`}
                            title={videoTitle}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">Description</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                {videoDescription}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT COLUMN: Analysis & Data (5 cols) */}
                <div className="lg:col-span-5 flex flex-col min-h-0">
                    <Tabs defaultValue="analysis" className="h-full flex flex-col">
                        <TabsList className="w-full justify-start border-b rounded-none px-0 h-auto p-0 bg-transparent gap-6">
                            <TabsTrigger
                                value="analysis"
                                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2"
                            >
                                Risk Analysis
                            </TabsTrigger>
                            <TabsTrigger
                                value="comments"
                                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2"
                            >
                                Comments ({comments.length})
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto pt-6">
                            <TabsContent value="analysis" className="mt-0 space-y-6">
                                {/* Gemini Analysis Summary Block */}
                                {(video.analysis_data?.topic || video.analysis_data?.summary) && (
                                    <Card className="bg-gradient-to-br from-purple-50 to-white dark:from-slate-900 dark:to-slate-950 border-purple-100 dark:border-purple-900/50">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium flex items-center gap-2 text-purple-900 dark:text-purple-300">
                                                <BrainCircuit className="h-4 w-4" />
                                                AI Intelligence Brief
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {video.analysis_data?.topic && (
                                                <div className="flex gap-2 text-sm">
                                                    <span className="font-semibold min-w-16 text-muted-foreground">Topic:</span>
                                                    <span className="font-medium">{video.analysis_data.topic}</span>
                                                </div>
                                            )}
                                            {video.analysis_data?.summary && (
                                                <div className="flex gap-2 text-sm">
                                                    <span className="font-semibold min-w-16 text-muted-foreground">Summary:</span>
                                                    <span className="text-muted-foreground leading-relaxed">{video.analysis_data.summary}</span>
                                                </div>
                                            )}
                                            {video.analysis_data?.flagged_lines?.length > 0 && (
                                                <div className="pt-2">
                                                    <span className="font-semibold text-sm text-red-600 block mb-2">Flagged Content:</span>
                                                    <div className="space-y-2">
                                                        {video.analysis_data.flagged_lines.map((fl, idx) => (
                                                            <div key={idx} className="bg-red-50 border border-red-100 p-2 rounded text-xs">
                                                                <span className="font-mono font-bold text-red-800 mr-2">Line {fl.line}:</span>
                                                                <span className="text-gray-700 italic">"{fl.text}"</span>
                                                                <div className="mt-1 flex gap-2">
                                                                    <Badge variant="outline" className="text-[10px] border-red-200 text-red-700 bg-white">{fl.category}</Badge>
                                                                    <Badge variant="outline" className="text-[10px] border-orange-200 text-orange-700 bg-white">{fl.severity}</Badge>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Risk Breakdown Card */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                                            <Activity className="h-4 w-4 text-primary" />
                                            Risk Assessment
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <RiskBreakdown
                                            score={video.risk_score}
                                            threatComments={video.threat_comments_count || 0}
                                            sentiment="negative"
                                            keywords={video.analysis_data?.triggered_keywords}
                                            explanation={video.analysis_data?.explanation}
                                            evidence={video.analysis_data?.evidence}
                                        />
                                    </CardContent>
                                </Card>

                                {/* Metrics Grid */}
                                <div className="grid grid-cols-2 gap-4">
                                    <EngagementCard
                                        icon={Eye}
                                        label="Views"
                                        value={video.engagement?.views}
                                        subtext="Total Impressions"
                                    />
                                    <EngagementCard
                                        icon={ThumbsUp}
                                        label="Likes"
                                        value={video.engagement?.likes}
                                        subtext="Positive Sentiment"
                                    />
                                    <EngagementCard
                                        icon={MessageCircle}
                                        label="Comments"
                                        value={video.engagement?.comments}
                                        riskLevel={video.threat_comments_count > 0 ? "high" : "low"}
                                    />
                                    <EngagementCard
                                        icon={Activity}
                                        label="Eng. Score"
                                        value={Math.round(video.engagement_score || 0) + '%'}
                                        trend={video.engagement_score > 50 ? 12 : -5}
                                    /* Simulated Trend for demo */
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="comments" className="mt-0 h-full flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="threats-only"
                                            checked={showThreatsOnly}
                                            onCheckedChange={setShowThreatsOnly}
                                        />
                                        <Label htmlFor="threats-only" className="text-sm">
                                            Show threats only
                                        </Label>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={fetchComments}
                                        disabled={loading}
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                        Refresh
                                    </Button>
                                </div>

                                <ScrollArea className="flex-1 pr-4 -mr-4">
                                    {loading ? (
                                        <div className="flex flex-col items-center justify-center py-12">
                                            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                                            <p className="text-muted-foreground">Loading comments...</p>
                                        </div>
                                    ) : filteredComments.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-center">
                                            <MessageSquare className="h-10 w-10 text-muted-foreground mb-3 opacity-20" />
                                            <p className="text-muted-foreground font-medium">No comments found</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {filteredComments.map((comment) => (
                                                <div
                                                    key={comment.id}
                                                    className={cn(
                                                        "p-4 rounded-lg border bg-card transition-colors",
                                                        comment.is_threat ? "border-red-200 bg-red-50/50" : "hover:bg-muted/50"
                                                    )}
                                                >
                                                    <div className="flex gap-3">
                                                        <Avatar className="h-8 w-8 border">
                                                            <AvatarImage src={comment.author_profile_image} />
                                                            <AvatarFallback>
                                                                {comment.author_display_name?.[0] || '?'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex-1 space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-sm">
                                                                        {comment.author_display_name}
                                                                    </span>
                                                                    {comment.is_threat && (
                                                                        <Badge variant="destructive" className="h-5 px-1.5 text-[10px] uppercase">
                                                                            Threat
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {new Date(comment.published_at).toLocaleDateString()}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm leading-relaxed text-foreground/90">
                                                                {comment.text}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>
        </div>
    );
};
