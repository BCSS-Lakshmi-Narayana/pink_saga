import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    CalendarDays, Plus, FileText, Edit2, Trash2,
    ChevronLeft, Eye, Loader2, Save, X, Check,
    Building2, Users, Church, Clock, Pencil, ChevronRight,
    FileDown, Share2, Upload, DownloadCloud, Table2,
    MapPin, Info, User, ShieldAlert, ExternalLink
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import api from '../lib/api';

// Default category config - Black/White Theme
const defaultCategories = {
    category1: {
        label: 'Government of Telangana / CM / Governor / Central Minister Programmes',
        shortLabel: 'Govt',
        icon: Building2,
        color: 'bg-foreground text-background border-foreground/50'
    },
    category2: {
        label: 'Other Programmes',
        shortLabel: 'Other',
        icon: Users,
        color: 'bg-muted-foreground text-background border-muted-foreground/50'
    },
    category3: {
        label: 'Religious Programmes',
        shortLabel: 'Religious',
        icon: Church,
        color: 'bg-foreground text-background border-foreground/50'
    },
    category4: {
        label: 'Ongoing Programmes',
        shortLabel: 'Ongoing',
        icon: Clock,
        color: 'bg-muted-foreground text-background border-muted-foreground/50'
    },
};

// Format date for display
const formatDateDisplay = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

// Format date for API (YYYY-MM-DD)
const formatDateAPI = (date) => {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
};

