import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Edit2, Trash2, ChevronLeft, Loader2, Save, X, Check,
    Calendar, FileText,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const psJurisdictions = [
    'Central PS', 'East PS', 'West PS', 'North PS', 'South PS',
    'Traffic PS', 'Cyber PS', 'Women PS', 'Special Branch',
    'Airport PS', 'Railway PS', 'Highway PS'
];

const formatDateAPI = (date) => {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
};

const formatDateTimeDisplay = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    const date = d.toLocaleDateString('en-GB').replace(/\//g, '-');
    const time = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    return `${date}, ${time}`;
};

const isVideoUrl = (url) => {
    if (!url) return false;
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?.*)?$/i.test(url);
};

const generateId = () => `inc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const Dial100IncidentReporting = () => {
    const [incidents, setIncidents] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [editingData, setEditingData] = useState({});
    const [editingMeta, setEditingMeta] = useState({ isNew: false });
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [mediaUploading, setMediaUploading] = useState({});
    const [dateRange, setDateRange] = useState({
        start: formatDateAPI(new Date()),
        end: formatDateAPI(new Date())
    });
    const [isRangeOpen, setIsRangeOpen] = useState(false);
    const [mediaPreview, setMediaPreview] = useState({ open: false, url: '', type: 'image' });
    
    // Auto-save logic
    const performAutoSave = useCallback(async (incidentsToSave) => {
        if (incidentsToSave.length === 0) return;
        try {
            await saveIncidentsByRange(incidentsToSave);
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('Auto-save error:', error);
        }
    }, [dateRange]);

    useEffect(() => {
        if (hasUnsavedChanges && !isLoading && incidents.length > 0) {
            const timer = setTimeout(() => performAutoSave(incidents), 3000);
            return () => clearTimeout(timer);
        }
    }, [incidents, hasUnsavedChanges, isLoading, performAutoSave]);

    // Data Loading
    const loadIncidents = async (range) => {
        setIsLoading(true);
        try {
            const response = await api.get('/dial100-incidents', {
                params: { startDate: range.start, endDate: range.end }
            });
            setIncidents(response.data?.incidents || []);
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('Error loading incidents:', error);
            setIncidents([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadIncidents(dateRange);
    }, [dateRange]);

    // Handlers
    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveIncidentsByRange(incidents);
            setHasUnsavedChanges(false);
            toast.success('Successfully saved changes');
        } catch (error) {
            toast.error('Failed to save');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddRow = () => {
        const maxSlNo = incidents.length > 0 ? Math.max(...incidents.map(i => i.slNo)) : 0;
        const newIncident = {
            id: generateId(),
            category: 'category1', // Default internal category
            slNo: maxSlNo + 1,
            incidentDetails: '',
            incidentCategory: '',
            location: '',
            dateTime: (() => {
                const now = new Date();
                const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
                return localNow.toISOString().slice(0, 16);
            })(),
            psJurisdiction: '',
            zoneJurisdiction: '',
            remarks: '',
            mediaFiles: [],
            priority: 'Normal',
        };
        
        setIncidents(prev => [...prev, newIncident]);
        setEditingId(newIncident.id);
        setEditingData(newIncident);
        setEditingMeta({ isNew: true });
        setIsEditOpen(true);
        
        setTimeout(() => {
            const row = document.getElementById(`row-${newIncident.id}`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    };

    const handleDelete = (id) => {
        setIncidents(prev => prev.filter(i => i.id !== id));
        setHasUnsavedChanges(true);
    };

    const handleEdit = (incident) => {
        setEditingId(incident.id);
        setEditingData({ ...incident });
        setEditingMeta({ isNew: false });
        setIsEditOpen(true);
    };

    const handleSaveEdit = () => {
        setIncidents(prev => prev.map(i => i.id === editingId ? editingData : i));
        setEditingId(null);
        setEditingData({});
        setEditingMeta({ isNew: false });
        setIsEditOpen(false);
        setHasUnsavedChanges(true);
    };

    const handleCancelEdit = () => {
        if (editingMeta.isNew && editingId) {
            setIncidents(prev => prev.filter(i => i.id !== editingId));
        }
        setEditingId(null);
        setEditingData({});
        setEditingMeta({ isNew: false });
        setIsEditOpen(false);
    };

    const handleExportExcel = () => {
        if (!incidents.length) return toast.error('No data to export');
        
        const headers = ['Sl No', 'Incident Details', 'Category', 'Location', 'Date & Time', 'PS Jurisdiction', 'Zone', 'Remarks', 'Media Count'];
        const rows = incidents.map(inc => [
            inc.slNo,
            `"${(inc.incidentDetails || '').replace(/"/g, '""')}"`,
            `"${(inc.incidentCategory || '').replace(/"/g, '""')}"`,
            `"${(inc.location || '').replace(/"/g, '""')}"`,
            inc.dateTime ? formatDateTimeDisplay(inc.dateTime) : '',
            inc.psJurisdiction || '',
            inc.zoneJurisdiction || '',
            `"${(inc.remarks || '').replace(/"/g, '""')}"`,
            (inc.mediaFiles || []).length
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Dial100_Incidents_${dateRange.start}_to_${dateRange.end}.csv`;
        a.click();
    };

    const uploadMediaFiles = async (files) => {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
        const res = await api.post('/uploads/s3', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return res.data?.uploads || [];
    };

    const handleMediaUpload = async (files) => {
        if (!files.length || !editingId) return;
        setMediaUploading(prev => ({ ...prev, [editingId]: true }));
        try {
            const uploads = await uploadMediaFiles(files);
            setEditingData(prev => ({
                ...prev,
                mediaFiles: [...(prev.mediaFiles || []), ...uploads]
            }));
            toast.success(`Uploaded ${uploads.length} files`);
        } catch (e) {
            toast.error('Upload failed');
        } finally {
            setMediaUploading(prev => ({ ...prev, [editingId]: false }));
        }
    };

    // Render helpers
    const getMediaUrl = (file) => (typeof file === 'string' ? file : file.url || file.secure_url || '');

    const openMediaPreview = (url) => {
        if (!url) return;
        setMediaPreview({ open: true, url, type: isVideoUrl(url) ? 'video' : 'image' });
    };

    const formatDateDisplay = (value) => {
        if (!value) return '--';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleDateString('en-GB').replace(/\//g, '-');
    };

    const rangeLabel = `${formatDateDisplay(dateRange.start)} to ${formatDateDisplay(dateRange.end)}`;

    const normalizeRange = (next) => {
        if (!next.start || !next.end) return next;
        if (new Date(next.end) < new Date(next.start)) {
            return { ...next, end: next.start };
        }
        return next;
    };

    const getIncidentDayKey = (incident) => {
        if (incident?.dateTime) return formatDateAPI(new Date(incident.dateTime));
        if (incident?.date) return formatDateAPI(new Date(incident.date));
        return dateRange.start;
    };

    const saveIncidentsByRange = async (items) => {
        if (!items.length) return;
        const grouped = items.reduce((acc, item) => {
            const key = getIncidentDayKey(item);
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
        }, {});

        const entries = Object.entries(grouped);
        for (const [date, list] of entries) {
            await api.post('/dial100-incidents/bulk', {
                date,
                incidents: list
            });
        }
    };

    const renderCell = (incident, field) => {
        // Read-only view
        if (field === 'media') {
             return (
                 <div className="flex flex-wrap gap-1">
                     {incident.mediaFiles?.length ? incident.mediaFiles.map((f, i) => (
                         <button
                             key={i}
                             type="button"
                             onClick={() => openMediaPreview(getMediaUrl(f))}
                             className="text-blue-600 underline text-[10px]"
                         >
                             View
                         </button>
                     )) : '-'}
                 </div>
             );
        }
        if (field === 'dateTime') {
            return formatDateTimeDisplay(incident.dateTime);
        }
        return <div className="whitespace-pre-wrap">{incident[field]}</div>;
    };

    const getEditDateTimeValue = (value) => {
        let displayValue = value || '';
        if (displayValue && (displayValue.endsWith('Z') || displayValue.length > 16)) {
            try {
                const d = new Date(displayValue);
                if (!isNaN(d.getTime())) {
                    const localDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
                    displayValue = localDate.toISOString().slice(0, 16);
                }
            } catch (e) {
                displayValue = '';
            }
        }
        return displayValue;
    };

    return (
        <div className="p-6 max-w-[100vw] overflow-hidden">
             
            {/* Datalist for PS */}
            <datalist id="ps-list">
                {psJurisdictions.map(ps => <option key={ps} value={ps} />)}
            </datalist>

            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <Link to="/dashboard"><ChevronLeft className="h-5 w-5" /></Link>
                    <h1 className="text-2xl font-bold">Dial-100 Incident Reporting</h1>
                </div>
                
                <div className="flex gap-2 items-center">
                    <button
                        type="button"
                        className="flex items-center gap-2 border rounded px-2 h-8 bg-white dark:bg-slate-950 text-sm"
                        onClick={() => setIsRangeOpen(true)}
                    >
                        <Calendar className="h-4 w-4" />
                        <span className="whitespace-nowrap">{rangeLabel}</span>
                    </button>
                    <Button variant="outline" size="sm" onClick={handleExportExcel}>
                        <FileText className="h-4 w-4 mr-2" /> Export
                    </Button>
                    <Button variant={hasUnsavedChanges ? "default" : "outline"} size="sm" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Save
                    </Button>
                    <Button onClick={handleAddRow} size="sm">
                        <Plus className="h-4 w-4 mr-2" /> Add Row
                    </Button>
                </div>
            </div>

            <div className="border rounded-md shadow-sm bg-white dark:bg-slate-950 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 text-xs font-medium uppercase tracking-wider text-muted-foreground sticky top-0">
                        <tr>
                            <th className="p-2 border text-center w-12">Sl. No</th>
                            <th className="p-2 border text-left min-w-[250px]">Incident Details</th>
                            <th className="p-2 border text-left w-40">Category</th>
                            <th className="p-2 border text-left w-48">Location</th>
                            <th className="p-2 border text-left w-40">Date & Time</th>
                            <th className="p-2 border text-left w-32">PS Jurisdiction</th>
                            <th className="p-2 border text-left w-24">Zone</th>
                            <th className="p-2 border text-left min-w-[150px]">Remarks</th>
                            <th className="p-2 border text-center w-24">Media</th>
                            <th className="p-2 border text-center w-20">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {incidents.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="p-8 text-center text-muted-foreground">
                                    No incidents for this date. Click 'Add Row' to start.
                                </td>
                            </tr>
                        ) : incidents.map((row) => (
                            <tr key={row.id} id={`row-${row.id}`} className={editingId === row.id ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-muted/30"}>
                                <td className="p-2 border text-center">{row.slNo}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'incidentDetails')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'incidentCategory')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'location')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'dateTime')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'psJurisdiction')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'zoneJurisdiction')}</td>
                                <td className="p-2 border align-top">{renderCell(row, 'remarks')}</td>
                                <td className="p-2 border align-top text-center">{renderCell(row, 'media')}</td>
                                <td className="p-2 border text-center font-medium">
                                    <div className="flex justify-center gap-1">
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEdit(row)}>
                                            <Edit2 className="h-3 w-3" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(row.id)}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Dialog open={isEditOpen} onOpenChange={(open) => !open && handleCancelEdit()}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingMeta.isNew ? 'Add Incident' : 'Edit Incident'}</DialogTitle>
                    </DialogHeader>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Incident Details</label>
                            <Textarea
                                value={editingData.incidentDetails || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, incidentDetails: e.target.value }))}
                                className="min-h-[80px] text-xs resize-y"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Category</label>
                            <Input
                                value={editingData.incidentCategory || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, incidentCategory: e.target.value }))}
                                className="h-9 text-xs"
                                placeholder="Category"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Location</label>
                            <Textarea
                                value={editingData.location || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, location: e.target.value }))}
                                className="min-h-[60px] text-xs resize-y"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Date & Time</label>
                            <Input
                                type="datetime-local"
                                value={getEditDateTimeValue(editingData.dateTime)}
                                onChange={(e) => setEditingData(prev => ({ ...prev, dateTime: e.target.value }))}
                                className="h-9 text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">PS Jurisdiction</label>
                            <Input
                                list="ps-list"
                                value={editingData.psJurisdiction || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, psJurisdiction: e.target.value }))}
                                className="h-9 text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Zone</label>
                            <Input
                                value={editingData.zoneJurisdiction || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, zoneJurisdiction: e.target.value }))}
                                className="h-9 text-xs"
                            />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <label className="text-xs font-medium">Remarks</label>
                            <Textarea
                                value={editingData.remarks || ''}
                                onChange={(e) => setEditingData(prev => ({ ...prev, remarks: e.target.value }))}
                                className="min-h-[80px] text-xs resize-y"
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-medium">Media</label>
                            <Input
                                type="file"
                                multiple
                                accept="image/*,video/*"
                                onChange={(e) => handleMediaUpload(Array.from(e.target.files))}
                                className="h-9 text-xs"
                            />
                            {mediaUploading[editingId] && (
                                <span className="text-[10px] text-muted-foreground">Uploading...</span>
                            )}
                            <div className="flex flex-wrap gap-1">
                                {editingData.mediaFiles?.map((f, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => openMediaPreview(getMediaUrl(f))}
                                            className="text-[10px] bg-muted px-2 py-0.5 rounded"
                                        >
                                            Media {i + 1}
                                        </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={handleCancelEdit}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveEdit}>
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={mediaPreview.open} onOpenChange={(open) => !open && setMediaPreview({ open: false, url: '', type: 'image' })}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Media Preview</DialogTitle>
                    </DialogHeader>
                    <div className="flex items-center justify-center bg-black/5 rounded-md p-3">
                        {mediaPreview.type === 'video' ? (
                            <video controls className="max-h-[70vh] w-full">
                                <source src={mediaPreview.url} />
                                Your browser does not support the video tag.
                            </video>
                        ) : (
                            <img src={mediaPreview.url} alt="Media preview" className="max-h-[70vh] w-full object-contain" />
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMediaPreview({ open: false, url: '', type: 'image' })}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isRangeOpen} onOpenChange={setIsRangeOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Select Date Range</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium">From</label>
                            <Input
                                type="date"
                                value={dateRange.start}
                                onChange={(e) => setDateRange((prev) => normalizeRange({ ...prev, start: e.target.value }))}
                                className="h-9 text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">To</label>
                            <Input
                                type="date"
                                value={dateRange.end}
                                onChange={(e) => setDateRange((prev) => normalizeRange({ ...prev, end: e.target.value }))}
                                className="h-9 text-xs"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setIsRangeOpen(false)}>Close</Button>
                        <Button onClick={() => setIsRangeOpen(false)}>Apply</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Dial100IncidentReporting;
