import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    UserSearch, Plus, Search, Trash2,
    X, User, Loader2, AlertTriangle, Archive,
    PlusCircle, MinusCircle, Shield, LayoutGrid, Phone, Mail, MapPin,
    Globe, FileText, Smartphone, Cpu, MessageCircle, Facebook, Instagram,
    Youtube, XCircle, Camera, Pencil, Monitor
} from 'lucide-react';
import { toast } from 'sonner';

import api from '../../lib/api';
import AddSourceModal from '../../components/AddSourceModal';
import UnifiedMonitors from '../UnifiedMonitors';

const AvatarPlaceholder = ({ name, size = 'lg' }) => {
    const initials = (name || '?')
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    const sizeClasses = size === 'lg'
        ? 'w-24 h-24 text-3xl'
        : size === 'md'
            ? 'w-16 h-16 text-xl'
            : 'w-10 h-10 text-sm';

    return (
        <div className={`${sizeClasses} rounded-full bg-[#f3f4f6] flex items-center justify-center text-slate-500 font-bold border-4 border-white shadow-sm`}>
            {initials}
        </div>
    );
};

const POICard = ({ poi, onView, onEdit, onDelete }) => {
    const brandColor = 'bg-primary';

    // Derived profile image from linked social media if main one is missing
    const xLink = poi.socialMedia?.find(s => s.platform === 'x' || s.platform === 'twitter');
    const effectiveProfileImage = poi.profileImage && poi.profileImage !== '' && !poi.profileImage.includes('placeholder')
        ? poi.profileImage
        : (xLink?.profileImage || (poi.socialMedia && poi.socialMedia.length > 0 ? poi.socialMedia[0].profileImage : null));

    return (
        <div className="group relative bg-white dark:bg-slate-900 rounded-[24px] shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col items-center pb-6 h-full max-w-sm mx-auto w-full border border-border">

            {/* Primary Background Header */}
            <div className="relative w-full h-[140px] bg-primary rounded-t-[24px] mb-12">
                {/* Delete button - Top Right */}
                <div className="absolute top-4 right-4 z-20">
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(poi); }}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-red-500/80 text-white transition-colors"
                        title="Delete Profile"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Profile Image (Overlapping) */}
            <div className="absolute top-[75px] w-[130px] h-[130px] p-[2px] bg-primary rounded-full z-10">
                <div className="w-full h-full rounded-full border-[3px] border-white dark:border-slate-900 bg-white dark:bg-slate-800 overflow-hidden">
                    {effectiveProfileImage ? (
                        <img
                            src={effectiveProfileImage}
                            alt={poi.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400">
                            <User className="h-16 w-16" />
                        </div>
                    )}
                </div>
            </div>

            {/* Text Content */}
            <div className="flex flex-col items-center text-center px-6 mt-4 w-full flex-1">
                <h2 className="text-[22px] font-semibold text-foreground mb-2">
                    {poi.name}
                </h2>

                <p className="text-[14px] text-muted-foreground font-normal leading-relaxed line-clamp-2 w-full max-w-[280px] min-h-[44px]">
                    {poi.briefSummary || "No summary available."}
                </p>

                <div className="mt-auto pt-4 pb-1">
                    {/* View Profile Button */}
                    <button
                        onClick={() => onView(poi)}
                        className="px-8 py-2.5 rounded-[24px] bg-primary text-primary-foreground text-[15px] font-medium border-none outline-none hover:bg-primary/90 transition-colors cursor-pointer"
                    >
                        View Profile
                    </button>
                </div>
            </div>
        </div>
    );
};

const Modal = ({ open, onClose, title, children, maxWidth = 'max-w-lg' }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-transparent" onClick={onClose} />
            <div className={`relative ${maxWidth} w-full bg-card border border-border rounded-2xl shadow-2xl animate-fade-in max-h-[90vh] flex flex-col`}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-bold text-foreground">{title}</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-4">
                    {children}
                </div>
            </div>
        </div>
    );
};

const FormInput = ({ label, value, onChange, placeholder, type = 'text', required = false }) => (
    <div className="space-y-1.5">
        <label className="text-sm font-semibold text-foreground">
            {label} {required && <span className="text-red-500">*</span>}
        </label>
        <input
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            required={required}
            className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-transparent transition-all outline-none"
        />
    </div>
);

