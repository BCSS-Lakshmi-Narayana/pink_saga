import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    X, GripHorizontal, Send, MessageSquare, Loader2, Check,
    Copy, AlertTriangle
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

/* ─── Constants ─── */
const CATEGORIES = [
    'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'She Team', 'Task force', 'Traffic'
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

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                       QUERY POPUP (Q)                            */
/*  Flow: compose → action (share + close) → close_form → done     */
/*  Status: PENDING → CLOSED  (no escalation)                      */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const QueryPopup = ({ grievance, onClose, userName = '', onReportCreated }) => {
    const popupRef = useRef(null);
    const [pos, setPos] = useState({ x: 20, y: Math.max(20, (window.innerHeight - 660) / 2) });
    const [size, setSize] = useState({ width: 760, height: 660 });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    /* ─── Steps: compose → action → close_form → done ─── */
    const [step, setStep] = useState('compose');

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

    /* ─── Close form ─── */
    const [closingRemarks, setClosingRemarks] = useState('');
    const [operatorReply, setOperatorReply] = useState('');
    const [finalReplyToUser, setFinalReplyToUser] = useState('');
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
                if (!seen.has(key)) { seen.add(key); merged.push(file); }
            }
            return merged.slice(0, 10);
        });
        event.target.value = '';
    };

    const removeClosingFile = (fileToRemove) => {
        setClosingFiles((prev) => prev.filter((f) => !(
            f.name === fileToRemove.name && f.size === fileToRemove.size && f.lastModified === fileToRemove.lastModified
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
        const onMove = (e) => {
            if (!popupRef.current) return;
            const rect = popupRef.current.getBoundingClientRect();
            setSize({ width: Math.max(500, e.clientX - rect.left), height: Math.max(420, e.clientY - rect.top) });
        };
        const onUp = () => setResizing(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [resizing]);

    /* ─── Fetch contacts ─── */
    const fetchContacts = useCallback(async () => {
        setContactsLoading(true);
        try {
            const res = await api.get('/query-workflow/contacts');
            setContacts(res.data || []);
        } catch { /* silent */ }
        finally { setContactsLoading(false); }
    }, []);

    /* ─── Submit / Create report ─── */
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

            const res = await api.post('/query-workflow/reports', payload);
            const report = res.data;
            setUniqueCode(report.unique_code);
            setReportId(report.id);
            setReportStatus(report.status);
            onReportCreated?.(g.id, report);

            setMessage(prev => {
                if (prev.includes('[Will be generated on submit]')) return prev.replace('[Will be generated on submit]', report.unique_code);
                if (/\*Unique ID:\*/i.test(prev)) return prev.replace(/(\*Unique ID:\*\s*)(.*)/i, `$1${report.unique_code}`);
                return `${prev}\n\n🔖 *Unique ID:* ${report.unique_code}`;
            });

            toast.success(`Query report created: ${report.unique_code}`);
            setStep('action');
            fetchContacts();
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to create query report');
        } finally {
            setSubmitting(false);
        }
    };

    /* ─── Share via WhatsApp ─── */
    const handleShare = async (contact) => {
        if (!contact) return;
        setSharing(true);
        try {
            if (reportId) {
                await api.put(`/query-workflow/reports/${reportId}/share`, {
                    contact_name: contact.name,
                    contact_phone: contact.phone,
                    contact_department: contact.department || ''
                });
            }
            const phone = contact.phone.replace(/[^0-9]/g, '');
            const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;

            // Append Unique ID if available for sharing
            let finalMsg = message;
            if (uniqueCode) {
                finalMsg += `\n\n🔖 *Social Media Grienvence Number * ${uniqueCode}`;
            }

            navigator.clipboard.writeText(finalMsg);
            toast.success('Message copied to clipboard');
            window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(finalMsg)}`, '_blank');
            setSelectedContact(contact);
            toast.success(`Shared with ${contact.name}`);
        } catch { toast.error('Failed to record share'); }
        finally { setSharing(false); }
    };

    /* ─── Close query ─── */
    const handleCloseQuery = async () => {
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
                closingMediaS3Urls = (uploadRes.data?.uploads || []).map((u) => u?.url).filter(Boolean);
            }

            const res = await api.put(`/query-workflow/reports/${reportId}/close`, {
                closing_remarks: closingRemarks,
                operator_reply: operatorReply,
                final_reply_to_user: finalReplyToUser,
                closing_media_s3_urls: closingMediaS3Urls
            });
            setReportStatus(res.data.status);
            toast.success('Query closed successfully');
            setStep('done');
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to close query');
        } finally {
            setUploadingClosingMedia(false);
            setClosing(false);
            setConfirmClose(false);
        }
    };

    const handleCopy = () => { navigator.clipboard.writeText(message); toast.success('Message copied'); };

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
            CLOSED: 'bg-green-200 text-green-800'
        };
        return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', colors[status] || 'bg-slate-200 text-slate-700')}>{status}</span>;
    };

    /* ─── Contact card ─── */
    const ContactCard = ({ contact }) => (
        <div
            className={cn(
                'flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all text-xs',
                selectedContact?.id === contact.id ? 'border-sky-300 bg-sky-50 ring-1 ring-sky-200' : 'border-slate-200 bg-white hover:bg-slate-50'
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
                    className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-sky-600 to-sky-700 text-white cursor-move shrink-0"
                    onMouseDown={(e) => { setDragging(true); setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y }); }}
                >
                    <div className="flex items-center gap-3">
                        <GripHorizontal className="h-5 w-5 opacity-60" />
                        <span className="font-bold text-base">Query Report</span>
                        {uniqueCode && <span className="ml-2 px-3 py-1 bg-yellow-300 rounded font-mono font-bold text-sm text-sky-800">{uniqueCode}</span>}
                        {reportStatus && reportStatus !== 'PENDING' && <StatusBadge status={reportStatus} />}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 mr-4 text-sm">
                            {['compose', 'action', 'done'].map((s, i) => (
                                <span key={s} className={cn('px-3 py-1 rounded-full font-semibold',
                                    step === s || (step === 'close_form' && s === 'action') ? 'bg-white text-sky-700' : 'bg-white/20'
                                )}>{i + 1}. {s === 'compose' ? 'Compose' : s === 'action' ? 'Action' : 'Done'}</span>
                            ))}
                        </div>
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
                                    {/* Category + Phone */}
                                    <div className="grid grid-cols-2 gap-3 mb-3 shrink-0">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                                            <select
                                                value={category}
                                                onChange={(e) => setCategory(e.target.value)}
                                                className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-sky-300 focus:border-sky-400 outline-none"
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
                                    className="bg-sky-600 hover:bg-sky-700 text-white gap-2"
                                    onClick={handleProceed}
                                    disabled={submitting}
                                >
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Proceed
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 2: ACTION (Share / Close) ═══ */}
                    {step === 'action' && !confirmClose && (
                        <div className="flex flex-col h-full">
                            <div className="shrink-0 p-3 border-b bg-slate-50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-slate-900">Share or Close Query</h3>
                                    <StatusBadge status={reportStatus} />
                                </div>
                                <Input
                                    placeholder="Search contacts..."
                                    value={contactSearch}
                                    onChange={(e) => setContactSearch(e.target.value)}
                                    className="text-sm"
                                />
                            </div>

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

                            <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-between items-center">
                                <button className="text-xs text-slate-500 hover:text-slate-700 underline" onClick={() => setStep('compose')}>← Back</button>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-slate-600 border-slate-300 hover:bg-slate-100 gap-1.5"
                                        onClick={() => setStep('done')}
                                    >
                                        Skip & Next →
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                                        onClick={() => setStep('close_form')}
                                    >
                                        <X className="h-3.5 w-3.5" /> Close Query
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP: CLOSE FORM ═══ */}
                    {(step === 'close_form' || confirmClose) && (
                        <div className="flex flex-col h-full">
                            <ScrollArea className="flex-1 p-4 space-y-3">
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-slate-900">Close Query — {uniqueCode}</h3>

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
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Operator Reply</label>
                                        <Textarea
                                            value={operatorReply}
                                            onChange={(e) => setOperatorReply(e.target.value)}
                                            placeholder="Reply sent to the person..."
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
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Closing Attachment Media <span className="text-slate-400">(optional)</span>
                                        </label>
                                        <Input
                                            type="file"
                                            multiple
                                            accept="image/*,video/*,application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/plain,.txt,text/csv,.csv"
                                            onChange={handleClosingFilePick}
                                            className="text-sm"
                                        />
                                        <p className="text-[11px] text-slate-500 mt-1">Upload local files for reference (max 10 files).</p>
                                        {closingFiles.length > 0 && (
                                            <div className="mt-2 space-y-1.5">
                                                {closingFiles.map((file, idx) => (
                                                    <div key={`${file.name}_${file.lastModified}_${idx}`} className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                                        <span className="truncate pr-2">{file.name}</span>
                                                        <button type="button" className="text-red-600 hover:text-red-700" onClick={() => removeClosingFile(file)}>Remove</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </ScrollArea>

                            {confirmClose ? (
                                <div className="shrink-0 p-4 border-t bg-red-50">
                                    <div className="flex items-center gap-2 mb-3">
                                        <AlertTriangle className="h-5 w-5 text-red-600" />
                                        <p className="text-sm font-semibold text-red-800">Are you sure you want to close this query?</p>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setConfirmClose(false)}>No</Button>
                                        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5" onClick={handleCloseQuery} disabled={closing || uploadingClosingMedia}>
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
                                        <X className="h-3.5 w-3.5" /> Close Query
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
                                {reportStatus === 'CLOSED' ? 'Query Closed' : (selectedContact ? 'Action Complete' : 'Query Saved')}
                            </h3>
                            <p className="text-sm text-slate-500 mb-1">
                                Query <span className="font-mono font-semibold text-sky-700">{uniqueCode}</span>
                            </p>
                            <StatusBadge status={reportStatus} />
                            {selectedContact && (
                                <p className="text-xs text-slate-500 mt-2">Shared with {selectedContact.name}</p>
                            )}
                            <div className="flex items-center gap-3 mt-4">
                                {reportStatus !== 'CLOSED' && (
                                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setSelectedContact(null); setStep('action'); }}>
                                        <MessageSquare className="h-4 w-4" /> Share with {selectedContact ? 'another' : 'someone'}
                                    </Button>
                                )}
                                <Button size="sm" onClick={onClose} className="bg-sky-600 hover:bg-sky-700 text-white">Done</Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ─── Resize handle ─── */}
                <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" onMouseDown={() => setResizing(true)} />
            </div>
        </>
    );
};

export default QueryPopup;
