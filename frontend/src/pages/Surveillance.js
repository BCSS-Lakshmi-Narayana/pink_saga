import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { 
  Rss, Youtube, Twitter, Instagram, Facebook, Globe, 
  ChevronRight, RefreshCw, Search, Eye, Play, Pause, 
  Activity, Wifi, WifiOff, Clock, ExternalLink, Target,
  TrendingUp, BarChart3, Users, Radio, Signal
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
import { formatDistanceToNow } from 'date-fns';

const Surveillance = () => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      const response = await api.get('/sources');
      // Filter only active sources
      setSources(response.data.filter(s => s.is_active));
    } catch (error) {
      toast.error('Failed to load surveillance data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filteredSources = useMemo(() => {
    return sources.filter(source => {
      const matchesSearch = source.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           source.identifier?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = platformFilter === 'all' || source.platform === platformFilter;
      return matchesSearch && matchesPlatform;
    });
  }, [sources, searchQuery, platformFilter]);

  const stats = useMemo(() => ({
    total: sources.length,
    youtube: sources.filter(s => s.platform === 'youtube').length,
    x: sources.filter(s => s.platform === 'x').length,
    instagram: sources.filter(s => s.platform === 'instagram').length,
    facebook: sources.filter(s => s.platform === 'facebook').length,
    highPriority: sources.filter(s => s.priority === 'high').length,
  }), [sources]);

  const getPlatformIcon = (platform, className = "h-4 w-4") => {
    switch (platform) {
      case 'youtube': return <Youtube className={`${className} text-red-500`} />;
      case 'x': return <Twitter className={className} />;
      case 'instagram': return <Instagram className={`${className} text-pink-500`} />;
      case 'facebook': return <Facebook className={`${className} text-blue-600`} />;
      default: return <Globe className={className} />;
    }
  };

  const getPlatformStyle = (platform) => {
    switch (platform) {
      case 'youtube': return 'bg-red-50 border-red-200';
      case 'x': return 'bg-gray-50 border-gray-200';
      case 'instagram': return 'bg-pink-50 border-pink-200';
      case 'facebook': return 'bg-blue-50 border-blue-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const getCategoryStyle = (category) => {
    switch (category) {
      case 'political': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'news': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'influencer': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'entertainment': return 'bg-pink-50 text-pink-700 border-pink-200';
      case 'technology': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getSourceLink = (source) => {
    switch (source.platform) {
      case 'youtube':
        return source.identifier.startsWith('@') 
          ? `https://youtube.com/${source.identifier}`
          : `https://youtube.com/channel/${source.identifier}`;
      case 'x':
        return `https://x.com/${source.identifier.replace('@', '')}`;
      case 'instagram':
        return `https://instagram.com/${source.identifier.replace('@', '')}`;
      case 'facebook':
        return `https://facebook.com/${source.identifier.replace('@', '')}`;
      default:
        return '#';
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[...Array(5)].map((_, i) => (
                <Card key={i} className="border border-border/50">
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-16 mb-2" />
                    <Skeleton className="h-8 w-10" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="border border-border/50">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <Skeleton className="h-12 w-12 rounded-xl" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-10 w-full" />
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
              <span className="text-foreground font-medium">Active Surveillance</span>
            </div>
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 rounded-xl">
                  <Radio className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Active Surveillance</h1>
                  <p className="text-muted-foreground">Real-time monitoring of active intelligence sources</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchSources(true)}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" asChild>
                  <Link to="/sources">Manage Sources</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Live Status Banner */}
          <Card className="mb-6 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Signal className="h-5 w-5 text-emerald-600" />
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-emerald-500 rounded-full animate-pulse" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-emerald-800">All Systems Operational</p>
                  <p className="text-sm text-emerald-600">{stats.total} sources actively monitored</p>
                </div>
                <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-300">
                  Live
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card className="border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Active</p>
                    <p className="text-2xl font-bold mt-1">{stats.total}</p>
                  </div>
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Activity className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">YouTube</p>
                    <p className="text-2xl font-bold mt-1">{stats.youtube}</p>
                  </div>
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Youtube className="h-5 w-5 text-red-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">X (Twitter)</p>
                    <p className="text-2xl font-bold mt-1">{stats.x}</p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Twitter className="h-5 w-5 text-gray-800" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-pink-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Instagram</p>
                    <p className="text-2xl font-bold mt-1">{stats.instagram}</p>
                  </div>
                  <div className="p-2 bg-pink-100 rounded-lg">
                    <Instagram className="h-5 w-5 text-pink-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">High Priority</p>
                    <p className="text-2xl font-bold mt-1">{stats.highPriority}</p>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Target className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card className="mb-6 border border-border/50">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search active sources..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={platformFilter} onValueChange={setPlatformFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All Platforms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="x">X (Twitter)</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Results Count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Monitoring <span className="font-medium text-foreground">{filteredSources.length}</span> active sources
            </p>
          </div>

          {/* Sources Grid */}
          {filteredSources.length === 0 ? (
            <Card className="border border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <WifiOff className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No Active Sources</h3>
                <p className="text-muted-foreground text-sm text-center max-w-sm mb-4">
                  {sources.length === 0 
                    ? 'No sources are currently being monitored.'
                    : 'No sources match your current filters.'}
                </p>
                <Button size="sm" asChild>
                  <Link to="/sources">Add Sources</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSources.map((source) => (
                <Card key={source.id} className="group border border-border/50 hover:border-border hover:shadow-md transition-all duration-200">
                  <div className="h-1 bg-emerald-500" />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${getPlatformStyle(source.platform)} border`}>
                          {getPlatformIcon(source.platform, "h-5 w-5")}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate" title={source.display_name}>
                            {source.display_name}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {source.identifier}
                          </p>
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a 
                            href={getSourceLink(source)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-muted rounded-lg transition-colors"
                          >
                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>View Profile</TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <Badge variant="outline" className={`${getCategoryStyle(source.category)} text-xs`}>
                        {source.category}
                      </Badge>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                        Active
                      </Badge>
                      {source.priority === 'high' && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                          High Priority
                        </Badge>
                      )}
                    </div>

                    {source.last_checked && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-lg">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Last scan {formatDistanceToNow(new Date(source.last_checked), { addSuffix: true })}</span>
                      </div>
                    )}
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

export default Surveillance;
