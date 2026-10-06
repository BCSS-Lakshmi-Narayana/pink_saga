import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    X, GripHorizontal, Send, MessageSquare, Loader2, Check,
    Copy, ChevronDown, AlertTriangle, Plus, Lock, User, Shield, Reply, Share2, Trash2, AtSign
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { canManageRestrictedGrievanceUi } from '../../lib/grievanceUiPermissions';

/* ─── Constants ─── */
const CATEGORIES = [
    'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'Query', 'She Team', 'Task force', 'Traffic'
];

/* ─── Helpers ─── */
const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
};
const fmtNum = (n) => {
    if (!n || n === 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
};
const normalizeMediaList = (media) => {
    if (!Array.isArray(media)) return [];
    return media.map(item => {
        if (!item) return null;
        const url = item.url || item.video_url || item.preview || item.preview_url;
        if (!url) return null;
        return { type: item.type || 'photo', url: item.url || url, video_url: item.video_url || null };
    }).filter(Boolean);
};
const extractPhoneFromText = (text = '') => {
    const match = text.match(/(?:\+91[\s-]?)?(?:0)?[6-9]\d{4}[\s-]?\d{5}/);
    return match ? match[0].replace(/[\s-]/g, '') : '';
};

const getReceivedModeFromPlatform = (platform = '') => {
    const normalized = String(platform || '').toLowerCase();
    if (normalized === 'facebook') return 'FB POST';
    if (normalized === 'whatsapp') return 'WHATSAPP DM';
    return 'X POST';
};

const formatFullDate = (date) => {
    if (!date) return '';
    try { return new Date(date).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' }); } catch { return ''; }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                    GRIEVANCE POPUP (G)                           */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const GrievancePopup = ({ grievance, onClose, onAction, userName = '', onReportCreated }) => {
    const { user } = useAuth();
    const canDeleteGrievance = canManageRestrictedGrievanceUi(user);
    const popupRef = useRef(null);
    const [pos, setPos] = useState({ x: 20, y: Math.max(20, (window.innerHeight - 660) / 2) });
    const [size, setSize] = useState({ width: 760, height: 660 });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    /* ─── Steps: compose → action → details → done ─── */
    const [step, setStep] = useState('compose');
    const [replyingTo, setReplyingTo] = useState(null);
    const [pendingModeEdit, setPendingModeEdit] = useState(null); // { source, idx, oldMode, newMode }

    /* ─── Data ─── */
    const [message, setMessage] = useState('');
    const [category, setCategory] = useState('Others');
    const [complaintPhone, setComplaintPhone] = useState('');
    const [uniqueCode, setUniqueCode] = useState('');
    const [reportId, setReportId] = useState(null);
    const [reportStatus, setReportStatus] = useState('PENDING');
    const [submitting, setSubmitting] = useState(false);

    /* ─── Contacts ─── */
    const [contacts, setContacts] = useState([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const [showAllContacts, setShowAllContacts] = useState(false);
    const [selectedContact, setSelectedContact] = useState(null);
    const [sharing, setSharing] = useState(false);

    /* ─── Details step: complainant & officer logs ─── */
    const [complainantLogs, setComplainantLogs] = useState([]);
    const [officerLogs, setOfficerLogs] = useState([]);
    const [complainantComposer, setComplainantComposer] = useState({ type: 'Operator', mode: 'X DM', content: '' });
    const [officerComposer, setOfficerComposer] = useState({ type: 'Operator', mode: 'WHATSAPP MSG', content: '' });
    const [savingDetails, setSavingDetails] = useState(false);

    /* ─── Close form ─── */
    const [closingRemarks, setClosingRemarks] = useState('');
    const [operatorReply, setOperatorReply] = useState('');
    const [finalReplyToUser, setFinalReplyToUser] = useState('');
    const [finalComm, setFinalComm] = useState('');
    const [firStatus, setFirStatus] = useState('');
    const [closingFiles, setClosingFiles] = useState([]);
    const [uploadingClosingMedia, setUploadingClosingMedia] = useState(false);
    const [closing, setClosing] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);

    const handleClosingFilePick = (event) => {
        const picked = Array.from(event.target.files || []);
        if (!picked.length) return;

        setClosingFiles((prev) => {
            const seen = new Set(prev.map((f) => `${f.name}_${f.size}_${f.lastModified}`));
            const merged = [...prev];
            for (const file of picked) {
                const key = `${file.name}_${file.size}_${file.lastModified}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(file);
                }
            }
            return merged.slice(0, 10);
        });

        event.target.value = '';
    };

    const removeClosingFile = (fileToRemove) => {
        setClosingFiles((prev) => prev.filter((f) => !(
            f.name === fileToRemove.name &&
            f.size === fileToRemove.size &&
            f.lastModified === fileToRemove.lastModified
        )));
    };

    /* ─── Build message ─── */
    const buildMessage = useCallback(() => {
        const g = grievance;
        if (!g) return '';
        const greeting = getGreeting();
        const author = g.posted_by?.display_name || g.posted_by?.handle || 'Unknown';
        const handle = g.posted_by?.handle ? `@${g.posted_by.handle}` : '';
        const desc = g.content?.full_text || g.content?.text || '';
        const link = g.tweet_url || g.url || g.post_url || '';
        const eng = g.engagement || g.metrics || {};
        const phone = extractPhoneFromText(desc) || g.complainant_phone || 'None';
        const platformName = (g.platform || 'x') === 'x' ? 'X (Twitter)' : g.platform === 'facebook' ? 'Facebook' : 'WhatsApp';

        return [
            `${greeting} Sir/Ma'am,`,
            ``,
            `A post requiring attention has been identified on ${platformName}.`,
            ``,
            `Complaint Phone Number: ${phone}`,
            ``,
            `📌 *Post Details:*`,
            `*Posted by*: ${author} ${handle}`,
            `*Post Link:* ${link}`,
            `*Post Content*: ${desc}`,
            ``,
            `📊 *Engagement:*`,
            `• Views: ${fmtNum(eng.views || 0)} | Reposts: ${fmtNum(eng.retweet_count || eng.reposts || 0)} | Likes: ${fmtNum(eng.like_count || eng.likes || 0)} | Replies: ${fmtNum(eng.reply_count || eng.replies || 0)}`
        ].join('\n');
    }, [grievance]);

    useEffect(() => {
        setMessage(buildMessage());
        setComplaintPhone('');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (step !== 'details') return;

        // 1. Auto-populate Complainant Logs (Post Description)
        if (complainantLogs.length === 0) {
            const autoMessage = grievance?.content?.full_text || grievance?.content?.text || '';
            if (autoMessage.trim()) {
                setComplainantLogs([
                    {
                        type: 'User',
                        mode: getReceivedModeFromPlatform(grievance?.platform),
                        content: autoMessage,
                        timestamp: new Date().toISOString(),
                        auto_generated: true,
                        operator: { name: userName || 'Operator' }
                    }
                ]);
            }
        }

        // 2. Auto-populate Officer Logs (Formatted Message)
        if (officerLogs.length === 0 && message.trim()) {
            let content = message.replace(/\n*🔖\s*\*Social Media Grienvence Number\s*\*.*$/gim, '').trim();
            if (uniqueCode) {
                content += `\n\n🔖 *Social Media Grienvence Number * ${uniqueCode}`;
            }

            setOfficerLogs([
                {
                    type: 'Operator',
                    mode: 'WHATSAPP MSG',
                    content: content,
                    timestamp: new Date().toISOString(),
                    auto_generated: true,
                    operator: { name: userName || 'Operator' },
                    recipient: selectedContact ? { name: selectedContact.name, phone: selectedContact.phone } : null
                }
            ]);
        }
    }, [step, complainantLogs.length, officerLogs.length, grievance, userName, message, uniqueCode, selectedContact]);

    /* ─── Drag ─── */
    useEffect(() => {
        if (!dragging) return;
        const onMove = (e) => setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
        const onUp = () => setDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [dragging, dragOffset]);

    /* ─── Resize ─── */
    useEffect(() => {
        if (!resizing) return;

        // Prevent selection during resize
        document.body.style.cursor = 'se-resize';
        document.body.style.userSelect = 'none';

        const onMove = (e) => {
            if (!popupRef.current) return;
            // Use state pos instead of getBoundingClientRect to avoid jitter if re-render is slow
            // But we need absolute client coordinates.
            // Actually, we can just use the current mouse position relative to the popup's top-left.
            // Since top-left is pos.x, pos.y:

            const newWidth = Math.max(500, e.clientX - pos.x);
            const newHeight = Math.max(420, e.clientY - pos.y);

            setSize({ width: newWidth, height: newHeight });
        };

        const onUp = () => {
            setResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizing, pos]);

    /* ─── Fetch contacts ─── */
    const fetchContacts = useCallback(async () => {
        setContactsLoading(true);
        try {
            const res = await api.get('/grievance-workflow/contacts');
            setContacts(res.data || []);
        } catch { /* silent */ }
        finally { setContactsLoading(false); }
    }, []);

    /* ─── Proceed (Submit) ─── */
    const handleProceed = async () => {
        setSubmitting(true);
        try {
            const g = grievance;
            const eng = g.engagement || g.metrics || {};
            const ctx = g.context || {};
            const mediaItems = Array.from(new Map(
                [
                    ...normalizeMediaList(g.content?.media),
                    ...normalizeMediaList(ctx?.content?.media),
                    ...normalizeMediaList(ctx?.quoted?.content?.media),
                    ...normalizeMediaList(ctx?.in_reply_to?.content?.media),
                    ...normalizeMediaList(ctx?.reposted_from?.content?.media),
                    ...normalizeMediaList(ctx?.parent?.content?.media),
                    ...normalizeMediaList(ctx?.thread_parent?.content?.media)
                ].map(item => [item.video_url || item.url, item])
            ).values());

            const payload = {
                grievance_id: g.id,
                platform: g.platform || 'x',
                profile_id: g.posted_by?.id || g.posted_by?.handle || '',
                profile_link: g.posted_by?.profile_url || '',
                post_link: g.tweet_url || g.url || g.post_url || '',
                post_date: g.posted_at || g.created_at || new Date().toISOString(),
                post_description: g.content?.full_text || g.content?.text || '',
                posted_by: {
                    handle: g.posted_by?.handle || '',
                    display_name: g.posted_by?.display_name || '',
                    profile_image_url: g.posted_by?.profile_image_url || ''
                },
                engagement: {
                    views: eng.views || eng.impression_count || 0,
                    reposts: eng.retweet_count || eng.reposts || eng.shares || 0,
                    likes: eng.like_count || eng.likes || eng.reactions || 0,
                    replies: eng.reply_count || eng.replies || eng.comments || 0
                },
                complaint_phone: complaintPhone || '',
                category,
                media_items: mediaItems,
                media_urls: mediaItems.map(m => m.video_url || m.url).filter(Boolean),
                remarks: message,
                message
            };

            const res = await api.post('/grievance-workflow/reports', payload);
            const report = res.data;
            setUniqueCode(report.unique_code);
            setReportId(report.id);
            setReportStatus(report.status);
            onReportCreated?.(g.id, report);

            // Keep compose preview unchanged (do not inject unique code into message body)
            setMessage(prev => prev
                .replace(/^.*\*Unique ID:\*.*$/gim, '')
                .trim());

            toast.success(`Grievance report created: ${report.unique_code}`);
            setStep('action');
            fetchContacts();
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to create grievance report');
        } finally {
            setSubmitting(false);
        }
    };

    /* ─── Share via WhatsApp → remains PENDING ─── */
    const handleShare = async (contact) => {
        if (!contact) return;
        setSharing(true);
        try {
            if (reportId) {
                const res = await api.put(`/grievance-workflow/reports/${reportId}/share`, {
                    contact_name: contact.name,
                    contact_phone: contact.phone,
                    contact_department: contact.department || ''
                });
                setReportStatus(res.data.status);
            }
            const phone = contact.phone.replace(/[^0-9]/g, '');
            const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;

            // Ensure only one grievance-number footer is shared
            const baseMsg = String(message || '')
                .replace(/^.*\*Unique ID:\*.*$/gim, '')
                .replace(/^.*Unique ID:.*$/gim, '')
                .replace(/\n*🔖\s*\*Social Media Grienvence Number\s*\*.*$/gim, '')
                .trim();
            let finalMsg = baseMsg;
            if (uniqueCode) {
                finalMsg += `\n\n🔖 *Social Media Grienvence Number * ${uniqueCode}`;
            }

            navigator.clipboard.writeText(finalMsg);
            toast.success('Message copied to clipboard');
            window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(finalMsg)}`, '_blank');
            setSelectedContact(contact);
            toast.success(`Shared with ${contact.name} — Status: PENDING`);
        } catch { toast.error('Failed to record share'); }
        finally { setSharing(false); }
    };

    /* ─── Close grievance ─── */
    const handleClose = async () => {
        setClosing(true);
        try {
            let closingMediaS3Urls = [];
            if (closingFiles.length > 0) {
                setUploadingClosingMedia(true);
                const formData = new FormData();
                closingFiles.forEach((file) => formData.append('files', file));
                const uploadRes = await api.post('/uploads/s3', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                closingMediaS3Urls = (uploadRes.data?.uploads || [])
                    .map((u) => u?.url)
                    .filter(Boolean);
            }

            const res = await api.put(`/grievance-workflow/reports/${reportId}/close`, {
                closing_remarks: closingRemarks,
                operator_reply: operatorReply,
                final_reply_to_user: finalReplyToUser,
                final_communication: finalComm,
                fir_status: firStatus,
                closing_media_s3_urls: closingMediaS3Urls
            });
            setReportStatus(res.data.status);
            toast.success('Grievance closed successfully');
            setStep('done');
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to close grievance');
        } finally {
            setUploadingClosingMedia(false);
            setClosing(false);
            setConfirmClose(false);
        }
    };

    const handleCopy = () => { navigator.clipboard.writeText(message); toast.success('Message copied'); };

    const handleDirectWhatsAppShare = () => {
        const baseMsg = String(message || '')
            .replace(/^.*\*Unique ID:\*.*$/gim, '')
            .replace(/^.*Unique ID:.*$/gim, '')
            .replace(/\n*🔖\s*\*Social Media Grienvence Number\s*\*.*$/gim, '')
            .trim();

        let finalMsg = baseMsg;
        if (uniqueCode) {
            finalMsg += `\n\n🔖 *Social Media Grienvence Number * ${uniqueCode}`;
        }

        navigator.clipboard.writeText(finalMsg).catch(() => { });
        window.open(`https://wa.me/?text=${encodeURIComponent(finalMsg)}`, '_blank');
        toast.success('Opened WhatsApp. Select any contact to share.');
    };

    const filteredContacts = contacts.filter(c =>
        !contactSearch ||
        c.name?.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.phone?.includes(contactSearch) ||
        c.department?.toLowerCase().includes(contactSearch.toLowerCase())
    );

    /* ─── Status badge ─── */
    const StatusBadge = ({ status }) => {
        const colors = {
            PENDING: 'bg-yellow-200 text-yellow-800',
            ESCALATED: 'bg-orange-200 text-orange-800',
            CLOSED: 'bg-green-200 text-green-800'
        };
        return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', colors[status] || 'bg-slate-200 text-slate-700')}>{status}</span>;
    };

    /* ─── Contact card ─── */
    const ContactCard = ({ contact }) => (
        <div
            className={cn(
                'flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all text-xs',
                selectedContact?.id === contact.id ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : 'border-slate-200 bg-white hover:bg-slate-50'
            )}
            onClick={() => setSelectedContact(contact)}
        >
            <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-600 shrink-0">
                    {contact.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{contact.name}</p>
                    <p className="text-[9px] text-slate-500">{contact.phone}</p>
                </div>
            </div>
            <Button
                size="sm"
                className="gap-0.5 bg-green-600 hover:bg-green-700 text-white h-6 px-1.5 shrink-0 ml-1"
                onClick={(e) => { e.stopPropagation(); handleShare(contact); }}
                disabled={sharing}
            >
                {sharing && selectedContact?.id === contact.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <MessageSquare className="h-2.5 w-2.5" />}
                WhatsApp
            </Button>
        </div>
    );

    /* ━━━━━ RENDER ━━━━━ */
    return (
        <>
            <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={onClose} />
            <div
                ref={popupRef}
                className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden select-none"
                style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
            >
                {/* ─── Title Bar ─── */}
                <div
                    className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white cursor-move shrink-0"
                    onMouseDown={(e) => { setDragging(true); setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y }); }}
                >
                    <div className="flex items-center gap-3">
                        <GripHorizontal className="h-5 w-5 opacity-60" />
                        <span className="font-bold text-base">Grievance Report</span>
                        {uniqueCode && <span className="ml-2 px-3 py-1 bg-yellow-300 rounded font-mono font-bold text-sm text-red-700">{uniqueCode}</span>}
                        {reportStatus && reportStatus !== 'PENDING' && <StatusBadge status={reportStatus} />}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 mr-4 text-sm">
                            {['compose', 'action', 'details', 'done'].map((s, i) => (
                                <span key={s} className={cn('px-3 py-1 rounded-full font-semibold',
                                    step === s ? 'bg-white text-amber-700' : 'bg-white/20'
                                )}>{i + 1}. {s === 'compose' ? 'Compose' : s === 'action' ? 'Communicate' : s === 'details' ? 'Log' : 'Done'}</span>
                            ))}
                        </div>
                        {grievance.tagged_account && (
                            <div className="flex items-center gap-1 bg-white/20 px-2 py-1 rounded-md mr-2 text-[12px] font-bold">
                                <AtSign className="h-3 w-3" />
                                {grievance.tagged_account}
                            </div>
                        )}
                        {canDeleteGrievance && (
                            <button 
                                onClick={() => {
                                    if (window.confirm('Are you sure you want to delete this grievance?')) {
                                        onAction?.('delete', grievance);
                                        onClose();
                                    }
                                }}
                                className="p-1.5 hover:bg-red-500 rounded transition-colors"
                                title="Delete Grievance"
                            >
                                <Trash2 className="h-5 w-5" />
                            </button>
                        )}
                        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded transition-colors"><X className="h-5 w-5" /></button>
                    </div>
                </div>

                {/* ─── Content ─── */}
                <div className="flex-1 overflow-hidden">

                    {/* ═══ STEP 1: COMPOSE ═══ */}
                    {step === 'compose' && (
                        <div className="flex flex-col h-full">
                            <ScrollArea className="flex-1 p-4">
                                <div className="h-full min-h-0 flex flex-col">
                                    {/* Category + Phone row */}
                                    <div className="grid grid-cols-2 gap-3 mb-3 shrink-0">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                                            <select
                                                value={category}
                                                onChange={(e) => setCategory(e.target.value)}
                                                className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none"
                                            >
                                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">Complainant Mobile No</label>
                                            <Input
                                                value={complaintPhone}
                                                onChange={(e) => setComplaintPhone(e.target.value)}
                                                placeholder=""
                                                className="text-sm h-9"
                                            />
                                        </div>
                                    </div>

                                    {/* Message */}
                                    <div className="flex-1 min-h-0 flex flex-col">
                                        <div className="flex items-center justify-between mb-1 shrink-0">
                                            <label className="text-xs font-semibold text-slate-700">Message Preview (editable)</label>
                                            <button onClick={handleCopy} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                                                <Copy className="h-3 w-3" /> Copy
                                            </button>
                                        </div>
                                        <Textarea
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            className="text-sm font-mono resize-none bg-white flex-1 h-full min-h-[360px]"
                                        />
                                    </div>
                                </div>
                            </ScrollArea>

                            <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                                <Button
                                    size="sm"
                                    className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
                                    onClick={handleProceed}
                                    disabled={submitting}
                                >
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Proceed
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 2: ACTION (WhatsApp / Close) ═══ */}
                    {step === 'action' && !confirmClose && (
                        <div className="flex flex-col h-full">
                            {/* Action header */}
                            <div className="shrink-0 p-3 border-b bg-slate-50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-slate-900">Share or Close Grievance</h3>
                                    <StatusBadge status={reportStatus} />
                                </div>
                                <Input
                                    placeholder="Search contacts..."
                                    value={contactSearch}
                                    onChange={(e) => setContactSearch(e.target.value)}
                                    className="text-sm"
                                />
                            </div>

                            {/* Contacts */}
                            <div className="flex-1 min-h-0 flex flex-col p-3 gap-1.5 overflow-hidden">
                                {contactsLoading ? (
                                    <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                                ) : filteredContacts.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-slate-500">{contacts.length === 0 ? 'No contacts available.' : 'No match.'}</div>
                                ) : (
                                    <>
                                        {!contactSearch && !showAllContacts ? (
                                            <>
                                                <div className="space-y-1">
                                                    {filteredContacts.slice(0, 2).map(c => <ContactCard key={c.id} contact={c} />)}
                                                </div>
                                                {filteredContacts.length > 2 && (
                                                    <div className="flex items-center justify-center">
                                                        <button className="text-[11px] text-slate-500 hover:text-slate-700 py-1" onClick={() => setShowAllContacts(true)}>
                                                            +{filteredContacts.length - 2} more — Show all
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <ScrollArea className="flex-1 min-h-0">
                                                <div className="space-y-1 pr-3">
                                                    {filteredContacts.map(c => <ContactCard key={c.id} contact={c} />)}
                                                </div>
                                            </ScrollArea>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-between items-center">
                                <button className="text-xs text-slate-500 hover:text-slate-700 underline" onClick={() => setStep('compose')}>← Back</button>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-slate-600 border-slate-300 hover:bg-slate-100 gap-1.5"
                                        onClick={() => setStep('details')}
                                    >
                                        Skip →
                                    </Button>
                                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5" onClick={() => setStep('details')}>
                                        Next →
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 3: LOG (Row-by-row list) ═══ */}
                    {step === 'details' && (
                        <div className="relative flex flex-col h-full bg-slate-50">
                            {/* Header */}
                            <div className="shrink-0 px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
                                <div className="flex items-center gap-2">
                                    <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center">
                                        <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">Communication Log</p>
                                        <p className="text-[10px] text-slate-400">
                                            {[...complainantLogs, ...officerLogs].length} entr{[...complainantLogs, ...officerLogs].length === 1 ? 'y' : 'ies'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Log rows */}
                            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                                {[
                                    ...complainantLogs.map((l, i) => ({ ...l, _source: 'complainant', _origIdx: i })),
                                    ...officerLogs.map((l, i) => ({ ...l, _source: 'officer', _origIdx: i }))
                                ]
                                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                                    .map((log, idx) => {
                                        const isOfficerLog = log._source === 'officer';
                                        const isEscalation = isOfficerLog && log.is_escalation === true;
                                        const isUserMsg = log.type === 'User';
                                        const isOperatorRemark = log.type === 'OperatorRemark';

                                        // ── Resolve names ──
                                        const _isUnknown = (v) => !v || /^unknown/i.test(v.trim());
                                        const userName_ = !_isUnknown(userName) ? userName : 'Operator';
                                        const complainantName = grievance?.posted_by?.display_name || grievance?.posted_by?.handle || 'Post Author';
                                        const operatorName = !_isUnknown(log.operator?.name) ? log.operator.name : userName_;
                                        const officerName = log.recipient?.name || 'Officer';
                                        const officerPhone = log.recipient?.phone || '';

                                        // ── Per-type strip config ──
                                        let stripBg, stripText, roleLabel, dirLabel, modeOptions;

                                        if (isUserMsg) {
                                            stripBg = 'bg-orange-500';
                                            stripText = 'text-white';
                                            roleLabel = `User (${complainantName})`;
                                            dirLabel = null;
                                            modeOptions = ['X POST', 'X DM', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST'];
                                        } else if (isOperatorRemark) {
                                            stripBg = 'bg-amber-500';
                                            stripText = 'text-white';
                                            roleLabel = `Operator (${operatorName})`;
                                            dirLabel = 'Internal Note';
                                            modeOptions = ['INTERNAL'];
                                        } else if (isEscalation) {
                                            stripBg = 'bg-red-600';
                                            stripText = 'text-white';
                                            roleLabel = `Operator (${operatorName})`;
                                            dirLabel = `Escalated → Officer (${officerName}${officerPhone ? ' · ' + officerPhone : ''})`;
                                            modeOptions = ['WHATSAPP MSG', 'WHATSAPP CALL', 'PHONE CALL', 'X DM', 'WHATSAPP DM', 'FB POST'];
                                        } else if (isOfficerLog) {
                                            stripBg = 'bg-blue-600';
                                            stripText = 'text-white';
                                            roleLabel = `Operator (${operatorName})`;
                                            dirLabel = `→ Officer (${officerName}${officerPhone ? ' · ' + officerPhone : ''})`;
                                            modeOptions = ['WHATSAPP MSG', 'WHATSAPP CALL', 'PHONE CALL', 'X DM', 'WHATSAPP DM', 'FB POST'];
                                        } else {
                                            // Operator → User
                                            stripBg = 'bg-emerald-600';
                                            stripText = 'text-white';
                                            roleLabel = `Operator (${operatorName})`;
                                            dirLabel = `→ User (${complainantName})`;
                                            modeOptions = ['X POST', 'X DM', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST'];
                                        }

                                        const fullDate = new Date(log.timestamp).toLocaleString('en-IN', {
                                            day: '2-digit', month: 'short', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit', hour12: true
                                        });

                                        return (
                                            <div key={idx} className="bg-white pt-1.5 pb-1">
                                                {/* ── Colored tag (left-aligned, content-width only) ── */}
                                                <div className="flex items-center gap-2 px-3">
                                                    <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm max-w-[85%]', stripBg)}>
                                                        {/* Role + direction */}
                                                        <span className={cn('text-[10px] font-semibold truncate', stripText)}>
                                                            {roleLabel}
                                                            {dirLabel && (
                                                                <span className="font-normal opacity-90"> {dirLabel}</span>
                                                            )}
                                                        </span>

                                                        {/* Mode dropdown */}
                                                        {!log.locked && (
                                                            <select
                                                                value={log.mode || modeOptions[0]}
                                                                onChange={e => {
                                                                    const newMode = e.target.value;
                                                                    if (newMode === log.mode) return;
                                                                    setPendingModeEdit({ source: log._source, idx: log._origIdx, oldMode: log.mode || '', newMode });
                                                                }}
                                                                className="text-[8px] font-bold bg-white/20 hover:bg-white/30 border border-white/30 text-white rounded px-1 py-px cursor-pointer focus:ring-1 focus:ring-white/50 focus:outline-none uppercase tracking-wider transition-colors shrink-0"
                                                                title="Change channel"
                                                                onClick={e => e.stopPropagation()}
                                                            >
                                                                {modeOptions.map(m => (
                                                                    <option key={m} value={m} className="text-slate-800 bg-white">{m}</option>
                                                                ))}
                                                            </select>
                                                        )}
                                                        {log.locked && (
                                                            <span className="text-[8px] text-white/70 bg-white/10 border border-white/20 rounded px-1 py-px uppercase font-bold tracking-wider shrink-0">{log.mode || 'AUTO'}</span>
                                                        )}
                                                    </div>
                                                    {/* Time — outside the strip, right side */}
                                                    <span className="text-[8px] text-slate-400 whitespace-nowrap shrink-0">{fullDate}</span>
                                                </div>

                                                {/* ── Message body ── */}
                                                <div className="px-3 pt-1 pb-0.5">
                                                    {log.replyTo && (
                                                        <div className="text-[9px] text-slate-400 italic border-l-2 border-slate-300 pl-1.5 mb-1 truncate">
                                                            ↩ {log.replyTo.content}
                                                        </div>
                                                    )}
                                                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-snug">
                                                        {log.content}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })
                                }

                                {(complainantLogs.length === 0 && officerLogs.length === 0) && (
                                    <div className="flex items-center justify-center h-32">
                                        <p className="text-slate-400 text-xs bg-slate-100 px-3 py-1 rounded-full">No log entries yet</p>
                                    </div>
                                )}
                            </div>

                            {/* ── Confirm mode-change dialog ── */}
                            {pendingModeEdit && (
                                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                                    <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[320px] p-5 mx-4 animate-in zoom-in-95">
                                        <div className="flex items-start gap-3 mb-4">
                                            <div className="h-9 w-9 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
                                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-800 mb-0.5">Change Communication Mode?</p>
                                                <p className="text-xs text-slate-500">
                                                    Update from{' '}
                                                    <span className="font-semibold text-slate-700">{pendingModeEdit.oldMode || '—'}</span>
                                                    {' '}to{' '}
                                                    <span className="font-semibold text-blue-700">{pendingModeEdit.newMode}</span>?
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={() => setPendingModeEdit(null)}
                                                className="px-4 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const { source, idx: logIdx, newMode } = pendingModeEdit;
                                                    if (source === 'complainant') {
                                                        setComplainantLogs(prev => prev.map((l, i) => i === logIdx ? { ...l, mode: newMode } : l));
                                                    } else {
                                                        setOfficerLogs(prev => prev.map((l, i) => i === logIdx ? { ...l, mode: newMode } : l));
                                                    }
                                                    setPendingModeEdit(null);
                                                    toast.success(`Mode updated to ${newMode}`);
                                                }}
                                                className="px-4 py-1.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                            >
                                                Confirm
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Add operator note */}
                            <div className="shrink-0 p-3 bg-white border-t border-slate-200 flex flex-col gap-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Operator Note</span>
                                    <select
                                        value={complainantComposer.mode}
                                        onChange={e => setComplainantComposer(p => ({ ...p, mode: e.target.value }))}
                                        className="text-[9px] font-bold text-slate-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 focus:ring-1 focus:ring-amber-300 focus:outline-none uppercase tracking-wider cursor-pointer"
                                    >
                                        {['INTERNAL', 'X POST', 'X DM', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST'].map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-end gap-2">
                                    <div className="flex-1 bg-amber-50 rounded-lg border border-amber-200 focus-within:ring-1 focus-within:ring-amber-300 px-3 py-2 min-h-[40px]">
                                        <textarea
                                            value={complainantComposer.content}
                                            onChange={e => setComplainantComposer(p => ({ ...p, content: e.target.value }))}
                                            placeholder="Add an internal operator note..."
                                            className="w-full max-h-24 bg-transparent border-none focus:ring-0 text-sm p-0 resize-none leading-6 placeholder:text-amber-300"
                                            style={{ height: 'auto', minHeight: '24px' }}
                                            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    if (!complainantComposer.content.trim()) return;
                                                    setComplainantLogs(p => [...p, {
                                                        type: 'OperatorRemark',
                                                        mode: complainantComposer.mode || 'INTERNAL',
                                                        content: complainantComposer.content.trim(),
                                                        timestamp: new Date().toISOString(),
                                                        operator: { name: userName || 'Operator' }
                                                    }]);
                                                    setComplainantComposer(p => ({ ...p, content: '' }));
                                                }
                                            }}
                                        />
                                    </div>
                                    <button
                                        className="h-10 w-10 flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm shrink-0 transition-all active:scale-95"
                                        onClick={() => {
                                            if (!complainantComposer.content.trim()) return;
                                            setComplainantLogs(p => [...p, {
                                                type: 'OperatorRemark',
                                                mode: complainantComposer.mode || 'INTERNAL',
                                                content: complainantComposer.content.trim(),
                                                timestamp: new Date().toISOString(),
                                                operator: { name: userName || 'Operator' }
                                            }]);
                                            setComplainantComposer(p => ({ ...p, content: '' }));
                                        }}
                                    >
                                        <Send className="h-4 w-4 ml-0.5" />
                                    </button>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 px-4 py-3 border-t bg-slate-50 flex justify-between items-center z-20">
                                <button className="text-xs text-slate-500 hover:text-slate-700 underline font-medium" onClick={() => setStep('action')}>← Back</button>
                                <Button
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 px-6 shadow-md"
                                    disabled={savingDetails}
                                    onClick={async () => {
                                        setSavingDetails(true);
                                        try {
                                            if (reportId) {
                                                await api.put(`/grievance-workflow/reports/${reportId}`, {
                                                    complainant_logs: complainantLogs,
                                                    officer_logs: officerLogs
                                                });
                                                toast.success('Log saved successfully');
                                            } else {
                                                toast.info('Log saved locally — report not yet submitted');
                                            }
                                            setStep('done');
                                        } catch (err) {
                                            const msg = err?.response?.data?.error || err?.message || 'Failed to save log';
                                            toast.error(msg);
                                        } finally {
                                            setSavingDetails(false);
                                        }
                                    }}
                                >
                                    {savingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    Save & Finish
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP: CLOSE FORM ═══ */}
                    {(step === 'close_form' || confirmClose) && (
                        <div className="flex flex-col h-full">
                            <ScrollArea className="flex-1 p-4 space-y-3">
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-slate-900">Close Grievance — {uniqueCode}</h3>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Closing Remarks *</label>
                                        <Textarea
                                            value={closingRemarks}
                                            onChange={(e) => setClosingRemarks(e.target.value)}
                                            placeholder="Enter closing remarks..."
                                            className="text-sm resize-none"
                                            rows={3}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Operator Reply to User</label>
                                        <Textarea
                                            value={operatorReply}
                                            onChange={(e) => setOperatorReply(e.target.value)}
                                            placeholder="Reply sent to the complainant..."
                                            className="text-sm resize-none"
                                            rows={2}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Final Reply to User</label>
                                        <Textarea
                                            value={finalReplyToUser}
                                            onChange={(e) => setFinalReplyToUser(e.target.value)}
                                            placeholder="Final reply sent to user..."
                                            className="text-sm resize-none"
                                            rows={2}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Final Communication to Victim</label>
                                        <Textarea
                                            value={finalComm}
                                            onChange={(e) => setFinalComm(e.target.value)}
                                            placeholder="Final communication..."
                                            className="text-sm resize-none"
                                            rows={2}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">FIR Status</label>
                                        <select
                                            value={firStatus}
                                            onChange={(e) => setFirStatus(e.target.value)}
                                            className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-amber-300 outline-none"
                                        >
                                            <option value="">Select</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                        </select>
                                        {firStatus === 'Yes' && (
                                            <Input
                                                className="mt-2 text-sm"
                                                placeholder="Enter FIR Number"
                                                onChange={(e) => setFirStatus(`Yes - ${e.target.value}`)}
                                            />
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Closing Attachment Media <span className="text-slate-400">(optional)</span>
                                        </label>
                                        <Input
                                            type="file"
                                            multiple
                                            accept="image/*,video/*,application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,text/plain,.txt,text/csv,.csv,application/zip,.zip,application/x-rar-compressed,.rar"
                                            onChange={handleClosingFilePick}
                                            className="text-sm"
                                        />
                                        <p className="text-[11px] text-slate-500 mt-1">Upload local files for reference (images, videos, PDF, Word, Excel, etc.; max 10 files).</p>
                                        {closingFiles.length > 0 && (
                                            <div className="mt-2 space-y-1.5">
                                                {closingFiles.map((file, idx) => (
                                                    <div key={`${file.name}_${file.lastModified}_${idx}`} className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                                        <span className="truncate pr-2">{file.name}</span>
                                                        <button
                                                            type="button"
                                                            className="text-red-600 hover:text-red-700"
                                                            onClick={() => removeClosingFile(file)}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </ScrollArea>

                            {/* Confirm close dialog inline */}
                            {confirmClose ? (
                                <div className="shrink-0 p-4 border-t bg-red-50">
                                    <div className="flex items-center gap-2 mb-3">
                                        <AlertTriangle className="h-5 w-5 text-red-600" />
                                        <p className="text-sm font-semibold text-red-800">Are you sure you want to close this grievance?</p>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setConfirmClose(false)}>No</Button>
                                        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5" onClick={handleClose} disabled={closing || uploadingClosingMedia}>
                                            {(closing || uploadingClosingMedia) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                            Yes, Close
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-between items-center">
                                    <button className="text-xs text-slate-500 hover:text-slate-700 underline" onClick={() => setStep('action')}>← Back</button>
                                    <Button
                                        size="sm"
                                        className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                                        onClick={() => {
                                            if (!closingRemarks.trim()) { toast.error('Closing remarks are required'); return; }
                                            setConfirmClose(true);
                                        }}
                                    >
                                        <X className="h-3.5 w-3.5" /> Close Grievance
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ STEP: DONE ═══ */}
                    {step === 'done' && (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                                <Check className="h-8 w-8 text-green-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-1">
                                {reportStatus === 'CLOSED' ? 'Grievance Closed' : 'Action Complete'}
                            </h3>
                            <p className="text-sm text-slate-500 mb-1">
                                Grievance <span className="font-mono font-semibold text-red-600">{uniqueCode}</span>
                            </p>
                            <StatusBadge status={reportStatus} />
                            {selectedContact && (
                                <p className="text-xs text-slate-500 mt-2">Shared with {selectedContact.name}</p>
                            )}
                            <div className="flex items-center gap-3 mt-4">
                                {reportStatus !== 'CLOSED' && (
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={handleDirectWhatsAppShare}
                                        title="Share on WhatsApp"
                                        aria-label="Share on WhatsApp"
                                    >
                                        <Share2 className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button size="sm" onClick={() => {
                                    onClose();
                                    // Scroll to post and blink comment button
                                    setTimeout(() => {
                                        const card = document.getElementById(`grievance-card-${grievance.id}`);
                                        if (card) {
                                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            const commentBtn = card.querySelector('[data-comment-btn="true"]');
                                            if (commentBtn) {
                                                commentBtn.classList.add('animate-blink-3s');
                                                setTimeout(() => commentBtn.classList.remove('animate-blink-3s'), 3000);
                                            }
                                        }
                                    }, 100);
                                }} className="bg-amber-600 hover:bg-amber-700 text-white">Done</Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ─── Resize handle ─── */}
                <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 opacity-50 hover:opacity-100 z-50"
                    onMouseDown={(e) => { e.stopPropagation(); setResizing(true); }}
                >
                    <svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 6L0 6L6 0L6 6Z" fill="#94a3b8" />
                    </svg>
                </div>
            </div>
        </>
    );
};

export default GrievancePopup;
