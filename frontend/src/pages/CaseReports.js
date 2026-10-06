import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
  Shield, ChevronRight, RefreshCw, Search, Filter,
  Clock, ExternalLink, AlertTriangle, CheckCircle, Flag,
  XCircle, FileText, BarChart3, TrendingUp, Calendar,
  Eye, MoreVertical, Download, Archive, PieChart
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '../components/ui/dropdown-menu';
import { toast } from 'sonner';
import { formatDistanceToNow, format, subDays, startOfMonth, endOfMonth } from 'date-fns';

const CaseReports = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      const response = await api.get('/alerts');
      setReports(response.data.alerts || []);
    } catch (error) {
      toast.error('Failed to load case reports');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      const matchesSearch = report.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.author?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || report.status === statusFilter;
      const matchesRisk = riskFilter === 'all' || (report.risk_level || '').toUpperCase() === riskFilter.toUpperCase();
      const matchesTab = activeTab === 'all' || report.status === activeTab;
      return matchesSearch && matchesStatus && matchesRisk && matchesTab;
    });
  }, [reports, searchQuery, statusFilter, riskFilter, activeTab]);

  const stats = useMemo(() => ({
    total: reports.length,
    active: reports.filter(r => r.status === 'active').length,
    acknowledged: reports.filter(r => r.status === 'acknowledged').length,
    escalated: reports.filter(r => r.status === 'escalated').length,
    falsePositive: reports.filter(r => r.status === 'false_positive').length,
    highRisk: reports.filter(r => ['HIGH', 'CRITICAL'].includes((r.risk_level || '').toUpperCase())).length,
    mediumRisk: reports.filter(r => (r.risk_level || '').toUpperCase() === 'MEDIUM').length,
    thisMonth: reports.filter(r => {
      const date = new Date(r.created_at);
      const now = new Date();
      return date >= startOfMonth(now) && date <= endOfMonth(now);
    }).length,
  }), [reports]);

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

  const getStatusStyle = (status) => {
    switch (status) {
      case 'active': return 'bg-red-100 text-red-800 border-red-200';
      case 'acknowledged': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'escalated': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'false_positive': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'acknowledged': return <CheckCircle className="h-4 w-4 text-blue-600" />;
      case 'escalated': return <Flag className="h-4 w-4 text-purple-600" />;
      case 'false_positive': return <XCircle className="h-4 w-4 text-gray-600" />;
      default: return <Shield className="h-4 w-4 text-gray-600" />;
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
              <span className="text-foreground font-medium">Case Reports</span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 rounded-xl">
                  <FileText className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Case Reports</h1>
                  <p className="text-muted-foreground">Complete documentation of all threat alerts and cases</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchReports(true)}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <FileText className="h-4 w-4 mr-2" />
                      Export as CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <FileText className="h-4 w-4 mr-2" />
                      Export as PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" asChild>
                  <Link to="/alerts">Alert Center</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Reports</p>
                    <p className="text-2xl font-bold mt-1">{stats.total}</p>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Archive className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Cases</p>
                    <p className="text-2xl font-bold mt-1">{stats.active}</p>
                  </div>
                  <div className="p-2 bg-red-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-purple-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Escalated</p>
                    <p className="text-2xl font-bold mt-1">{stats.escalated}</p>
                  </div>
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Flag className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Month</p>
                    <p className="text-2xl font-bold mt-1">{stats.thisMonth}</p>
                  </div>
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Calendar className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status Distribution */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            <button
              onClick={() => setActiveTab('all')}
              className={`p-3 rounded-lg border transition-all ${activeTab === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
            >
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs">All Cases</p>
            </button>
            <button
              onClick={() => setActiveTab('active')}
              className={`p-3 rounded-lg border transition-all ${activeTab === 'active' ? 'bg-red-500 text-white border-red-500' : 'bg-card border-border hover:bg-muted'}`}
            >
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs">Active</p>
            </button>
            <button
              onClick={() => setActiveTab('acknowledged')}
              className={`p-3 rounded-lg border transition-all ${activeTab === 'acknowledged' ? 'bg-blue-500 text-white border-blue-500' : 'bg-card border-border hover:bg-muted'}`}
            >
              <p className="text-2xl font-bold">{stats.acknowledged}</p>
              <p className="text-xs">Acknowledged</p>
            </button>
            <button
              onClick={() => setActiveTab('escalated')}
              className={`p-3 rounded-lg border transition-all ${activeTab === 'escalated' ? 'bg-purple-500 text-white border-purple-500' : 'bg-card border-border hover:bg-muted'}`}
            >
              <p className="text-2xl font-bold">{stats.escalated}</p>
              <p className="text-xs">Escalated</p>
            </button>
          </div>

          {/* Filters */}
          <Card className="mb-6 border border-border/50">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search case reports..."
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
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredReports.length}</span> case reports
            </p>
          </div>

          {/* Reports List */}
          {filteredReports.length === 0 ? (
            <Card className="border border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No Case Reports</h3>
                <p className="text-muted-foreground text-sm text-center max-w-sm">
                  {reports.length === 0
                    ? 'No case reports have been documented yet.'
                    : 'No reports match your current filters.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredReports.map((report) => (
                <Card key={report.id} className="group border border-border/50 hover:border-border hover:shadow-md transition-all duration-200">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className={`shrink-0 p-3 rounded-xl ${report.status === 'active' ? 'bg-red-100' :
                          report.status === 'escalated' ? 'bg-purple-100' :
                            report.status === 'acknowledged' ? 'bg-blue-100' : 'bg-gray-100'
                        }`}>
                        {getStatusIcon(report.status)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="outline" className={getStatusStyle(report.status)}>
                            {report.status?.replace('_', ' ')}
                          </Badge>
                          <Badge variant="outline" className={getRiskStyle(report.risk_level)}>
                            {report.risk_level} RISK
                          </Badge>
                          {report.platform && (
                            <Badge variant="secondary" className="text-xs uppercase">
                              {report.platform}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                            <Clock className="h-3 w-3" />
                            {report.created_at && format(new Date(report.created_at), 'MMM d, yyyy')}
                          </span>
                        </div>

                        <h3 className="font-semibold text-base mb-1 group-hover:text-primary transition-colors">
                          {report.title}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {report.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          {report.author && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <span>Source:</span>
                              <span className="font-medium text-foreground">{report.author}</span>
                            </div>
                          )}
                          {report.content_url && (
                            <a
                              href={report.content_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View Content
                            </a>
                          )}
                        </div>

                        {report.notes && (
                          <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs font-medium mb-1">Notes</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {report.notes}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                              <Link to={`/alerts`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Details</TooltipContent>
                        </Tooltip>
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

export default CaseReports;