const PersonOfInterest = () => {
    const navigate = useNavigate();
    const [pois, setPois] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [searchInput, setSearchInput] = useState(''); // Immediate input state
    const [debouncedSearch, setDebouncedSearch] = useState(''); // Delayed search state
    const [isTyping, setIsTyping] = useState(false);
    const [activeSection, setActiveSection] = useState('profiles');
    const observer = useRef();
    const limit = 50;

    // Modal states
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [addSourceModalOpen, setAddSourceModalOpen] = useState(false);
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedPoi, setSelectedPoi] = useState(null);
    const [saving, setSaving] = useState(false);
    const [initialForm, setInitialForm] = useState(null);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [discardTarget, setDiscardTarget] = useState(null); // 'create' | 'edit'
    const abortControllerRef = useRef(null);



    // Form state
    const emptyForm = {
        name: '',
        realName: '',
        aliasNames: [],
        mobileNumbers: [],
        emailIds: [],
        whatsappNumbers: [],
        lastUsedIp: '',
        currentAddress: '',
        psLimits: '',
        districtCommisionerate: '',
        softwareHardwareIdentifiers: '',
        firNo: '',
        firDetails: [],
        linkedIncidents: '',
        briefSummary: '',
        profileImage: '',
        customFields: [],
        socialMedia: [],
        previouslyDeletedProfiles: { x: [], facebook: [], instagram: [], youtube: [], whatsapp: [] }
    };
    const [form, setForm] = useState(emptyForm);

    const hasUnsavedChanges = () => {
        if (!initialForm) return false;
        return JSON.stringify(form) !== JSON.stringify(initialForm);
    };

    const handleCloseModal = (type) => {
        if (hasUnsavedChanges()) {
            setDiscardTarget(type);
            setShowDiscardConfirm(true);
        } else {
            if (type === 'create') setCreateModalOpen(false);
            if (type === 'edit') setEditModalOpen(false);
            setForm(emptyForm);
            setInitialForm(null);
            setSelectedPoi(null);
        }
    };

    const confirmDiscard = () => {
        if (discardTarget === 'create') setCreateModalOpen(false);
        if (discardTarget === 'edit') setEditModalOpen(false);
        setForm(emptyForm);
        setInitialForm(null);
        setSelectedPoi(null);
        setShowDiscardConfirm(false);
        setDiscardTarget(null);
    };

    const handleDiscardCancel = () => {
        setShowDiscardConfirm(false);
        setDiscardTarget(null);
    };

    const fetchPois = useCallback(async (pageNum = 1, isLoadMore = false) => {
        // Cancel previous request if any
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        // Create new AbortController
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            // Only set global loading for initial search/load
            if (pageNum === 1) {
                setLoading(true);
            } else {
                setLoadingMore(true);
            }

            const params = { page: pageNum, limit };
            if (debouncedSearch) params.search = debouncedSearch;

            const res = await api.get('/poi', {
                params,
                signal: controller.signal
            });

            const newPois = res.data.pois || [];
            if (isLoadMore) {
                // Prevent duplicates by checking IDs
                setPois(prev => {
                    const existingIds = new Set(prev.map(p => p._id));
                    const uniqueNewPois = newPois.filter(p => !existingIds.has(p._id));
                    return [...prev, ...uniqueNewPois];
                });
            } else {
                setPois(newPois);
            }

            setTotal(res.data.total || 0);
            setHasMore(newPois.length === limit);
            setPage(pageNum);
        } catch (err) {
            if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
                return; // Silence abort errors
            }
            toast.error('Failed to load persons of interest');
            console.error(err);
        } finally {
            // Only clear states if this controller is still the active one
            if (abortControllerRef.current === controller) {
                setLoading(false);
                setLoadingMore(false);
                abortControllerRef.current = null;
            }
        }
    }, [debouncedSearch]);

    const [loadingMore, setLoadingMore] = useState(false);

    // Handle Scroll Observation
    const lastPoiElementRef = useCallback(node => {
        if (loading || loadingMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                setPage(prevPage => {
                    const nextPage = prevPage + 1;
                    fetchPois(nextPage, true);
                    return nextPage;
                });
            }
        }, { rootMargin: '200px' }); // Trigger 200px before reaching bottom
        if (node) observer.current.observe(node);
    }, [loading, loadingMore, hasMore, fetchPois]);

    // Debounce search input
    useEffect(() => {
        if (searchInput !== debouncedSearch) setIsTyping(true);
        const timer = setTimeout(() => {
            setDebouncedSearch(searchInput);
            setIsTyping(false);
        }, 150); // 150ms debounce for "Jet Speed"
        return () => clearTimeout(timer);
    }, [searchInput, debouncedSearch]);

    // Fetch on search change
    useEffect(() => {
        setPage(1);
        fetchPois(1, false);
    }, [debouncedSearch, fetchPois]);

    const handleCreate = async () => {
        if (!form.name.trim()) {
            toast.error('Name is required');
            return;
        }
        try {
            setSaving(true);
            const payload = { ...form, realName: form.name };
            await api.post('/poi', payload);
            toast.success('Profile created successfully');
            setCreateModalOpen(false);
            setForm(emptyForm);
            setInitialForm(null);
            fetchPois();
        } catch (err) {
            toast.error('Failed to create profile');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (!form.name.trim()) {
            toast.error('Name is required');
            return;
        }
        try {
            setSaving(true);
            const payload = { ...form, realName: form.name };
            await api.put(`/poi/${selectedPoi._id}`, payload);
            toast.success('Profile updated successfully');
            setEditModalOpen(false);
            setForm(emptyForm);
            setInitialForm(null);
            setSelectedPoi(null);
            fetchPois();
        } catch (err) {
            toast.error('Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        try {
            setSaving(true);
            await api.delete(`/poi/${selectedPoi._id}`);
            toast.success('Profile deleted');
            setDeleteModalOpen(false);
            setSelectedPoi(null);
            fetchPois();
        } catch (err) {
            toast.error('Failed to delete profile');
        } finally {
            setSaving(false);
        }
    };

    const openView = (poi) => {
        navigate(`/person-of-interest/${poi._id}`, { state: { poi } });
    };
    const openEdit = (poi) => {
        setSelectedPoi(poi);
        const f = {
            name: poi.name || '',
            realName: poi.realName || '',
            aliasNames: poi.aliasNames || [],
            mobileNumbers: poi.mobileNumbers || [],
            emailIds: poi.emailIds || [],
            whatsappNumbers: poi.whatsappNumbers || [],
            lastUsedIp: poi.lastUsedIp || '',
            currentAddress: poi.currentAddress || '',
            psLimits: poi.psLimits || '',
            districtCommisionerate: poi.districtCommisionerate || '',
            softwareHardwareIdentifiers: poi.softwareHardwareIdentifiers || '',
            firNo: poi.firNo || '',
            firDetails: poi.firDetails || [],
            linkedIncidents: poi.linkedIncidents || '',
            briefSummary: poi.briefSummary || '',
            profileImage: poi.profileImage || '',
            customFields: poi.customFields || [],
            socialMedia: poi.socialMedia || [],
            previouslyDeletedProfiles: poi.previouslyDeletedProfiles || { x: [], facebook: [], instagram: [], youtube: [], whatsapp: [] }
        };
        setForm(f);
        setInitialForm(f);
        setEditModalOpen(true);
    };
    const openDelete = (poi) => { setSelectedPoi(poi); setDeleteModalOpen(true); };

    const addCustomField = () => {
        setForm(prev => ({ ...prev, customFields: [...prev.customFields, { label: '', value: '' }] }));
    };

    const removeCustomField = (idx) => {
        setForm(prev => ({
            ...prev,
            customFields: prev.customFields.filter((_, i) => i !== idx)
        }));
    };

    const updateCustomField = (idx, key, val) => {
        setForm(prev => ({
            ...prev,
            customFields: prev.customFields.map((f, i) => i === idx ? { ...f, [key]: val } : f)
        }));
    };


    const handleArrayChange = (field, idx, value) => {
        setForm(prev => {
            const arr = [...(prev[field] || [])];
            arr[idx] = value;
            return { ...prev, [field]: arr };
        });
    };
    const addArrayItem = (field) => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), ''] }));
    const removeArrayItem = (field, idx) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter((_, i) => i !== idx) }));

    // FIR helpers
    const handleFirCountChange = (val) => {
        const count = parseInt(val) || 0;
        const current = form.firDetails || [];
        if (count > current.length) {
            const newRows = Array.from({ length: count - current.length }, () => ({ firNo: '', psLimits: '', districtCommisionerate: '' }));
            setForm(prev => ({ ...prev, firDetails: [...current, ...newRows] }));
        } else {
            setForm(prev => ({ ...prev, firDetails: current.slice(0, count) }));
        }
    };
    const handleFirDetailChange = (idx, field, value) => {
        setForm(prev => {
            const arr = [...(prev.firDetails || [])];
            arr[idx] = { ...arr[idx], [field]: value };
            return { ...prev, firDetails: arr };
        });
    };
    const addFirRow = () => setForm(prev => ({ ...prev, firDetails: [...(prev.firDetails || []), { firNo: '', psLimits: '', districtCommisionerate: '' }] }));
    const removeFirRow = (idx) => setForm(prev => ({ ...prev, firDetails: (prev.firDetails || []).filter((_, i) => i !== idx) }));

    // Social media helpers
    const handleSMChange = (field, value) => setForm(prev => ({ ...prev, socialMedia: value }));

    // Previously Deleted Profiles helpers
    const handleDeletedProfileChange = (key, idx, value) => {
        setForm(prev => {
            const current = prev.previouslyDeletedProfiles?.[key] || [];
            const newArr = [...current];
            newArr[idx] = value;
            return { ...prev, previouslyDeletedProfiles: { ...prev.previouslyDeletedProfiles, [key]: newArr } };
        });
    };
    const addDeletedProfile = (key) => {
        setForm(prev => ({
            ...prev, previouslyDeletedProfiles: { ...prev.previouslyDeletedProfiles, [key]: [...(prev.previouslyDeletedProfiles?.[key] || []), ''] }
        }));
    };
    const removeDeletedProfile = (key, idx) => {
        setForm(prev => ({
            ...prev, previouslyDeletedProfiles: { ...prev.previouslyDeletedProfiles, [key]: (prev.previouslyDeletedProfiles?.[key] || []).filter((_, i) => i !== idx) }
        }));
    };

    const renderSocialTable = (platform, icon, label, color) => {
        const allSM = form.socialMedia || [];
        const entries = allSM.map((s, i) => ({ ...s, _i: i })).filter(s => s.platform === platform);
        const updateSM = (gi, field, value) => { const arr = [...allSM]; arr[gi] = { ...arr[gi], [field]: value }; setForm(p => ({ ...p, socialMedia: arr })); };
        const removeRow = (gi) => setForm(p => ({ ...p, socialMedia: allSM.filter((_, i) => i !== gi) }));
        const addRow = () => setForm(p => ({ ...p, socialMedia: [...allSM, { platform, handle: '', followerCount: '', createdDate: '' }] }));

        return (
            <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-[13px] font-semibold text-slate-600">{label}</span>
                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                </div>
                {entries.length > 0 ? (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full table-fixed border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left">Handle</th>
                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Followers</th>
                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Created</th>
                                    <th className="w-7" />
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(h => (
                                    <tr key={h._i} className="border-b border-slate-100 last:border-b-0">
                                        <td className="py-1 px-2 align-middle break-all">
                                            <input value={h.handle || ''} onChange={e => updateSM(h._i, 'handle', e.target.value)} className={`w-full bg-transparent text-[12px] ${color} outline-none`} placeholder="@handle" />
                                        </td>
                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                            <input value={h.followerCount || ''} onChange={e => updateSM(h._i, 'followerCount', e.target.value)} className="w-full bg-transparent text-[12px] text-slate-700 outline-none" placeholder="e.g. 10K" />
                                        </td>
                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                            <input value={h.createdDate || ''} onChange={e => updateSM(h._i, 'createdDate', e.target.value)} className="w-full bg-transparent text-[12px] text-slate-700 outline-none" placeholder="DD/MM/YYYY" />
                                        </td>
                                        <td className="py-1 text-center align-middle">
                                            <button onClick={() => removeRow(h._i)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-3.5 h-3.5" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="py-1.5 px-2 border-t border-slate-200 bg-slate-50/30">
                            <button onClick={addRow} className={`flex items-center gap-1 text-[11px] font-semibold ${color} hover:opacity-80`}><PlusCircle className="w-3.5 h-3.5" /> Add {label}</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between">
                        <span className="text-[12px] text-slate-400 italic">No {label.toLowerCase()} linked</span>
                        <button onClick={addRow} className={`flex items-center gap-1 text-[11px] font-semibold ${color} hover:opacity-80`}><PlusCircle className="w-3.5 h-3.5" /> Add</button>
                    </div>
                )}
            </div>
        );
    };

    const renderFormFields = () => {
        // X icon SVG
        const XIcon = <svg viewBox="0 0 24 24" className="w-4 h-4 text-slate-900" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;

        return (
            <div className="flex flex-col h-[70vh] overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-1 bg-white custom-scrollbar">
                    {/* Real Name */}
                    <div className="flex items-center min-h-[36px]">
                        <div className="w-1/2 shrink-0"><span className="text-[13px] font-semibold text-slate-500">Real Name <span className="text-red-500">*</span></span></div>
                        <div className="w-1/2 flex items-center">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => {
                                    const val = e.target.value;
                                    setForm(p => ({ ...p, name: val, realName: val }));
                                }}
                                className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5 font-semibold"
                                placeholder="Full real name"
                            />
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />



                    {/* Brief Summary */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Brief Summary</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1">
                                <textarea value={form.briefSummary || ''} onChange={e => { if (e.target.value.length <= 500) setForm(p => ({ ...p, briefSummary: e.target.value })); }} maxLength={500} rows={3} className="w-full bg-transparent border border-slate-200 rounded-md text-[13px] text-slate-700 focus:border-blue-500 outline-none p-2 resize-none" placeholder="Brief summary (max 500 chars)..." />
                                <div className="text-[10px] text-slate-400 text-right font-mono">{(form.briefSummary?.length || 0)}/500</div>
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Alias Names */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1">
                            <span className="text-[13px] font-semibold text-slate-500">Alias Names</span>
                            <div className="text-[10px] text-slate-400 italic">(in real world / social media)</div>
                        </div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1 space-y-1.5">
                                {(form.aliasNames || []).map((alias, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <input type="text" value={alias} onChange={e => handleArrayChange('aliasNames', idx, e.target.value)} className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none" />
                                        <button onClick={() => removeArrayItem('aliasNames', idx)} className="text-red-400 hover:text-red-600"><XCircle className="w-4 h-4" /></button>
                                    </div>
                                ))}
                                <button onClick={() => addArrayItem('aliasNames')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1"><PlusCircle className="w-3.5 h-3.5" /> Add Alias</button>
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Mobile Number */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Mobile Number</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1 space-y-1.5">
                                {(form.mobileNumbers || []).map((num, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <input type="text" value={num} onChange={e => handleArrayChange('mobileNumbers', idx, e.target.value)} className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none" placeholder="+91 XXXXX XXXXX" />
                                        <button onClick={() => removeArrayItem('mobileNumbers', idx)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-4 h-4" /></button>
                                    </div>
                                ))}
                                <button onClick={() => addArrayItem('mobileNumbers')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1"><PlusCircle className="w-3.5 h-3.5" /> Add Number</button>
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Email IDs */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Email IDs</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1 space-y-1.5">
                                {(form.emailIds || []).map((email, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <input type="text" value={email} onChange={e => handleArrayChange('emailIds', idx, e.target.value)} className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none" placeholder="example@email.com" />
                                        <button onClick={() => removeArrayItem('emailIds', idx)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-4 h-4" /></button>
                                    </div>
                                ))}
                                <button onClick={() => addArrayItem('emailIds')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1"><PlusCircle className="w-3.5 h-3.5" /> Add Email</button>
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Current Address */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Current Address</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1">
                                <textarea value={form.currentAddress || ''} onChange={e => setForm(p => ({ ...p, currentAddress: e.target.value }))} rows={3} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar" placeholder="Full address..." />
                            </div>
                        </div>
                    </div>

                    {/* PS Limits */}
                    <div className="flex items-center min-h-[36px]">
                        <div className="w-1/2 shrink-0"><span className="text-[13px] font-semibold text-slate-500">PS Limits</span></div>
                        <div className="w-1/2 flex items-center">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <input type="text" value={form.psLimits || ''} onChange={e => setForm(p => ({ ...p, psLimits: e.target.value }))} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5" placeholder="PS limits..." />
                        </div>
                    </div>

                    {/* District / Commissionerate */}
                    <div className="flex items-center min-h-[36px]">
                        <div className="w-1/2 shrink-0"><span className="text-[13px] font-semibold text-slate-500">District / Commissionerate</span></div>
                        <div className="w-1/2 flex items-center">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <input type="text" value={form.districtCommisionerate || ''} onChange={e => setForm(p => ({ ...p, districtCommisionerate: e.target.value }))} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5" placeholder="District / Commissionerate..." />
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Last Used IP */}
                    <div className="flex items-center min-h-[36px]">
                        <div className="w-1/2 shrink-0"><span className="text-[13px] font-semibold text-slate-500">Last Used IP</span></div>
                        <div className="w-1/2 flex items-center">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <input type="text" value={form.lastUsedIp || ''} onChange={e => setForm(p => ({ ...p, lastUsedIp: e.target.value }))} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 font-mono focus:border-blue-500 outline-none pb-0.5" placeholder="0.0.0.0" />
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Software / Hardware Identifiers */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Software / Hardware Identifiers</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1">
                                <textarea value={form.softwareHardwareIdentifiers || ''} onChange={e => setForm(p => ({ ...p, softwareHardwareIdentifiers: e.target.value }))} rows={3} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar" placeholder="IMEI, MAC, Device Model..." />
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />

                    {/* Total FIRs Against */}
                    <div className="flex items-center min-h-[36px]">
                        <div className="w-1/2 shrink-0"><span className="text-[13px] font-semibold text-slate-500">Total FIRs Against</span></div>
                        <div className="w-1/2 flex items-center">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <input type="number" min="0" value={(form.firDetails || []).length || ''} onChange={e => handleFirCountChange(e.target.value)} className="w-20 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5 text-center" placeholder="0" />
                        </div>
                    </div>

                    {/* FIR Details Table */}
                    {(form.firDetails && form.firDetails.length > 0) && (
                        <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full table-fixed border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="w-10 py-2 px-2 text-[11px] font-bold text-slate-400 text-center">#</th>
                                        <th className="w-[20%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200">FIR No</th>
                                        <th className="w-[30%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200">PS Limits</th>
                                        <th className="w-auto py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200 whitespace-normal leading-tight">District / Commissionerate</th>
                                        <th className="w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.firDetails.map((fir, idx) => (
                                        <tr key={idx} className={`border-b border-slate-100 last:border-b-0 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                                            <td className="w-8 py-2 px-2 text-[12px] text-slate-400 text-center font-medium align-top">{idx + 1}</td>
                                            <td className="py-1.5 px-2 border-l border-slate-200 align-top">
                                                <input type="text" value={fir.firNo} onChange={e => handleFirDetailChange(idx, 'firNo', e.target.value)} className="w-full bg-transparent text-[12px] text-slate-700 outline-none" placeholder="FIR No..." />
                                            </td>
                                            <td className="py-1.5 px-2 border-l border-slate-200 align-top">
                                                <input type="text" value={fir.psLimits} onChange={e => handleFirDetailChange(idx, 'psLimits', e.target.value)} className="w-full bg-transparent text-[12px] text-slate-700 outline-none" placeholder="PS limits..." />
                                            </td>
                                            <td className="py-1.5 px-2 border-l border-slate-200 align-top">
                                                <input type="text" value={fir.districtCommisionerate} onChange={e => handleFirDetailChange(idx, 'districtCommisionerate', e.target.value)} className="w-full bg-transparent text-[12px] text-slate-700 outline-none" placeholder="District..." />
                                            </td>
                                            <td className="w-8 py-1.5 text-center align-top">
                                                <button onClick={() => removeFirRow(idx)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-3.5 h-3.5" /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="py-1.5 px-3 border-t border-slate-200 bg-slate-50/30">
                                <button onClick={addFirRow} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"><PlusCircle className="w-3.5 h-3.5" /> Add Row</button>
                            </div>
                        </div>
                    )}
                    <div className="h-px bg-slate-100" />

                    {/* Linked Incidents */}
                    <div className="flex items-start min-h-[36px]">
                        <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">Linked Incidents</span></div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                            <div className="flex-1">
                                <textarea value={form.linkedIncidents || ''} onChange={e => setForm(p => ({ ...p, linkedIncidents: e.target.value }))} rows={3} className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar" placeholder="Linked incidents..." />
                            </div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100" />
                    <div className="pt-2 space-y-4">
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Social Media Profiles</div>
                        {renderSocialTable('x', XIcon, 'X Profile', 'text-sky-600')}
                        <div className="h-px bg-slate-50" />
                        {renderSocialTable('facebook', <Facebook className="w-4 h-4 text-blue-600" />, 'Facebook Profile', 'text-blue-600')}
                        <div className="h-px bg-slate-50" />
                        {renderSocialTable('instagram', <Instagram className="w-4 h-4 text-pink-500" />, 'Instagram Profile', 'text-pink-600')}
                        <div className="h-px bg-slate-50" />
                        {renderSocialTable('youtube', <Youtube className="w-4 h-4 text-red-500" />, 'YouTube Profile', 'text-red-600')}
                        <div className="h-px bg-slate-50" />

                        {/* WhatsApp */}
                        <div className="flex items-start min-h-[36px] py-1">
                            <div className="w-1/2 shrink-0 pt-0.5 flex items-center gap-2">
                                <MessageCircle className="w-4 h-4 text-green-500" />
                                <span className="text-[13px] font-semibold text-slate-600">WhatsApp</span>
                            </div>
                            <div className="w-1/2 flex items-start">
                                <span className="text-[13px] text-slate-400 mr-2 pt-0.5">:</span>
                                <div className="flex-1 pt-0.5 space-y-1">
                                    {(form.whatsappNumbers || ['']).map((num, idx) => (
                                        <div key={idx} className="flex items-center gap-1">
                                            <input type="text" value={num} onChange={e => handleArrayChange('whatsappNumbers', idx, e.target.value)} className="flex-1 bg-transparent border-b border-slate-200 text-[13px] text-slate-700 focus:border-green-500 outline-none pb-0.5" placeholder="+91 XXXXX XXXXX" />
                                            {(form.whatsappNumbers || []).length > 1 && (
                                                <button onClick={() => removeArrayItem('whatsappNumbers', idx)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-3.5 h-3.5" /></button>
                                            )}
                                        </div>
                                    ))}
                                    <button onClick={() => addArrayItem('whatsappNumbers')} className="flex items-center gap-1 text-[11px] font-semibold text-green-600 hover:text-green-700 mt-1"><PlusCircle className="w-3.5 h-3.5" /> Add Number</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-slate-100 mt-4 mb-2" />

                    <div className="pt-2">
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Previously Deleted Profiles</div>
                        {[
                            { key: 'x', label: 'X Profiles' },
                            { key: 'facebook', label: 'Face Book' },
                            { key: 'instagram', label: 'Instagram' },
                            { key: 'youtube', label: 'Youtube' },
                            { key: 'whatsapp', label: 'Whatsapp' }
                        ].map(({ key, label }) => {
                            const profiles = form.previouslyDeletedProfiles?.[key] || [];
                            return (
                                <div key={key} className="flex items-start min-h-[36px] mb-1">
                                    <div className="w-1/2 shrink-0 pt-1"><span className="text-[13px] font-semibold text-slate-500">{label}</span></div>
                                    <div className="w-1/2 flex items-start">
                                        <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                        <div className="flex-1 space-y-1">
                                            {(profiles.length > 0 ? profiles : ['']).map((val, idx) => (
                                                <div key={idx} className="flex items-center gap-1">
                                                    <input type="text" value={val} onChange={e => handleDeletedProfileChange(key, idx, e.target.value)} className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5" placeholder="Unknown" />
                                                    {profiles.length > 1 && (
                                                        <button onClick={() => removeDeletedProfile(key, idx)} className="text-red-400 hover:text-red-600"><MinusCircle className="w-3.5 h-3.5" /></button>
                                                    )}
                                                </div>
                                            ))}
                                            <button onClick={() => addDeletedProfile(key)} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1"><PlusCircle className="w-3.5 h-3.5" /> Add Field</button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="h-px bg-slate-100 mt-4 mb-2" />

                    <div className="pt-2 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Additional Fields</div>
                            <button type="button" onClick={addCustomField} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"><PlusCircle className="h-3.5 w-3.5" /> Add Field</button>
                        </div>
                        {form.customFields.length === 0 && <p className="text-xs text-slate-400 italic">No additional fields.</p>}
                        {form.customFields.map((field, idx) => (
                            <div key={idx} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                                <div className="flex-1 space-y-2">
                                    <input type="text" value={field.label} onChange={e => updateCustomField(idx, 'label', e.target.value)} placeholder="Field name" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-foreground text-xs placeholder:text-muted-foreground focus:ring-1 focus:ring-ring outline-none" />
                                    <input type="text" value={field.value} onChange={e => updateCustomField(idx, 'value', e.target.value)} placeholder="Field value" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-foreground text-xs placeholder:text-muted-foreground focus:ring-1 focus:ring-ring outline-none" />
                                </div>
                                <button onClick={() => removeCustomField(idx)} className="p-1 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors mt-1"><MinusCircle className="h-4 w-4" /></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-[1600px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg">
                        <UserSearch className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">Profiles</h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            <div className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-300 shadow-sm border ${loading || isTyping ? 'bg-primary/20 text-primary border-primary/30 animate-pulse scale-105' : 'bg-primary/10 text-primary border-primary/20'}`}>
                                {isTyping ? (
                                    <span className="flex items-center gap-1.5">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Typing...
                                    </span>
                                ) : loading && pois.length === 0 ? (
                                    <span className="flex items-center gap-1.5">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Searching...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5">
                                        <Search className="h-3 w-3 opacity-70" />
                                        {total} profile{total !== 1 ? 's' : ''} {debouncedSearch && 'found'}
                                    </span>
                                )}
                            </div>
                            {(loading || isTyping) && pois.length > 0 && (
                                <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em] animate-pulse">
                                    {isTyping ? 'Syncing...' : 'Fetching...'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                {activeSection === 'profiles' && (
                    <button
                        onClick={() => { setAddSourceModalOpen(true); }}
                        data-testid="add-poi-btn"
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
                    >
                        <Plus className="h-4 w-4" /> Add New Profile
                    </button>
                )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="flex flex-wrap gap-2">
                    {[
                        { id: 'profiles', label: 'Profiles', icon: UserSearch },
                        { id: 'handles', label: 'Profiles Live Monitor', icon: Monitor }
                    ].map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSection === section.id;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                onClick={() => setActiveSection(section.id)}
                                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${isActive
                                    ? 'bg-slate-900 text-white shadow-md'
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                    }`}
                            >
                                <Icon className="h-4 w-4" />
                                <span>{section.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeSection === 'profiles' ? (
                <>
                    {/* Search Bar */}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Search profiles by name, number, address, handle..."
                                data-testid="poi-search-input"
                                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-transparent transition-all outline-none"
                            />
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className={`relative transition-all duration-300 ${loading && pois.length > 0 ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                        {loading && pois.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <div className="relative">
                                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                </div>
                                <p className="text-sm font-medium text-muted-foreground animate-pulse">Scanning database...</p>
                            </div>
                        ) : pois.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                                <div className="p-4 rounded-full bg-muted/50">
                                    <UserSearch className="h-12 w-12 text-muted-foreground" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-foreground">No persons of interest found</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {debouncedSearch
                                            ? 'Try adjusting your search criteria.'
                                            : 'Click "Add Profile" to create the first entry.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
                                    {pois.map((poi) => (
                                        <POICard
                                            key={poi._id}
                                            poi={poi}
                                            onView={openView}
                                            onEdit={openEdit}
                                            onDelete={openDelete}
                                        />
                                    ))}
                                </div>

                                {/* Infinite Scroll Sentinel & Loader */}
                                <div ref={lastPoiElementRef} className="py-12 flex flex-col items-center justify-center">
                                    {hasMore ? (
                                        <div className="flex flex-col items-center gap-4 py-4 px-8 rounded-2xl bg-muted/30 border border-border/50 backdrop-blur-sm">
                                            <div className="flex items-center gap-3">
                                                <div className="relative h-6 w-6">
                                                    <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                                                    <Loader2 className={`h-6 w-6 animate-spin text-primary ${loadingMore ? 'opacity-100' : 'opacity-40'}`} />
                                                </div>
                                                <span className={`text-sm font-semibold tracking-wide transition-opacity duration-300 ${loadingMore ? 'text-primary' : 'text-muted-foreground opacity-60'}`}>
                                                    {loadingMore ? 'Syncing next batch...' : 'Scroll to see more'}
                                                </span>
                                            </div>
                                            <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
                                                <div className={`h-full bg-primary transition-all duration-1000 ${loadingMore ? 'w-full' : 'w-0'}`} />
                                            </div>
                                        </div>
                                    ) : (
                                        total > 0 && null
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-5 flex items-center gap-3">
                        <div className="rounded-xl bg-police-navy/10 p-3 text-police-navy">
                            <Monitor className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-foreground">Profiles Live Monitor</h2>
                            <p className="text-sm text-muted-foreground">Manage and monitor social media handles from the Profile area.</p>
                        </div>
                    </div>
                    <UnifiedMonitors embedded />
                </div>
            )}

            <AddSourceModal
                open={addSourceModalOpen}
                onClose={() => setAddSourceModalOpen(false)}
                onSuccess={(newSource) => {
                    toast.success('Source added. A tracking profile has been generated in the background.');
                    setAddSourceModalOpen(false);
                    fetchPois();
                }}
            />

            <Modal open={createModalOpen} onClose={() => handleCloseModal('create')} title="Add Person of Interest" maxWidth="max-w-2xl">
                {renderFormFields()}
                <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border">
                    <button
                        onClick={() => handleCloseModal('create')}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={saving}
                        data-testid="poi-create-submit"
                        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Create Profile
                    </button>
                </div>
            </Modal>

            <Modal open={viewModalOpen} onClose={() => { setViewModalOpen(false); setSelectedPoi(null); }} title="Profile Details" maxWidth="max-w-md">
                {selectedPoi && (
                    <div className="space-y-5">
                        <div className="flex flex-col items-center text-center">
                            {selectedPoi.profileImage ? (
                                <img src={selectedPoi.profileImage} alt={selectedPoi.name} className="w-24 h-24 rounded-full object-cover shadow-lg ring-2 ring-border" />
                            ) : (
                                <AvatarPlaceholder name={selectedPoi.name} size="lg" />
                            )}
                            <h3 className="mt-3 text-xl font-bold text-foreground">{selectedPoi.name}</h3>
                            <span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase ${selectedPoi.status === 'active'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                }`}>
                                {selectedPoi.status}
                            </span>
                        </div>

                        <div className="space-y-3 text-sm">
                            {selectedPoi.lastUsedIp && (
                                <div className="flex justify-between py-2 border-b border-border/50">
                                    <span className="text-muted-foreground font-medium">Last Used IP</span>
                                    <span className="text-foreground font-semibold font-mono text-xs">{selectedPoi.lastUsedIp}</span>
                                </div>
                            )}
                            {selectedPoi.firNo && (
                                <div className="flex justify-between py-2 border-b border-border/50">
                                    <span className="text-muted-foreground font-medium">FIR No</span>
                                    <span className="text-foreground font-semibold">{selectedPoi.firNo}</span>
                                </div>
                            )}
                            {selectedPoi.briefSummary && (
                                <div className="py-2 border-b border-border/50">
                                    <span className="text-muted-foreground font-medium block mb-1">Brief Summary</span>
                                    <p className="text-foreground text-xs leading-relaxed">{selectedPoi.briefSummary}</p>
                                </div>
                            )}

                            {/* Custom fields */}
                            {selectedPoi.customFields && selectedPoi.customFields.length > 0 && (
                                <>
                                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider pt-2">Additional Information</h4>
                                    {selectedPoi.customFields.map((f, idx) => (
                                        <div key={idx} className="flex justify-between py-2 border-b border-border/50">
                                            <span className="text-muted-foreground font-medium">{f.label}</span>
                                            <span className="text-foreground font-semibold">{f.value}</span>
                                        </div>
                                    ))}
                                </>
                            )}

                            <div className="flex justify-between py-2 text-xs text-muted-foreground">
                                <span>Created</span>
                                <span>{new Date(selectedPoi.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal open={editModalOpen} onClose={() => handleCloseModal('edit')} title="Edit Profile" maxWidth="max-w-2xl">
                {renderFormFields()}
                <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border">
                    <button
                        onClick={() => handleCloseModal('edit')}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleUpdate}
                        disabled={saving}
                        data-testid="poi-edit-submit"
                        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        Save Changes
                    </button>
                </div>
            </Modal>

            <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setSelectedPoi(null); }} title="Delete Profile" maxWidth="max-w-sm">
                <div className="text-center space-y-4">
                    <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center">
                        <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                        <p className="text-sm text-foreground font-medium">
                            Are you sure you want to delete <strong>{selectedPoi?.name}</strong>?
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">This action cannot be undone.</p>
                    </div>
                    <div className="flex items-center justify-center gap-3 pt-2">
                        <button
                            onClick={() => { setDeleteModalOpen(false); setSelectedPoi(null); }}
                            className="px-4 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={saving}
                            data-testid="poi-delete-confirm"
                            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Delete
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Discard Changes Confirmation */}
            <Modal open={showDiscardConfirm} onClose={handleDiscardCancel} title="Discard Changes?" maxWidth="max-w-sm">
                <div className="text-center space-y-5 pb-2 py-2">
                    <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center border border-amber-100 shadow-sm">
                        <AlertTriangle className="h-7 w-7 text-amber-500" />
                    </div>
                    <div className="space-y-1.5 px-2">
                        <p className="text-[16px] text-slate-900 font-bold">
                            Discard Unsaved Changes?
                        </p>
                        <p className="text-[13px] text-slate-500 leading-relaxed font-medium">
                            You have modified this profile. Leaving now will permanently discard all your changes.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 pt-3">
                        <button
                            onClick={confirmDiscard}
                            className="w-full py-2.5 rounded-xl bg-amber-600 text-white text-[14px] font-bold hover:bg-amber-700 transition-all shadow-md active:scale-[0.98]"
                        >
                            Discard Changes
                        </button>
                        <button
                            onClick={handleDiscardCancel}
                            className="w-full py-2.5 rounded-xl bg-slate-50 text-slate-600 text-[14px] font-bold hover:bg-slate-100 transition-all border border-slate-200"
                        >
                            Keep Editing
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PersonOfInterest;
