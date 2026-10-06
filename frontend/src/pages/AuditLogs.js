import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "../components/ui/table";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { 
  Download, 
  FileText, 
  FileSpreadsheet, 
  Search, 
  X
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import api from '../lib/api';
import { useToast } from "../hooks/use-toast";

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const { toast } = useToast();

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async (overrides = {}) => {
    setLoading(true);
    try {
      const params = {};
      
      // Safely get date values
      const start = overrides.hasOwnProperty('start') ? overrides.start : dateRange.start;
      const end = overrides.hasOwnProperty('end') ? overrides.end : dateRange.end;

      if (start) {
        params.start_date = start;
      }
      if (end) {
        params.end_date = end;
      }
      
      const response = await api.get('/audit', { params });
      setLogs(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast({
        title: "Error",
        description: "Failed to fetch audit logs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (type, value) => {
    setDateRange(prev => ({ ...prev, [type]: value }));
  };

  const applyFilters = () => {
    fetchLogs();
  };

  const clearDateFilters = () => {
    setDateRange({ start: '', end: '' });
    fetchLogs({ start: '', end: '' });
  };

  const formatLogTimestamp = (timestamp) => {
    try {
      if (!timestamp) return { date: 'Invalid Date', time: '--:--' };
      
      const date = new Date(timestamp);
      if (!isValid(date)) return { date: 'Invalid Date', time: '--:--' };
      
      return {
        date: format(date, 'MMM d, yyyy'),
        time: format(date, 'HH:mm:ss')
      };
    } catch (e) {
      return { date: 'Invalid Date', time: '--:--' };
    }
  };

  const handleExport = (formatType) => {
    if (!filteredLogs.length) {
      toast({
        title: "No Data",
        description: "No logs to export",
        variant: "destructive",
      });
      return;
    }

    if (formatType === 'excel') {
      try {
        const worksheet = XLSX.utils.json_to_sheet(filteredLogs.map(log => ({
          Timestamp: format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss'),
          User: log.user_name || log.user_email || 'Unknown',
          Action: log.action,
          Resource: log.resource_type,
          Details: JSON.stringify(log.details || {})
        })));
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Logs");
        
        const dateStr = dateRange.start ? `_${dateRange.start}_to_${dateRange.end || 'now'}` : '';
        const now = new Date().toISOString().split('T')[0];
        
        XLSX.writeFile(workbook, `audit_logs${dateStr}_${now}.xlsx`);
        
        toast({
          title: "Export Complete",
          description: "Excel report has been generated.",
        });
      } catch (error) {
        console.error('Excel Export Error:', error);
        toast({
          title: "Export Failed",
          description: "Could not generate Excel report.",
          variant: "destructive",
        });
      }
      return;
    }

    if (formatType === 'pdf') {
      try {
        const doc = new jsPDF();

        // Colors
        const primaryColor = [15, 23, 42]; // Slate 900
        const accentColor = [234, 179, 8]; // Yellow 500

        // Header Background
        doc.setFillColor(...primaryColor);
        doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');

        // Header Text
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('SANKET', 20, 20);
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('SENTIMENT & GOODWILL ANALYSIS', 20, 30);

        doc.setFontSize(16);
        doc.setTextColor(...accentColor);
        doc.text('OFFICIAL AUDIT RECORD', doc.internal.pageSize.width - 20, 20, { align: 'right' });
        
        doc.setFontSize(10);
        doc.setTextColor(200, 200, 200);
        doc.text('CONFIDENTIAL - INTERNAL USE ONLY', doc.internal.pageSize.width - 20, 30, { align: 'right' });

        // Metadata Section
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.text(`Generated On: ${format(new Date(), 'PPpp')}`, 20, 50);
        doc.text(`Report Period: ${dateRange.start || 'Beginning'} to ${dateRange.end || 'Present'}`, 20, 55);
        doc.text(`Total Records: ${filteredLogs.length}`, 20, 60);

        // Table
        const tableColumn = ["Timestamp", "User", "Action", "Resource", "Details"];
        const tableRows = filteredLogs.map(log => [
          format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss'),
          log.user_name || log.user_email || 'Unknown',
          log.action.toUpperCase(),
          log.resource_type.toUpperCase(),
          JSON.stringify(log.details).substring(0, 50) + (JSON.stringify(log.details).length > 50 ? '...' : '')
        ]);

        autoTable(doc, {
          head: [tableColumn],
          body: tableRows,
          startY: 70,
          theme: 'grid',
          headStyles: {
            fillColor: primaryColor,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            lineWidth: 0.1,
            lineColor: accentColor
          },
          styles: {
            fontSize: 8,
            cellPadding: 3,
            lineColor: [200, 200, 200],
            lineWidth: 0.1
          },
          alternateRowStyles: {
            fillColor: [241, 245, 249] // Slate 100
          },
          columnStyles: {
            0: { cellWidth: 35 }, // Timestamp
            1: { cellWidth: 35 }, // User
            2: { cellWidth: 25 }, // Action
            3: { cellWidth: 25 }, // Resource
            4: { cellWidth: 'auto' } // Details
          },
          didDrawPage: function (data) {
            // Footer
            const pageSize = doc.internal.pageSize;
            const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
            
            doc.setFillColor(...primaryColor);
            doc.rect(0, pageHeight - 10, pageSize.width, 10, 'F');
            
            doc.setFontSize(8);
            doc.setTextColor(255, 255, 255);
            doc.text(`Page ${doc.internal.getNumberOfPages()}`, 20, pageHeight - 4);
            doc.text('SANKET SYSTEM', pageSize.width - 20, pageHeight - 4, { align: 'right' });
          }
        });

        doc.save(`audit_report_${new Date().toISOString().split('T')[0]}.pdf`);
        
        toast({
          title: "Export Complete",
          description: "PDF report has been generated.",
        });
      } catch (error) {
        console.error('PDF Export Error:', error);
        toast({
          title: "Export Failed",
          description: "Could not generate PDF report.",
          variant: "destructive",
        });
      }
      return;
    }

    try {
      const headers = ['Timestamp', 'User', 'Action', 'Resource', 'Details'];
      const csvContent = [
        headers.join(','),
        ...filteredLogs.map(log => [
          `"${log.timestamp || ''}"`,
          `"${log.user_name || log.user_email || 'Unknown'}"`,
          `"${log.action || ''}"`,
          `"${log.resource_type || ''}"`,
          `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`
        ].join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const dateStr = dateRange.start ? `_${dateRange.start}_to_${dateRange.end || 'now'}` : '';
      const now = new Date().toISOString().split('T')[0];
      link.setAttribute('href', url);
      link.setAttribute('download', `audit_logs${dateStr}_${now}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Export Complete",
        description: `${filteredLogs.length} logs exported successfully.`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export logs",
        variant: "destructive",
      });
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (!log) return false;
      
      const matchesSearch = 
        (log.user_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.user_email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.resource_type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (JSON.stringify(log.details || {}).toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesAction = actionFilter === 'all' || log.action === actionFilter;
      const matchesResource = resourceFilter === 'all' || log.resource_type === resourceFilter;

      return matchesSearch && matchesAction && matchesResource;
    });
  }, [logs, searchTerm, actionFilter, resourceFilter]);

  const getActionBadgeColor = (action) => {
    switch (action?.toLowerCase()) {
      case 'create': return 'bg-green-500';
      case 'update': return 'bg-blue-500';
      case 'delete': return 'bg-red-500';
      case 'login': return 'bg-purple-500';
      case 'manual_check': return 'bg-orange-500';
      default: return 'bg-gray-500';
    }
  };

  const uniqueUsers = useMemo(() => {
    return new Set(logs.filter(log => log?.user_id).map(log => log.user_id)).size;
  }, [logs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground">Track system activities and user actions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Activities</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
            <p className="text-xs text-muted-foreground">Recorded events</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Manual Checks</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {logs.filter(l => l?.action === 'manual_check').length}
            </div>
            <p className="text-xs text-muted-foreground">Initiated by admins</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Events</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {logs.filter(l => l?.action === 'login' || l?.action === 'failed_login').length}
            </div>
            <p className="text-xs text-muted-foreground">Logins & attempts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueUsers}</div>
            <p className="text-xs text-muted-foreground">Unique contributors</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-col md:flex-row flex-1 gap-4 w-full">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="login">Login</SelectItem>
                <SelectItem value="manual_check">Manual Check</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={resourceFilter} onValueChange={setResourceFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Resource" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Resources</SelectItem>
                <SelectItem value="source">Source</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="alert">Alert</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
              </SelectContent>
            </Select>
            
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => handleDateChange('start', e.target.value)}
                className="w-auto min-w-[120px]"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="w-auto min-w-[120px]"
              />
              <Button 
                variant="secondary" 
                onClick={applyFilters} 
                size="icon" 
                title="Apply Date Filter"
              >
                <Search className="h-4 w-4" />
              </Button>
              {(dateRange.start || dateRange.end) && (
                <Button 
                  variant="ghost" 
                  onClick={clearDateFilters}
                  size="icon"
                  title="Clear Dates"
                  className="h-9 w-9"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 self-start">
          <Button variant="outline" onClick={() => handleExport('csv')}>
            <FileText className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <Download className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>
            Detailed record of all system activities and administrative actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead className="min-w-[300px]">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 w-24 bg-gray-200 animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-4 w-32 bg-gray-200 animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-6 w-20 bg-gray-200 animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-gray-200 animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-4 w-48 bg-gray-200 animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No logs found matching your criteria
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log, index) => {
                  const formattedTime = formatLogTimestamp(log.timestamp);
                  
                  return (
                    <TableRow key={log._id || log.id || `log-${index}`}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-medium">{formattedTime.date}</span>
                          <span className="text-xs text-muted-foreground">{formattedTime.time}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {(log.user_name || log.user_email || 'U').charAt(0).toUpperCase()}
                          </div>
                          <span>{log.user_name || log.user_email || 'Unknown User'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          className={`${getActionBadgeColor(log.action)} text-white hover:${getActionBadgeColor(log.action)}`}
                        >
                          {(log.action || 'unknown').replace('_', ' ').toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{log.resource_type || 'unknown'}</TableCell>
                      <TableCell className="max-w-md">
                        <div className="truncate" title={JSON.stringify(log.details || {})}>
                          {JSON.stringify(log.details || {})}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditLogs;