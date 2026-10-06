import React, { useState, useEffect } from 'react';
import api from '../lib/api'; // Use configured API instance
import {
    Plus, Search, Shield, AlertTriangle, CheckCircle,
    Pencil, Trash2, X, Save, AlertOctagon, Info, Globe, Gavel, Scale, ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * Enhanced Policy Manager V3
 * - Clean Slide-over UI (No standard modals)
 * - Meta Grouping (FB + Insta)
 * - Simplified Legal Fields (Section + Description)
 */
const PolicyManager = () => {
    const [policies, setPolicies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState(null);
    const [originalData, setOriginalData] = useState(null); // For dirty check
    const [activeTab, setActiveTab] = useState('basic');

    // Form State
    const [formData, setFormData] = useState({
        category_id: '',
        definition: '',
        severity_level: 'High', // Default to High, hidden from UI
        keywords: [],
        legal_sections: [],
        meta_policies: [], // Virtual field for UI
        x_policies: [],    // Virtual field for UI
        youtube_policies: [] // Virtual field for UI
    });

    useEffect(() => {
        fetchPolicies();
    }, []);

    const fetchPolicies = async () => {
        try {
            const res = await api.get('/policies');
            if (res.data.success) {
                setPolicies(res.data.data);
            }
        } catch (error) {
            toast.error('Failed to load policies');
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenPanel = (policy = null) => {
        setActiveTab('basic');
        if (policy) {
            setEditingPolicy(policy);

            // Merge FB and Insta into Meta for UI
            const meta = [
                ...(policy.platform_policies?.facebook || []),
                ...(policy.platform_policies?.instagram || [])
            ].filter((v, i, a) => a.findIndex(t => t.name === v.name) === i); // Dedupe by name

            const initialData = {
                category_id: policy.category_id,
                definition: policy.definition,
                severity_level: policy.severity_level,
                keywords: policy.keywords ? JSON.parse(JSON.stringify(policy.keywords)) : [],
                legal_sections: policy.legal_sections ? JSON.parse(JSON.stringify(policy.legal_sections)) : [],
                meta_policies: JSON.parse(JSON.stringify(meta)),
                x_policies: policy.platform_policies?.x ? JSON.parse(JSON.stringify(policy.platform_policies.x)) : [],
                youtube_policies: policy.platform_policies?.youtube ? JSON.parse(JSON.stringify(policy.platform_policies.youtube)) : []
            };
            setFormData(initialData);
            setOriginalData(JSON.parse(JSON.stringify(initialData))); // Deep copy for dirty check
        } else {
            setEditingPolicy(null);
            const initialData = {
                category_id: '',
                definition: '',
                severity_level: 'High',
                keywords: [],
                legal_sections: [],
                meta_policies: [],
                x_policies: [],
                youtube_policies: []
            };
            setFormData(initialData);
            setOriginalData(initialData);
        }
        setIsPanelOpen(true);
    };





    // --- Helper Functions ---

    const addLegalSection = () => {
        setFormData({
            ...formData,
            legal_sections: [...formData.legal_sections, { id: '', code: '', title: '', url: '' }]
        });
    };

    const removeLegalSection = (index) => {
        const newSections = [...formData.legal_sections];
        newSections.splice(index, 1);
        setFormData({ ...formData, legal_sections: newSections });
    };

    const updateLegalSection = (index, field, value) => {
        const newSections = [...formData.legal_sections];
        newSections[index][field] = value;
        setFormData({ ...formData, legal_sections: newSections });
    };

    const addPlatformPolicy = (platformField) => {
        setFormData({
            ...formData,
            [platformField]: [...formData[platformField], { id: '', name: '', url: '' }]
        });
    };

    const removePlatformPolicy = (platformField, index) => {
        const newPolicies = [...formData[platformField]];
        newPolicies.splice(index, 1);
        setFormData({ ...formData, [platformField]: newPolicies });
    };

    const updatePlatformPolicy = (platformField, index, field, value) => {
        const newPolicies = [...formData[platformField]];
        newPolicies[index][field] = value;
        setFormData({ ...formData, [platformField]: newPolicies });
    };

    const filteredPolicies = policies.filter(p =>
        p.category_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.definition.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const isDirty = React.useMemo(() => {
        return JSON.stringify(formData) !== JSON.stringify(originalData);
    }, [formData, originalData]);

    const getSeverityColor = (level) => {
        const norm = level.toLowerCase();
        if (norm === 'high' || norm === 'critical') return 'bg-red-500/10 text-red-600 border-red-500/20';
        if (norm === 'medium') return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    };

    // --- Derived State for Reusable Components ---
    // Extract unique Legal Sections & Platform Policies from existing data
    const existingLegalSections = React.useMemo(() => {
        const map = new Map();
        policies.forEach(p => {
            p.legal_sections?.forEach(s => {
                if (s.code && !map.has(s.code)) map.set(s.code, s);
            });
        });
        return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    }, [policies]);

    const existingMetaPolicies = React.useMemo(() => {
        const map = new Map();
        policies.forEach(p => {
            [...(p.platform_policies?.facebook || []), ...(p.platform_policies?.instagram || [])].forEach(rule => {
                if (rule.name && !map.has(rule.name)) map.set(rule.name, rule);
            });
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [policies]);

    const existingXPolicies = React.useMemo(() => {
        const map = new Map();
        policies.forEach(p => {
            p.platform_policies?.x?.forEach(rule => {
                if (rule.name && !map.has(rule.name)) map.set(rule.name, rule);
            });
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [policies]);

    const existingYoutubePolicies = React.useMemo(() => {
        const map = new Map();
        policies.forEach(p => {
            p.platform_policies?.youtube?.forEach(rule => {
                if (rule.name && !map.has(rule.name)) map.set(rule.name, rule);
            });
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [policies]);

    // Quick Add Handlers
    const handleQuickAddLegal = (e) => {
        const code = e.target.value;
        if (!code) return;
        const section = existingLegalSections.find(s => s.code === code);
        if (section) {
            setFormData(prev => ({
                ...prev,
                legal_sections: [...prev.legal_sections, { ...section, id: '' }] // New instance
            }));
        }
        e.target.value = ''; // Reset select
    };

    const handleQuickAddPlatform = (field, list, e) => {
        const name = e.target.value;
        if (!name) return;
        const rule = list.find(r => r.name === name);
        if (rule) {
            setFormData(prev => ({
                ...prev,
                [field]: [...prev[field], { ...rule, id: '' }]
            }));
        }
        e.target.value = '';
    };

    // --- Confirmation Modal State ---
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null,
        isDelete: false
    });

    const openConfirm = (title, message, onConfirm, isDelete = false) => {
        setConfirmModal({ isOpen: true, title, message, onConfirm, isDelete });
    };

    const closeConfirm = () => {
        setConfirmModal({ ...confirmModal, isOpen: false });
    };

    const handleConfirmAction = () => {
        if (confirmModal.onConfirm) confirmModal.onConfirm();
        closeConfirm();
    };

    const handleDeleteClick = (id) => {
        openConfirm(
            'Delete Policy',
            'Are you sure you want to delete this policy? This action cannot be undone and will affect AI analysis immediately.',
            () => handleDelete(id),
            true
        );
    };

    const handleSaveClick = (e) => {
        e.preventDefault();
        // For updates, we can just save without confirmation, or add one if desired.
        // User asked for "updating and deleting add clean dialogue boxes".
        // Let's add it for Update to be safe, but typically save is direct.
        // Given the request, asking for update confirmation too.
        if (editingPolicy) {
            openConfirm(
                'Update Policy',
                'Are you sure you want to update this policy definition?',
                () => executeSubmit(),
                false
            );
        } else {
            executeSubmit();
        }
    };

    const executeSubmit = async () => {
        try {
            if (!formData.category_id || !formData.definition) {
                toast.error('Category Name and Definition are required');
                return;
            }

            // Prepare Payload
            const payload = {
                category_id: formData.category_id.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''), // Always sanitize
                definition: formData.definition,
                severity_level: formData.severity_level,
                keywords: formData.keywords,
                legal_sections: formData.legal_sections,
                platform_policies: {
                    x: formData.x_policies,
                    youtube: formData.youtube_policies,
                    // Split Meta back to FB and Insta
                    facebook: formData.meta_policies,
                    instagram: formData.meta_policies
                }
            };

            if (editingPolicy) {
                await api.put(`/policies/${editingPolicy._id}`, payload);
                toast.success('Policy updated successfully');
            } else {
                await api.post('/policies', payload);
                toast.success('Policy created successfully');
            }
            setIsPanelOpen(false);
            fetchPolicies();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Operation failed');
        }
    };

    // Replace original handlers
    const handleDelete = async (id) => {
        try {
            await api.delete(`/policies/${id}`);
            toast.success('Policy deleted successfully');
            fetchPolicies();
            if (editingPolicy && editingPolicy._id === id) setIsPanelOpen(false);
        } catch (error) {
            toast.error('Failed to delete policy');
        }
    };

    const handleSubmit = handleSaveClick;

    return (
        <div className="space-y-8 relative min-h-screen p-6 bg-background/50">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent flex items-center gap-2">
                        <Shield className="h-8 w-8 text-primary" />
                        Policy Manager
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1 max-w-lg">
                        Define and manage AI content moderation policies, legal frameworks, and platform-specific enforcement rules.
                    </p>
                </div>
                <Button onClick={() => handleOpenPanel()} className="shadow-lg shadow-primary/20">
                    <Plus className="h-4 w-4 mr-2" />
                    New Policy
                </Button>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                <Input
                    placeholder="Search policies..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 bg-card/50 backdrop-blur-sm"
                />
            </div>

            {/* Grid */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
                </div>
            ) : filteredPolicies.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-border rounded-xl bg-muted/10">
                    <p className="text-muted-foreground">No policies found. Create your first policy.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredPolicies.map(policy => (
                        <div key={policy._id} onClick={() => handleOpenPanel(policy)} className="group bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col relative overflow-hidden">
                            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-0 translate-x-2 duration-300">
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <div className={`px-2.5 py-1 rounded-md text-xs font-semibold bg-secondary text-secondary-foreground border border-border/50`}>
                                    {policy.category_id.replace(/_/g, ' ')}
                                </div>
                            </div>

                            <p className="text-sm text-muted-foreground line-clamp-3 mb-6 flex-1 leading-relaxed">
                                {policy.definition}
                            </p>

                            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground border-t border-border pt-4 mt-auto">
                                <div className="flex items-center gap-2">
                                    <Scale className="h-4 w-4 text-primary/70" />
                                    <span>{policy.legal_sections?.length || 0} Legal Ref</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Globe className="h-4 w-4 text-primary/70" />
                                    <span>
                                        {((policy.platform_policies?.x?.length || 0) +
                                            (policy.platform_policies?.youtube?.length || 0) +
                                            (policy.platform_policies?.facebook?.length || 0))} Rules
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Slide-over Panel (Premium UI) */}
            {isPanelOpen && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/40 transition-opacity duration-300" onClick={() => setIsPanelOpen(false)} />

                    {/* Panel */}
                    <div className="relative w-full max-w-2xl bg-background h-full shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right duration-300">
                        {/* Header */}
                        <div className="px-8 py-5 border-b border-border flex justify-between items-center bg-muted/20">
                            <div>
                                <h2 className="text-xl font-bold tracking-tight">
                                    {editingPolicy ? `Edit Policy` : 'New Policy'}
                                </h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {editingPolicy ? editingPolicy.category_id.replace(/_/g, ' ') : 'Configure AI definition and enforcement'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {editingPolicy && (
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        onClick={() => handleDeleteClick(editingPolicy._id)}
                                        title="Delete Policy"
                                        className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive bg-transparent text-muted-foreground"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => setIsPanelOpen(false)} className="h-8 w-8">
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-border px-8 space-x-6 sticky top-0 bg-background/95 backdrop-blur z-10 pt-2">
                            {['basic', 'legal', 'platform'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-all duration-200 ${activeTab === tab
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    {tab === 'basic' && 'General'}
                                    {tab === 'legal' && 'Legal Framework'}
                                    {tab === 'platform' && 'Platform Rules'}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-8 bg-muted/5 scrollbar-thin scrollbar-thumb-border">
                            <form id="panelForm" onSubmit={handleSubmit} className="space-y-8 max-w-xl mx-auto">

                                {activeTab === 'basic' && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div className="space-y-3">
                                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Category Name</label>
                                            <Input
                                                value={formData.category_id}
                                                onChange={e => setFormData({ ...formData, category_id: e.target.value })}
                                                placeholder="e.g. Hate Speech"
                                                className="font-medium"
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">AI Definition</label>
                                            <Textarea
                                                value={formData.definition}
                                                onChange={e => setFormData({ ...formData, definition: e.target.value })}
                                                placeholder="Describe exactly what content falls into this category..."
                                                className="min-h-[200px] leading-relaxed"
                                            />
                                            <p className="text-[0.8rem] text-muted-foreground">
                                                This definition drives the AI's understanding. Be specific.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'legal' && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {!formData.category_id && (
                                            <div className="flex items-center gap-2 p-3 text-sm text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                                <AlertOctagon className="h-4 w-4" />
                                                <span>Please enter a <strong>Category Name</strong> in the General tab first.</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center pb-2 border-b border-border/50">
                                            <div className="flex items-center gap-2">
                                                <Gavel className="h-4 w-4 text-muted-foreground" />
                                                <h3 className="text-sm font-medium">Mapped Sections</h3>
                                            </div>
                                            <div className="flex items-center gap-2 max-w-lg mb-2">
                                                <Select
                                                    onChange={handleQuickAddLegal}
                                                    defaultValue=""
                                                    className="w-full max-w-sm h-8 py-1 pr-8 text-xs bg-background/50 border-border/80"
                                                    title="Select existing legal section"
                                                >
                                                    <option value="" disabled>Add Existing Section...</option>
                                                    {existingLegalSections.map(s => (
                                                        <option key={s.code} value={s.code}>
                                                            {s.code} - {s.title.length > 50 ? s.title.substring(0, 50) + '...' : s.title}
                                                        </option>
                                                    ))}
                                                </Select>
                                                <Button type="button" size="sm" variant="outline" onClick={addLegalSection} className="h-8 shadow-sm">
                                                    <Plus className="h-3 w-3 mr-1" /> New
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            {formData.legal_sections.map((section, idx) => (
                                                <div key={idx} className="group flex gap-3 p-4 border border-border rounded-lg bg-card hover:border-primary/20 transition-colors shadow-sm">
                                                    <div className="flex-1 space-y-3">
                                                        <div className="flex gap-3">
                                                            <div className="w-1/3">
                                                                <Input
                                                                    placeholder="Section Code"
                                                                    value={section.code}
                                                                    onChange={e => updateLegalSection(idx, 'code', e.target.value)}
                                                                    className="h-8 text-xs font-medium"
                                                                />
                                                            </div>
                                                            <div className="flex-1">
                                                                <Input
                                                                    placeholder="Description"
                                                                    value={section.title}
                                                                    onChange={e => updateLegalSection(idx, 'title', e.target.value)}
                                                                    className="h-8 text-xs"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeLegalSection(idx)}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive -mt-1 -mr-2"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                            {formData.legal_sections.length === 0 && (
                                                <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed border-border/50 rounded-lg">
                                                    No legal sections mapped.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'platform' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {!formData.category_id && (
                                            <div className="flex items-center gap-2 p-3 text-sm text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                                <AlertOctagon className="h-4 w-4" />
                                                <span>Please enter a <strong>Category Name</strong> in the General tab first before adding rules.</span>
                                            </div>
                                        )}
                                        {[
                                            { label: 'Meta (Facebook & Instagram)', field: 'meta_policies', list: existingMetaPolicies },
                                            { label: 'X (Twitter)', field: 'x_policies', list: existingXPolicies },
                                            { label: 'YouTube', field: 'youtube_policies', list: existingYoutubePolicies }
                                        ].map((platform, pIdx) => (
                                            <div key={platform.field} className={`space-y-4 ${pIdx !== 0 ? 'pt-6 border-t border-border' : ''}`}>
                                                <div className="flex justify-between items-center">
                                                    <h3 className="text-sm font-medium">{platform.label}</h3>
                                                    <div className="flex items-center gap-2 max-w-lg">
                                                        <Select
                                                            onChange={(e) => handleQuickAddPlatform(platform.field, platform.list, e)}
                                                            defaultValue=""
                                                            className="w-full max-w-sm h-8 py-1 pr-8 text-xs bg-background/50 border-border/80"
                                                            title="Select existing rule"
                                                        >
                                                            <option value="" disabled>Add Existing Rule...</option>
                                                            {platform.list.map(p => <option key={p.name} value={p.name}>{p.name.substring(0, 50)}{p.name.length > 50 ? '...' : ''}</option>)}
                                                        </Select>
                                                        <Button type="button" size="sm" variant="outline" onClick={() => addPlatformPolicy(platform.field)} className="h-8 shadow-sm">
                                                            <Plus className="h-3 w-3 mr-1" /> New
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    {formData[platform.field].map((p, i) => (
                                                        <div key={i} className="flex gap-2 items-center group">
                                                            <div className="flex-1 relative">
                                                                <Input
                                                                    placeholder="Policy Name"
                                                                    value={p.name}
                                                                    onChange={e => updatePlatformPolicy(platform.field, i, 'name', e.target.value)}
                                                                    className="pr-8"
                                                                />
                                                                <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500/0 group-focus-within:text-green-500/50 transition-colors pointer-events-none" />
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => removePlatformPolicy(platform.field, i)}
                                                                className="h-10 w-10 text-muted-foreground hover:text-destructive"
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    {formData[platform.field].length === 0 && (
                                                        <div className="text-xs text-muted-foreground italic pl-1">
                                                            No specific rules defined.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </form>
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-border bg-muted/20 flex justify-end gap-3 backdrop-blur-sm">
                            <Button variant="outline" onClick={() => setIsPanelOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleSubmit} disabled={!isDirty} className="shadow-lg shadow-primary/20 min-w-[120px]">
                                Save Changes
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal (Refined) */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={closeConfirm} />
                    <div className="relative bg-background w-full max-w-sm rounded-xl shadow-2xl border border-border p-6 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className={`p-4 rounded-full ${confirmModal.isDelete ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                                {confirmModal.isDelete ? <AlertTriangle className="h-6 w-6" /> : <Info className="h-6 w-6" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold tracking-tight">{confirmModal.title}</h3>
                                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{confirmModal.message}</p>
                            </div>
                            <div className="flex gap-3 w-full mt-4">
                                <Button variant="outline" onClick={closeConfirm} className="flex-1">
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleConfirmAction}
                                    variant={confirmModal.isDelete ? 'destructive' : 'default'}
                                    className="flex-1 shadow-lg"
                                >
                                    Confirm
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- UI Components ---
const Input = (props) => (
    <input
        {...props}
        className={`w-full px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ${props.className || ''}`}
    />
);

const Textarea = (props) => (
    <textarea
        {...props}
        className={`w-full px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[100px] resize-y transition-all duration-200 ${props.className || ''}`}
    />
);

const Select = ({ children, ...props }) => (
    <div className="relative">
        <select
            {...props}
            className={`w-full appearance-none px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pr-8 transition-all duration-200 ${props.className || ''}`}
        >
            {children}
        </select>
        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none rotate-90" />
    </div>
);

const Button = ({ variant = 'default', size = 'default', className, children, ...props }) => {
    const variants = {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
    };
    const sizes = {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
    };
    return (
        <button
            {...props}
            className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className || ''}`}
        >
            {children}
        </button>
    );
};

export default PolicyManager;