const Announcements = () => {
    const [events, setEvents] = useState([]);
    const [categories, setCategories] = useState(defaultCategories);
    const [activeTab, setActiveTab] = useState('table');
    const [editingId, setEditingId] = useState(null);
    const [editingData, setEditingData] = useState({});
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryLabel, setEditingCategoryLabel] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [autoSaveStatus, setAutoSaveStatus] = useState(''); // 'saving', 'saved', ''
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Periscope upload
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadFile, setUploadFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    // Upload info & abstract
    const [uploadInfo, setUploadInfo] = useState(null);
    const [showAbstractModal, setShowAbstractModal] = useState(false);
    const [abstractData, setAbstractData] = useState(null);

    // Event detail modal (dashboard preview)
    const [selectedEvent, setSelectedEvent] = useState(null);

    // Date filtering
    const [selectedDate, setSelectedDate] = useState(formatDateAPI(new Date()));

    // Load programmes for selected date
    const loadProgrammes = async (date) => {
        setIsLoading(true);
        try {
            const response = await api.get(`/daily-programmes?date=${date}`);
            const data = response.data;

            // Flatten programmes from all categories
            const allEvents = [
                ...data.programmes.category1.map(p => ({ ...p, id: p.id })),
                ...data.programmes.category2.map(p => ({ ...p, id: p.id })),
                ...data.programmes.category3.map(p => ({ ...p, id: p.id })),
                ...data.programmes.category4.map(p => ({ ...p, id: p.id })),
            ];

            setEvents(allEvents);
            setHasUnsavedChanges(false);

            // Update category labels if available
            if (data.categoryLabels) {
                setCategories(prev => {
                    const updated = { ...prev };
                    Object.keys(data.categoryLabels).forEach(key => {
                        if (data.categoryLabels[key] && updated[key]) {
                            updated[key] = {
                                ...updated[key],
                                label: data.categoryLabels[key],
                                shortLabel: data.categoryLabels[key].split(' ')[0]
                            };
                        }
                    });
                    return updated;
                });
            }
        } catch (error) {
            console.error('Error loading programmes:', error);
            // If 401 or no data, just set empty
            setEvents([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Load on mount and date change
    useEffect(() => {
        loadProgrammes(selectedDate);
        loadUploadInfo(selectedDate);
    }, [selectedDate]);

    // Fetch upload info for a date (abstract, S3 availability)
    const loadUploadInfo = async (date) => {
        try {
            const response = await api.get(`/daily-programmes/upload-info?date=${date}`);
            setUploadInfo(response.data);
        } catch {
            setUploadInfo(null);
        }
    };

    // Auto-save function
    const performAutoSave = async (eventsToSave, categoriesToSave) => {
        setAutoSaveStatus('saving');
        try {
            const groupedEvents = {
                category1: eventsToSave.filter(e => e.category === 'category1'),
                category2: eventsToSave.filter(e => e.category === 'category2'),
                category3: eventsToSave.filter(e => e.category === 'category3'),
                category4: eventsToSave.filter(e => e.category === 'category4'),
            };

            const categoryLabels = {};
            Object.keys(categoriesToSave).forEach(key => {
                categoryLabels[key] = categoriesToSave[key].label;
            });

            await api.post('/daily-programmes/bulk', {
                date: selectedDate,
                categoryLabels,
                programmes: groupedEvents
            });

            setAutoSaveStatus('saved');
            setHasUnsavedChanges(false);
            setTimeout(() => setAutoSaveStatus(''), 2000);
        } catch (error) {
            console.error('Auto-save error:', error);
            setAutoSaveStatus('');
        }
    };

    // Auto-save effect - debounced
    useEffect(() => {
        if (!hasUnsavedChanges || isLoading) return;

        const timer = setTimeout(() => {
            performAutoSave(events, categories);
        }, 2000); // Auto-save 2 seconds after last change

        return () => clearTimeout(timer);
    }, [events, categories, hasUnsavedChanges, isLoading]);

    // Save all programmes for selected date (manual)
    const handleSave = async () => {
        setIsSaving(true);
        try {
            const groupedEvents = {
                category1: events.filter(e => e.category === 'category1'),
                category2: events.filter(e => e.category === 'category2'),
                category3: events.filter(e => e.category === 'category3'),
                category4: events.filter(e => e.category === 'category4'),
            };

            const categoryLabels = {};
            Object.keys(categories).forEach(key => {
                categoryLabels[key] = categories[key].label;
            });

            await api.post('/daily-programmes/bulk', {
                date: selectedDate,
                categoryLabels,
                programmes: groupedEvents
            });

            setHasUnsavedChanges(false);
            toast.success(`✅ Successfully saved to DB! ${events.length} events stored for ${formatDateDisplay(selectedDate)}`);
        } catch (error) {
            console.error('Error saving:', error);
            toast.error('Failed to save programmes');
        } finally {
            setIsSaving(false);
        }
    };

    // Date navigation
    const handleDateChange = (days) => {
        const current = new Date(selectedDate);
        current.setDate(current.getDate() + days);
        setSelectedDate(formatDateAPI(current));
    };

    const handleDateInput = (e) => {
        setSelectedDate(e.target.value);
    };

    // Category editing functions
    const handleEditCategory = (categoryId) => {
        setEditingCategoryId(categoryId);
        setEditingCategoryLabel(categories[categoryId].label);
    };

    const handleSaveCategoryEdit = () => {
        if (editingCategoryLabel.trim()) {
            setCategories(prev => ({
                ...prev,
                [editingCategoryId]: {
                    ...prev[editingCategoryId],
                    label: editingCategoryLabel.trim(),
                    shortLabel: editingCategoryLabel.trim().split(' ')[0]
                }
            }));
            setHasUnsavedChanges(true);
            toast.success('Category title updated');
        }
        setEditingCategoryId(null);
        setEditingCategoryLabel('');
    };

    const handleCancelCategoryEdit = () => {
        setEditingCategoryId(null);
        setEditingCategoryLabel('');
    };

    const handleEdit = (event) => {
        setEditingId(event.id);
        setEditingData({ ...event });
    };

    const handleSaveEdit = () => {
        setEvents(prev => prev.map(e => e.id === editingId ? editingData : e));
        setEditingId(null);
        setEditingData({});
        setHasUnsavedChanges(true);
        toast.success('Event updated - auto-saving...');
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingData({});
    };

    const handleDelete = (id) => {
        setEvents(prev => prev.filter(e => e.id !== id));
        setHasUnsavedChanges(true);
        toast.success('Event deleted - auto-saving...');
    };

    const handleAddRow = (category) => {
        const categoryEvents = events.filter(e => e.category === category);
        const maxSlNo = categoryEvents.length > 0 ? Math.max(...categoryEvents.map(e => e.slNo)) : 0;

        const newEvent = {
            id: `temp-${Date.now()}`,
            category,
            slNo: maxSlNo + 1,
            zone: '',
            programName: '',
            location: '',
            organizer: '',
            expectedMembers: 0,
            time: '',
            gist: '',
            permission: 'By Information',
            comments: 'Required L&O and Traffic BB',
        };
        setEvents(prev => [...prev, newEvent]);
        setEditingId(newEvent.id);
        setEditingData(newEvent);
        toast.success('New row added - fill in the details');
    };

    const handleClearAll = async () => {
        if (window.confirm(`Are you sure you want to clear all events for ${formatDateDisplay(selectedDate)}?`)) {
            setEvents([]);
            setHasUnsavedChanges(true);
            toast.success('All events cleared - auto-saving...');
        }
    };

    // Upload Periscope .docx file
    const handleUploadPeriscope = async () => {
        if (!uploadFile) {
            toast.error('Please select a Periscope .docx file');
            return;
        }
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', uploadFile);
            formData.append('date', selectedDate);

            // Use native axios to bypass api.js default Content-Type which strips the boundary
            const token = localStorage.getItem('token');
            const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:8001/api' : '/api';
            const res = await axios.post(`${baseUrl}/daily-programmes/upload-periscope`, formData, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            toast.success(`${res.data.message}`);
            setShowUploadModal(false);
            setUploadFile(null);
            loadProgrammes(selectedDate);
            loadUploadInfo(selectedDate);

            // Show abstract summary after successful upload
            if (res.data.abstract) {
                setAbstractData({
                    abstract: res.data.abstract,
                    totalProgrammes: res.data.totalProgrammes
                });
                setShowAbstractModal(true);
            }
        } catch (err) {
            console.error('Upload Error Detailed:', err?.response?.data || err.message);
            toast.error(err?.response?.data?.message || 'Failed to parse Periscope document');
        } finally {
            setIsUploading(false);
        }
    };

    // Download original DOCX from S3
    const handleDownloadOriginal = async () => {
        try {
            const res = await api.get(`/daily-programmes/download-periscope?date=${selectedDate}`);
            if (res.data.downloadUrl) {
                const a = document.createElement('a');
                a.href = res.data.downloadUrl;
                a.download = res.data.originalFilename || `Periscope_${selectedDate}.docx`;
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                toast.success('Downloading original document...');
            }
        } catch (err) {
            toast.error('No original document found for this date');
        }
    };

    // View abstract summary for current date
    const handleViewAbstract = () => {
        if (uploadInfo?.abstract) {
            setAbstractData({
                abstract: uploadInfo.abstract,
                totalProgrammes: uploadInfo.totalProgrammes
            });
            setShowAbstractModal(true);
        }
    };

    // Export handlers
    const handleExportPDF = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${api.defaults.baseURL}/export/pdf?date=${selectedDate}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `periscope-${selectedDate}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success('PDF downloaded successfully!');
        } catch (error) {
            console.error('Error exporting PDF:', error);
            toast.error('Failed to export PDF');
        }
    };

    const handleExportWord = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${api.defaults.baseURL}/export/word?date=${selectedDate}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to generate Word document');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `periscope-${selectedDate}.docx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success('Word document downloaded successfully!');
        } catch (error) {
            console.error('Error exporting Word:', error);
            toast.error('Failed to export Word document');
        }
    };

    const handleShareWhatsApp = async () => {
        try {
            const token = localStorage.getItem('token');
            const toastId = toast.loading('Generating PDF for sharing...');

            const response = await fetch(`${api.defaults.baseURL}/export/pdf?date=${selectedDate}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                toast.dismiss(toastId);
                throw new Error('Failed to generate PDF');
            }

            const blob = await response.blob();
            const file = new File([blob], `periscope-${selectedDate}.pdf`, { type: 'application/pdf' });

            toast.dismiss(toastId);

            // 1. Try Native Sharing (Mobile/Supported Browsers)
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Periscope Report - ${formatDateDisplay(selectedDate)}`,
                    text: `Here is the Daily Programmes Report for ${formatDateDisplay(selectedDate)}`,
                    files: [file]
                });
                toast.success('Shared successfully!');
            }
            // 2. Fallback for Desktop (Manual Attachment)
            else {
                // Trigger Download
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `periscope-${selectedDate}.pdf`;
                document.body.appendChild(a);
                a.click();

                // UX: Give time for download to start before opening WhatsApp
                toast.success('PDF downloaded!', { duration: 3000 });

                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    const message = encodeURIComponent(`Here is the Daily Programmes Report for ${formatDateDisplay(selectedDate)}`);
                    window.open(`https://wa.me/?text=${message}`, '_blank');

                    // Specific instruction for desktop user
                    toast.info('Please DRAG & DROP the downloaded file into WhatsApp', {
                        duration: 6000,
                        icon: '📎'
                    });
                }, 1500);
            }
        } catch (error) {
            console.error('Error sharing via WhatsApp:', error);
            toast.error('Failed to share via WhatsApp');
        }
    };

    const groupedEvents = {
        category1: events.filter(e => e.category === 'category1'),
        category2: events.filter(e => e.category === 'category2'),
        category3: events.filter(e => e.category === 'category3'),
        category4: events.filter(e => e.category === 'category4'),
    };

    const renderEditableCell = (field, type = 'text', width = 'min-w-[100px]') => {
        if (editingId === editingData.id) {
            if (type === 'number') {
                return (
                    <Input
                        type="number"
                        value={editingData[field] || ''}
                        onChange={(e) => setEditingData({ ...editingData, [field]: parseInt(e.target.value) || 0 })}
                        className={`h-7 text-xs ${width}`}
                    />
                );
            }
            if (type === 'select') {
                return (
                    <select
                        value={editingData[field] || ''}
                        onChange={(e) => setEditingData({ ...editingData, [field]: e.target.value })}
                        className="h-7 text-xs border rounded px-1 bg-background min-w-[100px]"
                    >
                        <option value="By Information">By Information</option>
                        <option value="Permitted">Permitted</option>
                        <option value="Applied for Permission">Applied for Permission</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                );
            }
            if (type === 'textarea') {
                return (
                    <Textarea
                        value={editingData[field] || ''}
                        onChange={(e) => setEditingData({ ...editingData, [field]: e.target.value })}
                        className={`text-xs ${width}`}
                        rows={2}
                    />
                );
            }
            return (
                <Input
                    value={editingData[field] || ''}
                    onChange={(e) => setEditingData({ ...editingData, [field]: e.target.value })}
                    className={`h-7 text-xs ${width}`}
                />
            );
        }
        return null;
    };

    const EventRow = ({ event }) => {
        const isEditing = editingId === event.id;

        return (
            <tr className={`border-b border-border hover:bg-muted/30 ${isEditing ? 'bg-muted/20' : ''}`}>
                <td className="p-2 text-xs text-center border-r border-border">{event.slNo}</td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('zone') : event.zone}
                </td>
                <td className="p-2 text-xs font-medium border-r border-border">
                    {isEditing ? renderEditableCell('programName') : event.programName}
                </td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('location', 'textarea') : (
                        <div className="whitespace-pre-wrap">{event.location}</div>
                    )}
                </td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('organizer', 'textarea') : (
                        <div className="whitespace-pre-wrap">{event.organizer}</div>
                    )}
                </td>
                <td className="p-2 text-xs text-center border-r border-border">
                    {isEditing ? renderEditableCell('expectedMembers', 'number', 'min-w-[60px]') : event.expectedMembers}
                </td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('time') : event.time}
                </td>
                <td className="p-2 text-xs border-r border-border max-w-[200px]">
                    {isEditing ? renderEditableCell('gist', 'textarea') : (
                        <div className="whitespace-pre-wrap">{event.gist}</div>
                    )}
                </td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('permission', 'select') : (
                        <Badge variant="outline" className={`text-[9px] ${event.permission === 'Permitted' ? 'bg-foreground text-background' :
                            event.permission === 'Rejected' ? 'bg-destructive text-destructive-foreground' :
                                event.permission === 'Applied for Permission' ? 'bg-muted-foreground/20 text-foreground font-semibold' :
                                    'bg-muted text-muted-foreground'
                            }`}>
                            {event.permission}
                        </Badge>
                    )}
                </td>
                <td className="p-2 text-xs border-r border-border">
                    {isEditing ? renderEditableCell('comments') : event.comments}
                </td>
                <td className="p-2 text-xs">
                    {isEditing ? (
                        <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
                                <Check className="h-3 w-3 text-foreground" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
                                <X className="h-3 w-3 text-red-600" />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEdit(event)}>
                                <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(event.id)}>
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    const CategoryTable = ({ categoryId, categoryEvents }) => {
        const config = categories[categoryId];
        const Icon = config.icon;
        const isEditingTitle = editingCategoryId === categoryId;

        return (
            <div className="mb-6">
                {/* Category Header - Editable Title */}
                <div className={`flex items-center justify-between gap-2 p-2 border-2 border-b-0 ${config.color} font-semibold`}>
                    <div className="flex items-center gap-2 flex-1">
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {isEditingTitle ? (
                            <div className="flex items-center gap-2 flex-1">
                                <Input
                                    value={editingCategoryLabel}
                                    onChange={(e) => setEditingCategoryLabel(e.target.value)}
                                    className="h-7 text-sm flex-1 bg-background text-foreground"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveCategoryEdit();
                                        if (e.key === 'Escape') handleCancelCategoryEdit();
                                    }}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveCategoryEdit}>
                                    <Check className="h-3 w-3 text-foreground" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelCategoryEdit}>
                                    <X className="h-3 w-3 text-red-400" />
                                </Button>
                            </div>
                        ) : (
                            <>
                                <span className="text-sm">{config.label}</span>
                                {categoryEvents.length > 0 && (
                                    <span className="text-sm">- {String(categoryEvents.length).padStart(2, '0')}</span>
                                )}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 ml-1 opacity-60 hover:opacity-100"
                                    onClick={() => handleEditCategory(categoryId)}
                                    title="Edit category title"
                                >
                                    <Pencil className="h-3 w-3" />
                                </Button>
                            </>
                        )}
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white hover:bg-white/20" onClick={() => handleAddRow(categoryId)}>
                        <Plus className="h-3 w-3" /> Add Row
                    </Button>
                </div>

                {/* Table */}
                <div className="border-2 overflow-x-auto">
                    <table className="w-full min-w-[1400px]">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-12">Sl. No</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-28">Zones</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-32">Name of the Programme</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-36">Police Station & Place</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-44">Organizer's details with party affiliation</th>
                                <th className="p-2 text-[10px] font-bold text-center border-r border-border w-20">Expected Members</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-24">Time, From &To</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-40">Gist of the Programmes</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-28">Whether permission granted/ rejected</th>
                                <th className="p-2 text-[10px] font-bold text-left border-r border-border w-28">Comments</th>
                                <th className="p-2 text-[10px] font-bold text-center w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categoryEvents.length > 0 ? (
                                categoryEvents.map(event => <EventRow key={event.id} event={event} />)
                            ) : (
                                <tr>
                                    <td colSpan={11} className="p-8 text-center text-muted-foreground text-sm">
                                        <div className="flex flex-col items-center gap-2">
                                            <FileText className="h-8 w-8 opacity-50" />
                                            <p>No events added yet</p>
                                            <Button size="sm" variant="outline" className="gap-1" onClick={() => handleAddRow(categoryId)}>
                                                <Plus className="h-3 w-3" /> Add First Event
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 md:p-6 max-w-[1800px] mx-auto space-y-4 min-h-[calc(100vh-120px)]">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Link to="/" className="text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="h-5 w-5" />
                    </Link>
                    <CalendarDays className="h-6 w-6" />
                    <div>
                        <h1 className="text-xl font-bold">Periscope</h1>
                        <p className="text-xs text-muted-foreground">Manage daily programme details. Auto-saves after edits.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Auto-save status indicator */}
                    {autoSaveStatus === 'saving' && (
                        <Badge variant="outline" className="text-xs bg-yellow-500/20 text-yellow-600 animate-pulse gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Auto-saving...
                        </Badge>
                    )}
                    {autoSaveStatus === 'saved' && (
                        <Badge variant="outline" className="text-xs bg-foreground/20 text-foreground gap-1">
                            <Check className="h-3 w-3" /> Saved to DB
                        </Badge>
                    )}
                    {hasUnsavedChanges && autoSaveStatus === '' && (
                        <Badge variant="outline" className="text-xs bg-muted-foreground/20 text-foreground">
                            Unsaved changes
                        </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                        {events.length} total events
                    </Badge>
                    <Button size="sm" variant="outline" className="gap-1 bg-blue-600 text-white hover:bg-blue-700 hover:text-white" onClick={() => setShowUploadModal(true)}>
                        <Upload className="h-3 w-3" /> Upload Periscope
                    </Button>
                    {uploadInfo?.hasUpload && (
                        <>
                            <Button size="sm" variant="outline" className="gap-1" onClick={handleDownloadOriginal} title="Download original uploaded DOCX">
                                <DownloadCloud className="h-3 w-3" /> Original
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1" onClick={handleViewAbstract} title="View Abstract of Programmes">
                                <Table2 className="h-3 w-3" /> Abstract
                            </Button>
                        </>
                    )}
                    {events.length > 0 && (
                        <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={handleClearAll}>
                            <Trash2 className="h-3 w-3" /> Clear All
                        </Button>
                    )}
                    <Button size="sm" variant="outline" className="gap-1" onClick={handleExportPDF}>
                        <FileDown className="h-3 w-3" /> PDF
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={handleExportWord}>
                        <FileText className="h-3 w-3" /> Word
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 bg-green-600 text-white hover:bg-green-700 hover:text-white" onClick={handleShareWhatsApp}>
                        <Share2 className="h-3 w-3" /> WhatsApp
                    </Button>
                    <Button size="sm" className="gap-1" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                    </Button>
                </div>
            </div>

            {/* Date Picker */}
            <div className="flex items-center justify-center gap-2 p-3 bg-muted rounded-lg border border-border">
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDateChange(-1)}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-foreground" />
                    <Input
                        type="date"
                        value={selectedDate}
                        onChange={handleDateInput}
                        className="w-auto text-sm"
                    />
                    <span className="text-foreground text-sm font-medium hidden sm:inline">
                        {formatDateDisplay(selectedDate)}
                    </span>
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDateChange(1)}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    className="ml-2 bg-foreground text-background hover:bg-foreground/90 text-xs"
                    onClick={() => setSelectedDate(formatDateAPI(new Date()))}
                >
                    Today
                </Button>
            </div>

            {/* Loading State */}
            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading programmes...</span>
                </div>
            ) : (
                /* Tabs */
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid grid-cols-2 w-full max-w-xs">
                        <TabsTrigger value="table" className="gap-1"><FileText className="h-3 w-3" /> Table View</TabsTrigger>
                        <TabsTrigger value="preview" className="gap-1"><Eye className="h-3 w-3" /> Dashboard Preview</TabsTrigger>
                    </TabsList>

                    {/* Table View Tab */}
                    <TabsContent value="table" className="mt-4">
                        {Object.keys(categories).map((categoryId) => (
                            <CategoryTable key={categoryId} categoryId={categoryId} categoryEvents={groupedEvents[categoryId]} />
                        ))}
                    </TabsContent>

                    {/* Preview Tab – Rich Dashboard */}
                    <TabsContent value="preview" className="mt-4">
                        <div className="space-y-4">
                            {/* Header row */}
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Eye className="h-5 w-5" /> Dashboard Preview
                                </h3>
                                <span className="text-xs text-muted-foreground">{formatDateDisplay(selectedDate)}</span>
                            </div>

                            {/* ── Category stat cards ── */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {Object.entries(categories).map(([key, config]) => {
                                    const count = events.filter(e => e.category === key).length;
                                    const Icon = config.icon;
                                    const accent = key === 'category1' ? 'border-blue-500/40 bg-blue-500/5' :
                                        key === 'category2' ? 'border-amber-500/40 bg-amber-500/5' :
                                        key === 'category3' ? 'border-purple-500/40 bg-purple-500/5' :
                                        'border-green-500/40 bg-green-500/5';
                                    const iconColor = key === 'category1' ? 'text-blue-500' :
                                        key === 'category2' ? 'text-amber-500' :
                                        key === 'category3' ? 'text-purple-500' :
                                        'text-green-500';
                                    return (
                                        <div key={key} className={`rounded-lg border-2 p-3 ${accent}`}>
                                            <div className="flex items-center gap-2 mb-1">
                                                <Icon className={`h-4 w-4 ${iconColor}`} />
                                                <span className="text-xs font-semibold text-muted-foreground">{config.shortLabel}</span>
                                            </div>
                                            <div className="text-3xl font-bold">{count}</div>
                                            <div className="text-[10px] text-muted-foreground mt-1 leading-tight line-clamp-2">{config.label}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {events.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                                    <CalendarDays className="h-16 w-16 opacity-30 mb-4" />
                                    <p className="text-lg font-medium mb-2">No Events Added</p>
                                    <p className="text-sm mb-6">Upload a Periscope document or add events in Table View</p>
                                    <button
                                        onClick={() => setActiveTab('table')}
                                        className="px-4 py-2 bg-foreground text-background font-bold rounded hover:bg-foreground/90 transition-colors"
                                    >
                                        Go to Table View
                                    </button>
                                </div>
                            ) : (
                                /* ── Per-category sections ── */
                                <div className="space-y-6">
                                    {Object.entries(categories).map(([catKey, config]) => {
                                        const catEvents = events.filter(e => e.category === catKey);
                                        if (catEvents.length === 0) return null;
                                        const Icon = config.icon;
                                        const headerColor = catKey === 'category1' ? 'bg-blue-600' :
                                            catKey === 'category2' ? 'bg-amber-600' :
                                            catKey === 'category3' ? 'bg-purple-600' :
                                            'bg-green-700';
                                        const badgeColor = catKey === 'category1' ? 'bg-blue-500/10 text-blue-700 border-blue-400/30' :
                                            catKey === 'category2' ? 'bg-amber-500/10 text-amber-700 border-amber-400/30' :
                                            catKey === 'category3' ? 'bg-purple-500/10 text-purple-700 border-purple-400/30' :
                                            'bg-green-500/10 text-green-700 border-green-400/30';
                                        const dotColor = catKey === 'category1' ? 'bg-blue-500' :
                                            catKey === 'category2' ? 'bg-amber-500' :
                                            catKey === 'category3' ? 'bg-purple-500' :
                                            'bg-green-500';
                                        return (
                                            <div key={catKey} className="rounded-lg border border-border overflow-hidden">
                                                {/* Section header */}
                                                <div className={`${headerColor} text-white flex items-center justify-between px-4 py-2`}>
                                                    <div className="flex items-center gap-2">
                                                        <Icon className="h-4 w-4" />
                                                        <span className="text-sm font-bold">{config.label}</span>
                                                    </div>
                                                    <span className="text-xs font-bold bg-white/20 rounded-full px-2 py-0.5">{catEvents.length} Events</span>
                                                </div>

                                                {/* Event cards grid */}
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0">
                                                    {catEvents.map((event, idx) => (
                                                        <div
                                                            key={event.id}
                                                            className="group relative border-b border-r border-border p-3 cursor-pointer hover:bg-muted/40 transition-all duration-150"
                                                            onClick={() => setSelectedEvent(event)}
                                                        >
                                                            {/* Accent dot + sl# */}
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                                                                    <span className="text-[10px] text-muted-foreground font-mono">#{event.slNo || idx + 1}</span>
                                                                </div>
                                                                <Badge variant="outline" className={`text-[9px] font-bold px-1.5 py-0 leading-5 ${badgeColor}`}>
                                                                    {event.permission === 'Permitted' ? '✓ Permitted' :
                                                                     event.permission === 'Applied for Permission' ? '⏳ Applied' :
                                                                     event.permission === 'Rejected' ? '✗ Rejected' :
                                                                     'ℹ Info'}
                                                                </Badge>
                                                            </div>

                                                            {/* Programme name */}
                                                            <p className="text-sm font-semibold leading-tight mb-2 line-clamp-2 group-hover:text-foreground">
                                                                {event.programName || 'Untitled Event'}
                                                            </p>

                                                            {/* Key details */}
                                                            <div className="space-y-1">
                                                                {event.zone && (
                                                                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                                        <MapPin className="h-3 w-3 flex-shrink-0" />
                                                                        <span className="truncate">{event.zone}</span>
                                                                    </div>
                                                                )}
                                                                {event.time && (
                                                                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                                        <Clock className="h-3 w-3 flex-shrink-0" />
                                                                        <span>{event.time}</span>
                                                                    </div>
                                                                )}
                                                                {event.expectedMembers > 0 && (
                                                                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                                        <Users className="h-3 w-3 flex-shrink-0" />
                                                                        <span>{event.expectedMembers.toLocaleString()} expected</span>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Hover hint */}
                                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <div className="bg-foreground/80 text-background text-[10px] font-semibold px-2 py-1 rounded-full pointer-events-none">
                                                                    Click for full details
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Ticker bar */}
                            {events.length > 0 && (
                                <div className="bg-muted/80 border border-border rounded py-2 px-4 overflow-hidden">
                                    <div className="flex items-center gap-6 animate-marquee whitespace-nowrap text-muted-foreground">
                                        {Object.entries(categories).map(([key, config]) => {
                                            const count = events.filter(e => e.category === key).length;
                                            return (
                                                <span key={key} className="text-xs font-bold">
                                                    {config.shortLabel.toUpperCase()}: {count} Events
                                                </span>
                                            );
                                        })}
                                        <span className="text-xs font-bold text-foreground">📍 TOTAL: {events.length} Events</span>
                                        <span className="mx-4">•••</span>
                                        {Object.entries(categories).map(([key, config]) => {
                                            const count = events.filter(e => e.category === key).length;
                                            return (
                                                <span key={`${key}-2`} className="text-xs font-bold">
                                                    {config.shortLabel.toUpperCase()}: {count} Events
                                                </span>
                                            );
                                        })}
                                        <span className="text-xs font-bold text-foreground">📍 TOTAL: {events.length} Events</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            )}

            {/* ── Event Detail Modal ── */}
            {selectedEvent && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={() => setSelectedEvent(null)}
                >
                    <div
                        className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh] overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header strip — colour-coded by category */}
                        {(() => {
                            const cat = selectedEvent.category;
                            const headerBg = cat === 'category1' ? 'bg-blue-600' :
                                cat === 'category2' ? 'bg-amber-600' :
                                cat === 'category3' ? 'bg-purple-600' : 'bg-green-700';
                            const Icon = categories[cat]?.icon || Info;
                            return (
                                <div className={`${headerBg} text-white px-4 py-3 flex items-center justify-between`}>
                                    <div className="flex items-center gap-2">
                                        <Icon className="h-4 w-4" />
                                        <span className="text-xs font-bold uppercase tracking-wide">
                                            {categories[cat]?.shortLabel || 'Event'} &mdash; #{selectedEvent.slNo}
                                        </span>
                                    </div>
                                    <button onClick={() => setSelectedEvent(null)} className="p-1 hover:bg-white/20 rounded">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            );
                        })()}

                        {/* Body */}
                        <div className="overflow-y-auto p-5 space-y-4">
                            {/* Programme name */}
                            <h2 className="text-lg font-bold leading-snug">
                                {selectedEvent.programName || 'Untitled Event'}
                            </h2>

                            {/* Permission badge */}
                            {selectedEvent.permission && (
                                <Badge variant="outline" className={`text-xs font-semibold ${
                                    selectedEvent.permission === 'Permitted' ? 'bg-green-500/10 text-green-700 border-green-400/40' :
                                    selectedEvent.permission === 'Applied for Permission' ? 'bg-yellow-500/10 text-yellow-700 border-yellow-400/40' :
                                    selectedEvent.permission === 'Rejected' ? 'bg-red-500/10 text-red-700 border-red-400/40' :
                                    'bg-muted text-muted-foreground border-border'
                                }`}>
                                    <ShieldAlert className="h-3 w-3 mr-1 inline" />
                                    {selectedEvent.permission}
                                </Badge>
                            )}

                            {/* Detail grid */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Zone</p>
                                    <p className="font-medium flex items-start gap-1">
                                        <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                                        {selectedEvent.zone || '—'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Time</p>
                                    <p className="font-medium flex items-center gap-1">
                                        <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                        {selectedEvent.time || '—'}
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Location / Police Station</p>
                                    <p className="font-medium">{selectedEvent.location || '—'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Organizer</p>
                                    <p className="font-medium flex items-center gap-1">
                                        <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                        {selectedEvent.organizer || '—'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Expected Members</p>
                                    <p className="font-medium flex items-center gap-1">
                                        <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                        {selectedEvent.expectedMembers ? selectedEvent.expectedMembers.toLocaleString() : '—'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Category</p>
                                    <p className="font-medium">{categories[selectedEvent.category]?.label || selectedEvent.category}</p>
                                </div>
                                {selectedEvent.gist && (
                                    <div className="col-span-2">
                                        <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Gist</p>
                                        <p className="text-sm leading-relaxed">{selectedEvent.gist}</p>
                                    </div>
                                )}
                                {selectedEvent.comments && (
                                    <div className="col-span-2">
                                        <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Comments / Notes</p>
                                        <p className="text-sm leading-relaxed text-muted-foreground">{selectedEvent.comments}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer actions */}
                        <div className="flex items-center justify-between gap-2 p-4 border-t border-border">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => {
                                    setSelectedEvent(null);
                                    setActiveTab('table');
                                    // Jump to editing this event
                                    handleEdit(selectedEvent);
                                }}
                            >
                                <Edit2 className="h-3 w-3" /> Edit in Table
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedEvent(null)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Periscope Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-lg border border-border shadow-2xl w-full max-w-lg flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="flex items-center gap-2">
                                <Upload className="h-5 w-5 text-blue-500" />
                                <h2 className="text-lg font-bold">Upload Periscope Document</h2>
                            </div>
                            <Button size="icon" variant="ghost" onClick={() => { setShowUploadModal(false); setUploadFile(null); }}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="p-4 space-y-4">
                            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 border border-border">
                                <strong>Target Date:</strong> {formatDateDisplay(selectedDate)}
                                <span className="ml-2 text-yellow-600">⚠️ This will replace any existing entries for this date.</span>
                            </div>

                            {/* File Drop Zone */}
                            <label
                                className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${uploadFile ? 'border-blue-500 bg-blue-500/5' : 'border-border hover:border-blue-400 hover:bg-muted/30'
                                    }`}
                            >
                                <input
                                    type="file"
                                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    className="hidden"
                                    onChange={(e) => setUploadFile(e.target.files[0] || null)}
                                />
                                {uploadFile ? (
                                    <>
                                        <FileText className="h-10 w-10 text-blue-500" />
                                        <div className="text-center">
                                            <p className="text-sm font-medium">{uploadFile.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {(uploadFile.size / 1024).toFixed(1)} KB
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-xs text-destructive"
                                            onClick={(e) => { e.preventDefault(); setUploadFile(null); }}
                                        >
                                            Remove
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-10 w-10 text-muted-foreground" />
                                        <div className="text-center">
                                            <p className="text-sm font-medium">Click to select or drag a .docx file</p>
                                            <p className="text-xs text-muted-foreground">Periscope Word document only</p>
                                        </div>
                                    </>
                                )}
                            </label>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                            <Button variant="outline" size="sm" onClick={() => { setShowUploadModal(false); setUploadFile(null); }}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={handleUploadPeriscope}
                                disabled={isUploading || !uploadFile}
                            >
                                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                {isUploading ? 'Parsing...' : 'Parse & Save'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Abstract of Programmes Modal */}
            {showAbstractModal && abstractData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-lg border border-border shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="flex items-center gap-2">
                                <Table2 className="h-5 w-5 text-foreground" />
                                <h2 className="text-lg font-bold">ABSTRACT OF PROGRAMMES</h2>
                            </div>
                            <Button size="icon" variant="ghost" onClick={() => setShowAbstractModal(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="p-4 overflow-y-auto">
                            <div className="text-xs text-muted-foreground mb-3">
                                <strong>Date:</strong> {formatDateDisplay(selectedDate)}
                            </div>

                            <table className="w-full border-collapse border border-border text-sm">
                                <thead>
                                    <tr className="bg-muted/50">
                                        <th className="border border-border p-2 text-left text-xs font-bold w-12">Sl. No.</th>
                                        <th className="border border-border p-2 text-left text-xs font-bold">Name of the Programmes</th>
                                        <th className="border border-border p-2 text-center text-xs font-bold w-20">No. of Programmes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {abstractData.abstract.map((cat, catIdx) => (
                                        <React.Fragment key={cat.categoryKey}>
                                            {/* Category header row */}
                                            <tr className="bg-foreground/10 font-bold">
                                                <td colSpan={2} className="border border-border p-2 text-xs">
                                                    {cat.categoryLabel}
                                                </td>
                                                <td className="border border-border p-2 text-center text-xs font-bold">
                                                    {String(cat.totalCount).padStart(2, '0')}
                                                </td>
                                            </tr>
                                            {/* Individual programme rows */}
                                            {cat.items.map((item, idx) => (
                                                <tr key={`${cat.categoryKey}-${idx}`} className="hover:bg-muted/30">
                                                    <td className="border border-border p-2 text-xs text-center">{idx + 1}.</td>
                                                    <td className="border border-border p-2 text-xs">{item.name}</td>
                                                    <td className="border border-border p-2 text-xs text-center">
                                                        {String(item.count).padStart(2, '0')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                    {/* Total row */}
                                    <tr className="bg-foreground text-background font-bold">
                                        <td colSpan={2} className="border border-border p-2 text-xs text-right">
                                            Total
                                        </td>
                                        <td className="border border-border p-2 text-xs text-center">
                                            {abstractData.totalProgrammes}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                            {uploadInfo?.hasUpload && (
                                <Button variant="outline" size="sm" className="gap-1" onClick={handleDownloadOriginal}>
                                    <DownloadCloud className="h-3 w-3" /> Download Original
                                </Button>
                            )}
                            <Button size="sm" onClick={() => setShowAbstractModal(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Announcements;
