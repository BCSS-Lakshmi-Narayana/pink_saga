import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import {
    Shield, Gavel, Plus, Edit2, Trash2, RefreshCw,
    BrainCircuit, CheckCircle, AlertTriangle, Play, Loader2
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';

const PolicyManager = () => {
    const [sections, setSections] = useState([]);
    const [policies, setPolicies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [trainingStatus, setTrainingStatus] = useState({ is_training: false, progress: 0, status: 'idle' });
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [activeTab, setActiveTab] = useState('legal');

    // Form State
    const [formData, setFormData] = useState({});

    useEffect(() => {
        fetchData();
        fetchTrainingStatus();
        // Poll training status every 5 seconds
        const interval = setInterval(fetchTrainingStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [secRes, polRes] = await Promise.all([
                api.get('/policies/sections'),
                api.get('/policies/policies')
            ]);
            setSections(secRes.data);
            setPolicies(polRes.data);
        } catch (error) {
            toast.error('Failed to load policies');
        } finally {
            setLoading(false);
        }
    };

    const fetchTrainingStatus = async () => {
        try {
            const res = await api.get('/policies/training-status');
            setTrainingStatus(res.data);
        } catch (error) {
            // internal error or offline
        }
    };

    const handleRetrain = async () => {
        try {
            toast.info('Initiating AI Retraining...');
            await api.post('/policies/retrain');
            toast.success('Training started successfully');
            setTrainingStatus({ ...trainingStatus, is_training: true });
        } catch (error) {
            toast.error('Failed to start training');
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            const isLegal = activeTab === 'legal';
            const endpoint = isLegal ? '/policies/sections' : '/policies/policies';

            if (editingItem) {
                await api.put(`${endpoint}/${editingItem._id}`, formData);
                toast.success('Updated successfully');
            } else {
                await api.post(endpoint, formData);
                toast.success('Created successfully');
            }

            setDialogOpen(false);
            resetForm();
            fetchData();
        } catch (error) {
            toast.error('Operation failed');
        }
    };

    const handleDelete = async (id) => {
        try {
            const isLegal = activeTab === 'legal';
            const endpoint = isLegal ? '/policies/sections' : '/policies/policies';
            await api.delete(`${endpoint}/${id}`);
            toast.success('Deleted successfully');
            fetchData();
        } catch (error) {
            toast.error('Delete failed');
        }
    };

    const resetForm = () => {
        setEditingItem(null);
        setFormData(activeTab === 'legal' ? {
            act: 'BNS 2023', section: '', description: '', mapped_intent: 'Hate_Speech', keywords: [], is_active: true
        } : {
            platform: 'x', policy_name: '', policy_id: '', description: '', keywords: [], is_active: true
        });
    };

    const openAddDialog = () => {
        resetForm();
        setDialogOpen(true);
    };

    const openEditDialog = (item) => {
        setEditingItem(item);
        setFormData(item);
        setDialogOpen(true);
    };

    return (
        <div className="space-y-6">

            {/* 1. TRAINING STATUS CARD */}
            <Card className="bg-slate-50 border-blue-100">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${trainingStatus.is_training ? 'bg-amber-100 animate-pulse' : 'bg-blue-100'}`}>
                                <BrainCircuit className={`h-6 w-6 ${trainingStatus.is_training ? 'text-amber-600' : 'text-blue-600'}`} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg text-slate-800">Dynamic Policy Engine</h3>
                                <p className="text-sm text-slate-500">
                                    {trainingStatus.is_training
                                        ? `Training in progress... (${trainingStatus.progress || 0}%)`
                                        : `Model Status: ${trainingStatus.status === 'offline' ? 'Offline' : 'Ready'}`
                                    }
                                </p>
                                {!trainingStatus.is_training && (
                                    <p className="text-xs text-muted-foreground mt-1">Last updated: {new Date().toLocaleDateString()}</p>
                                )}
                            </div>
                        </div>

                        <Button
                            onClick={handleRetrain}
                            disabled={trainingStatus.is_training}
                            className={trainingStatus.is_training ? 'bg-amber-500 hover:bg-amber-600' : ''}
                        >
                            {trainingStatus.is_training ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Training...
                                </>
                            ) : (
                                <>
                                    <Play className="mr-2 h-4 w-4" />
                                    Trigger Retrain
                                </>
                            )}
                        </Button>
                    </div>

                    {trainingStatus.is_training && (
                        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                            <div className="bg-amber-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${trainingStatus.progress}%` }}></div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 2. MANAGEMENT TABS */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <div className="flex items-center justify-between">
                    <TabsList>
                        <TabsTrigger value="legal" className="gap-2"><Gavel className="h-4 w-4" /> BNS Sections</TabsTrigger>
                        <TabsTrigger value="policies" className="gap-2"><Shield className="h-4 w-4" /> Platform Policies</TabsTrigger>
                    </TabsList>

                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button onClick={openAddDialog} size="sm" className="gap-2">
                                <Plus className="h-4 w-4" /> Add New {activeTab === 'legal' ? 'Section' : 'Policy'}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>{editingItem ? 'Edit' : 'Add'} {activeTab === 'legal' ? 'Legal Section' : 'Platform Policy'}</DialogTitle>
                            </DialogHeader>

                            <form onSubmit={handleSave} className="space-y-4 pt-4">
                                {activeTab === 'legal' ? (
                                    /* LEGAL FORM */
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Act Name</Label>
                                                <Input value={formData.act || 'BNS 2023'} onChange={e => setFormData({ ...formData, act: e.target.value })} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Section Number</Label>
                                                <Input value={formData.section || ''} onChange={e => setFormData({ ...formData, section: e.target.value })} placeholder="e.g. 196" required />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Map to Intent</Label>
                                            <Select value={formData.mapped_intent} onValueChange={v => setFormData({ ...formData, mapped_intent: v })}>
                                                <SelectTrigger><SelectValue placeholder="Select Intent" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Hate_Speech">Hate Speech</SelectItem>
                                                    <SelectItem value="Threat_Incitement">Threat / Incitement</SelectItem>
                                                    <SelectItem value="Sexual_Harassment">Sexual Harassment</SelectItem>
                                                    <SelectItem value="Communal_Violence">Communal Violence</SelectItem>
                                                    <SelectItem value="Harassment_Abuse">Harassment/Abuse</SelectItem>
                                                    <SelectItem value="Opinion_Rant">Opinion/Rant</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </>
                                ) : (
                                    /* POLICY FORM */
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Platform</Label>
                                                <Select value={formData.platform} onValueChange={v => setFormData({ ...formData, platform: v })}>
                                                    <SelectTrigger><SelectValue placeholder="Select Platform" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="x">X (Twitter)</SelectItem>
                                                        <SelectItem value="youtube">YouTube</SelectItem>
                                                        <SelectItem value="facebook">Facebook</SelectItem>
                                                        <SelectItem value="instagram">Instagram</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Policy ID</Label>
                                                <Input value={formData.policy_id || ''} onChange={e => setFormData({ ...formData, policy_id: e.target.value })} placeholder="e.g. X_HATE_POLICY" required />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Policy Name</Label>
                                            <Input value={formData.policy_name || ''} onChange={e => setFormData({ ...formData, policy_name: e.target.value })} placeholder="e.g. Hateful Conduct" required />
                                        </div>
                                    </>
                                )}

                                <div className="space-y-2">
                                    <Label>Description</Label>
                                    <Textarea value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description of the violation..." required />
                                </div>

                                <div className="space-y-2">
                                    <Label>Training Keywords (comma separated)</Label>
                                    <Textarea
                                        value={Array.isArray(formData.keywords) ? formData.keywords.join(', ') : formData.keywords || ''}
                                        onChange={e => setFormData({ ...formData, keywords: e.target.value.split(',').map(k => k.trim()) })}
                                        placeholder="e.g. kill, attack, hate"
                                    />
                                    <p className="text-xs text-muted-foreground">These keywords are used to generate synthetic training data.</p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Switch checked={formData.is_active} onCheckedChange={c => setFormData({ ...formData, is_active: c })} />
                                    <Label>Active</Label>
                                </div>

                                <Button type="submit" className="w-full">Save Changes</Button>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* LEGAL CONTENT */}
                <TabsContent value="legal">
                    <Card>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Section</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Mapped Intent</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sections.map(s => (
                                    <TableRow key={s._id}>
                                        <TableCell className="font-medium">{s.act} {s.section}</TableCell>
                                        <TableCell className="max-w-[300px] truncate" title={s.description}>{s.description}</TableCell>
                                        <TableCell><Badge variant="outline">{s.mapped_intent}</Badge></TableCell>
                                        <TableCell>
                                            <Badge variant={s.is_active ? 'default' : 'secondary'} className={s.is_active ? 'bg-green-500' : ''}>
                                                {s.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(s)}><Edit2 className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(s._id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {sections.length === 0 && !loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No sections found.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                {/* POLICY CONTENT */}
                <TabsContent value="policies">
                    <Card>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Platform</TableHead>
                                    <TableHead>Policy Name</TableHead>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {policies.map(p => (
                                    <TableRow key={p._id}>
                                        <TableCell className="capitalize font-medium">{p.platform}</TableCell>
                                        <TableCell>{p.policy_name}</TableCell>
                                        <TableCell className="text-xs font-mono text-muted-foreground">{p.policy_id}</TableCell>
                                        <TableCell>
                                            <Badge variant={p.is_active ? 'default' : 'secondary'} className={p.is_active ? 'bg-green-500' : ''}>
                                                {p.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(p)}><Edit2 className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(p._id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {policies.length === 0 && !loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No policies found.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default PolicyManager;
