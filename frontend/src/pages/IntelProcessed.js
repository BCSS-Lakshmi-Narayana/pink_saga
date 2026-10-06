import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { 
  Activity, ChevronRight, RefreshCw, Search, Filter,
  Clock, ExternalLink, Youtube, Twitter, Instagram, Facebook,
  Globe, Eye, TrendingUp, BarChart3, FileText, Database,
  CheckCircle, AlertTriangle, Sparkles, Zap, Brain, Target
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Progress } from '../components/ui/progress';
import { toast } from 'sonner';
import { formatDistanceToNow, format, subDays } from 'date-fns';

const IntelProcessed = () => {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [analysisFilter, setAnalysisFilter] = useState('all');
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      
      const [contentRes, overviewRes] = await Promise.all([
        api.get('/content', { params: { limit: 50 } }),
        api.get('/analytics/overview')
      ]);
      
      setContent(contentRes.data);
      setOverview(overviewRes.data);
    } catch (error) {
      toast.error('Failed to load intel data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filteredContent = useMemo(() => {
    return content.filter(item => {
      const matchesSearch = item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.author?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.content_text?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = platformFilter === 'all' || item.platform === platformFilter;
      const matchesAnalysis = analysisFilter === 'all' || 
                             (analysisFilter === 'analyzed' && item.analysis) ||
                             (analysisFilter === 'pending' && !item.analysis);
      return matchesSearch && matchesPlatform && matchesAnalysis;
    });
  }, [content, searchQuery, platformFilter, analysisFilter]);

  const stats = useMemo(() => ({
    total: content.length,
    analyzed: content.filter(c => c.analysis).length,
    pending: content.filter(c => !c.analysis).length,
    youtube: content.filter(c => c.platform === 'youtube').length,
    x: content.filter(c => c.platform === 'x').length,
    withAlerts: content.filter(c => ['HIGH', 'CRITICAL', 'MEDIUM'].includes((c.analysis?.risk_level || '').toUpperCase())).length,
  }), [content]);

  const platforms = useMemo(() => {
    return [...new Set(content.map(c => c.platform).filter(Boolean))];
  }, [content]);

  const getPlatformIcon = (platform, className = "h-4 w-4") => {
    switch (platform) {
      case 'youtube': return <Youtube className={`${className} text-red-500`} />;
      case 'x': return <Twitter className={className} />;
      case 'instagram': return <Instagram className={`${className} text-pink-500`} />;
      case 'facebook': return <Facebook className={`${className} text-blue-600`} />;
      default: return <Globe className={className} />;
    }
  };

  const getRiskStyle = (level) => {
    const risk = String(level || '').toUpperCase();
    switch (risk) {
      case 'CRITICAL':
      case 'HIGH': return 'bg-red-100 text-red-800 border-red-200';
      case 'MEDIUM': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'LOW': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSentimentStyle = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case 'negative': return 'bg-red-50 text-red-700 border-red-200';
      case 'positive': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  if (loading) {
    return (
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6 md:p-8">
          <div className="max-w-[1400px] mx-auto space-y-6">
            <div className="flex items-center gap-2 mb-6">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-48" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="border border-border/50">
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-20 mb-2" />
                    <Skeleton className="h-8 w-12" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Card key={i} className="border border-border/50">
                  <CardContent className="p-5">
                    <div className="flex gap-4">
                      <Skeleton className="h-12 w-12 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-6 md:p-8">
        <div className="max-w-[1400px] mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Link to="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground font-medium">Intel Processed</span>
            </div>
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-100 rounded-xl">
                  <Brain className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Intel Processed</h1>
                  <p className="text-muted-foreground">Content analyzed by AI for threat detection</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchData(true)}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" asChild>
                  <Link to="/content">View All Content</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Processed</p>
                    <p className="text-2xl font-bold mt-1">{overview?.total_content || stats.total}</p>
                  </div>
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <Database className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI Analyzed</p>
                    <p className="text-2xl font-bold mt-1">{stats.analyzed}</p>
                  </div>
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Sparkles className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending</p>
                    <p className="text-2xl font-bold mt-1">{stats.pending}</p>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Clock className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Flagged</p>
                    <p className="text-2xl font-bold mt-1">{stats.withAlerts}</p>
                  </div>
                  <div className="p-2 bg-red-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Processing Progress */}
          {stats.total > 0 && (
            <Card className="mb-6 border border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Analysis Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {Math.round((stats.analyzed / stats.total) * 100)}% complete
                  </span>
                </div>
                <Progress value={(stats.analyzed / stats.total) * 100} className="h-2" />
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <Card className="mb-6 border border-border/50">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search processed intel..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={platformFilter} onValueChange={setPlatformFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Platforms</SelectItem>
                      {platforms.map(p => (
                        <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={analysisFilter} onValueChange={setAnalysisFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Analysis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="analyzed">Analyzed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredContent.length}</span> processed items
            </p>
          </div>

          {/* Content List */}
          {filteredContent.length === 0 ? (
            <Card className="border border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No Content Found</h3>
                <p className="text-muted-foreground text-sm text-center max-w-sm">
                  {content.length === 0 
                    ? 'No content has been processed yet.'
                    : 'No content matches your current filters.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredContent.map((item) => (
                <Card key={item.id} className="group border border-border/50 hover:border-border hover:shadow-md transition-all duration-200">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className={`shrink-0 p-3 rounded-xl ${item.platform === 'youtube' ? 'bg-red-100' : item.platform === 'x' ? 'bg-gray-100' : 'bg-blue-100'}`}>
                        {getPlatformIcon(item.platform, "h-5 w-5")}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="secondary" className="text-xs uppercase">
                            {item.platform}
                          </Badge>
                          {item.analysis ? (
                            <Badge variant="outline" className={getRiskStyle(item.analysis.risk_level)}>
                              {item.analysis.risk_level || 'LOW'} RISK
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              Pending Analysis
                            </Badge>
                          )}
                          {item.analysis?.sentiment && (
                            <Badge variant="outline" className={getSentimentStyle(item.analysis.sentiment)}>
                              {item.analysis.sentiment}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                            <Clock className="h-3 w-3" />
                            {item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        
                        <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors line-clamp-1">
                          {item.title}
                        </h3>
                        
                        {item.content_text && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                            {item.content_text}
                          </p>
                        )}
                        
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          {item.author && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <span>Author:</span>
                              <span className="font-medium text-foreground">{item.author}</span>
                            </div>
                          )}
                          {item.content_url && (
                            <a 
                              href={item.content_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View Original
                            </a>
                          )}
                        </div>

                        {item.analysis?.summary && (
                          <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-2 mb-1">
                              <Sparkles className="h-3.5 w-3.5 text-primary" />
                              <span className="text-xs font-medium">AI Analysis</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {item.analysis.summary}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default IntelProcessed;
