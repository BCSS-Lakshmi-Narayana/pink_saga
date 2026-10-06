import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
  AlertTriangle, Shield, Clock, ExternalLink, ChevronRight,
  Filter, Search, RefreshCw, TrendingUp, Zap, Target,
  CheckCircle, XCircle, Flag, Eye, MoreVertical, ArrowUpRight,
  AlertCircle, Activity, Bell, ChevronLeft
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '../components/ui/dropdown-menu';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';

const ActiveThreats = () => {
  const [threats, setThreats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [selectedThreat, setSelectedThreat] = useState(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchThreats();
  }, []);

  const fetchThreats = async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      const response = await api.get('/alerts', { params: { status_filter: 'active' } });
      setThreats(response.data.alerts || []);
    } catch (error) {
      toast.error('Failed to load active threats');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleUpdateStatus = async (threatId, status) => {
    try {
      await api.put(`/alerts/${threatId}`, { status, notes });
      toast.success(`Threat ${status === 'acknowledged' ? 'acknowledged' : status === 'escalated' ? 'escalated' : 'marked as false positive'}`);
      setActionDialogOpen(false);
      setNotes('');
      setSelectedThreat(null);
      fetchThreats();
    } catch (error) {
      toast.error('Failed to update threat status');
    }
  };

  const filteredThreats = useMemo(() => {
    return threats.filter(threat => {
      const matchesSearch = threat.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        threat.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        threat.author?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRisk = riskFilter === 'all' || (threat.risk_level || '').toUpperCase() === riskFilter.toUpperCase();
      const matchesPlatform = platformFilter === 'all' || threat.platform === platformFilter;
      return matchesSearch && matchesRisk && matchesPlatform;
    });
  }, [threats, searchQuery, riskFilter, platformFilter]);

  const stats = useMemo(() => ({
    total: threats.length,
    high: threats.filter(t => ['HIGH', 'CRITICAL'].includes((t.risk_level || '').toUpperCase())).length,
    medium: threats.filter(t => (t.risk_level || '').toUpperCase() === 'MEDIUM').length,
    low: threats.filter(t => (t.risk_level || '').toUpperCase() === 'LOW').length,
  }), [threats]);

  const platforms = useMemo(() => {
    return [...new Set(threats.map(t => t.platform).filter(Boolean))];
  }, [threats]);

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

  const getRiskIcon = (level) => {
    const risk = String(level || '').toUpperCase();
    switch (risk) {
      case 'CRITICAL':
      case 'HIGH': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'MEDIUM': return <AlertCircle className="h-4 w-4 text-amber-600" />;
      default: return <Shield className="h-4 w-4 text-emerald-600" />;
    }
  };

  const getRiskBgColor = (level) => {
    const risk = String(level || '').toUpperCase();
    switch (risk) {
      case 'CRITICAL':
      case 'HIGH': return 'bg-red-100';
      case 'MEDIUM': return 'bg-amber-100';
      default: return 'bg-emerald-100';
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
              <span className="text-foreground font-medium">Active Threats</span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 rounded-xl">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Active Threats</h1>
                  <p className="text-muted-foreground">Threats requiring immediate attention and action</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchThreats(true)}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" asChild>
                  <Link to="/alerts">View All Alerts</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Active</p>
                    <p className="text-2xl font-bold mt-1">{stats.total}</p>
                  </div>
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Zap className="h-5 w-5 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-600">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">High Risk</p>
                    <p className="text-2xl font-bold mt-1">{stats.high}</p>
                  </div>
                  <div className="p-2 bg-red-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Medium Risk</p>
                    <p className="text-2xl font-bold mt-1">{stats.medium}</p>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Low Risk</p>
                    <p className="text-2xl font-bold mt-1">{stats.low}</p>
                  </div>
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <Shield className="h-5 w-5 text-emerald-600" />
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
                    placeholder="Search threats..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={riskFilter} onValueChange={setRiskFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Risk Level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      <SelectItem value="HIGH">High Risk</SelectItem>
                      <SelectItem value="MEDIUM">Medium Risk</SelectItem>
                      <SelectItem value="LOW">Low Risk</SelectItem>
                    </SelectContent>
                  </Select>
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
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredThreats.length}</span> active threats
            </p>
          </div>

          {/* Threats List */}
          {filteredThreats.length === 0 ? (
            <Card className="border border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="rounded-full bg-emerald-100 p-4 mb-4">
                  <CheckCircle className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold mb-1">All Clear</h3>
                <p className="text-muted-foreground text-sm text-center max-w-sm">
                  {threats.length === 0
                    ? 'No active threats at the moment. Great job keeping things secure!'
                    : 'No threats match your current filters.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredThreats.map((threat) => (
                <Card key={threat.id} className="group border border-border/50 hover:border-border hover:shadow-md transition-all duration-200">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className={`shrink-0 p-3 rounded-xl ${getRiskBgColor(threat.risk_level)}`}>
                        {getRiskIcon(threat.risk_level)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="outline" className={getRiskStyle(threat.risk_level)}>
                            {threat.risk_level} RISK
                          </Badge>
                          {threat.platform && (
                            <Badge variant="secondary" className="text-xs uppercase">
                              {threat.platform}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {threat.created_at && formatDistanceToNow(new Date(threat.created_at), { addSuffix: true })}
                          </span>
                        </div>

                        <h3 className="font-semibold text-base mb-1 group-hover:text-primary transition-colors">
                          {threat.title}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {threat.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          {threat.author && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <span>Source:</span>
                              <span className="font-medium text-foreground">{threat.author}</span>
                            </div>
                          )}
                          {threat.content_url && (
                            <a
                              href={threat.content_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View Content
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              Take Action
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => { setSelectedThreat(threat); setActionDialogOpen(true); }}>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Acknowledge
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleUpdateStatus(threat.id, 'escalated')}>
                              <Flag className="h-4 w-4 mr-2" />
                              Escalate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleUpdateStatus(threat.id, 'false_positive')} className="text-muted-foreground">
                              <XCircle className="h-4 w-4 mr-2" />
                              False Positive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Action Dialog */}
        <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Acknowledge Threat</DialogTitle>
              <DialogDescription>
                Add notes about this threat before acknowledging it.
              </DialogDescription>
            </DialogHeader>
            {selectedThreat && (
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="font-medium text-sm">{selectedThreat.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{selectedThreat.description}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Notes (optional)</label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes about this threat..."
                    rows={3}
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setActionDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={() => handleUpdateStatus(selectedThreat.id, 'acknowledged')}>
                    Acknowledge Threat
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default ActiveThreats;
