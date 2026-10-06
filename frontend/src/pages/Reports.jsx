import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../lib/api';
import {
    FileText, Search, Download, Eye, ExternalLink, Calendar,
    User, Hash, RefreshCw, Filter, ChevronRight
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

const Reports = () => {
    const [searchParams] = useSearchParams();
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || searchParams.get('handle') || '');

    const fetchReports = async () => {
        setLoading(true);
        try {
            const response = await api.get('/reports');
            setReports(response.data);
        } catch (error) {
            console.error('Failed to fetch reports:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    const filteredReports = reports.filter(r =>
        r.serial_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.target_user_details?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.target_user_details?.handle?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black p-6 md:p-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                        <Link to="/dashboard" className="hover:text-blue-600 transition-colors">Dashboard</Link>
                        <ChevronRight className="h-4 w-4" />
                        <span className="text-gray-900 dark:text-gray-100 font-medium">Formal Reports</span>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                                <FileText className="h-8 w-8 text-blue-600" />
                                Reports Management
                            </h1>
                            <p className="text-gray-500 mt-1">Manage and export generated formal investigation notices</p>
                        </div>
                        <Button onClick={fetchReports} variant="outline" className="gap-2">
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>
                </div>

                <Card className="mb-6 border-none shadow-sm bg-white dark:bg-[#0f0f0f]">
                    <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Search by SN, User, or Handle..."
                                    className="pl-10 h-10"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <Button variant="outline" className="gap-2 shrink-0">
                                <Filter className="h-4 w-4" />
                                Filters
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {loading ? (
                    <div className="grid gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-24 w-full bg-gray-100 dark:bg-gray-800 animate-pulse rounded-xl" />
                        ))}
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#0f0f0f] rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
                        <FileText className="h-12 w-12 text-gray-300 mb-4" />
                        <p className="text-gray-500">No formal reports found.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                        <table className="w-full text-left border-collapse bg-white dark:bg-[#0f0f0f]">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 text-xs font-bold uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
                                    <th className="px-6 py-4">Serial Number</th>
                                    <th className="px-6 py-4">Target User</th>
                                    <th className="px-6 py-4">Platform</th>
                                    <th className="px-6 py-4">Generated At</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                                {filteredReports.map(report => (
                                    <tr key={report.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <Hash className="h-4 w-4 text-blue-500" />
                                                <span className="font-mono text-sm font-semibold">{report.serial_number}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                                    {report.target_user_details?.avatar_url ? (
                                                        <img src={report.target_user_details.avatar_url} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <User className="h-full w-full p-1.5 text-gray-400" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{report.target_user_details?.name}</span>
                                                    <span className="text-xs text-gray-500">@{report.target_user_details?.handle?.replace('@', '')}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge variant="secondary" className="uppercase text-[10px] font-bold">
                                                {report.platform}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                                <Calendar className="h-4 w-4" />
                                                {new Date(report.generated_at).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 uppercase text-[10px] font-extrabold">
                                                {report.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button variant="ghost" size="icon" asChild>
                                                    <Link to={`/reports/generate/${report.alert_id}`}>
                                                        <Eye className="h-4 w-4" />
                                                    </Link>
                                                </Button>
                                                <Button variant="outline" size="sm" className="gap-2" asChild>
                                                    <Link to={`/reports/generate/${report.alert_id}?print=true`}>
                                                        <Download className="h-4 w-4" />
                                                        PDF
                                                    </Link>
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Reports;
