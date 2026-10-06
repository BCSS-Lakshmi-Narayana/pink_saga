import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    X, GripHorizontal, Send, UserPlus, Phone, Building2,
    MessageSquare, ChevronDown, Loader2, Check, Copy, ExternalLink
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

/* ─── Greeting based on time of day ─── */
const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
};

/* ─── Format engagement number ─── */
const fmtNum = (n) => {
    if (!n || n === 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
};

const extractRemarksFromMessage = (text = '') => {
    if (!text) return '';
    const normalized = String(text).replace(/\r\n/g, '\n');
    const [beforePostDetails = ''] = normalized.split(/(?:📌\s*)?\*Post Details:\*/i);
    return beforePostDetails.trim();
};

const extractPhoneFromText = (text = '') => {
    const match = text.match(/(?:\+91[\s-]?)?(?:0)?[6-9]\d{4}[\s-]?\d{5}/);
    return match ? match[0].replace(/[\s-]/g, '') : '';
};

const normalizeMediaList = (media) => {
    if (!Array.isArray(media)) return [];
    return media
        .map((item) => {
            if (!item) return null;
            const type = item.type || item.media_type || (item.video_url ? 'video' : 'photo');
            const url = item.url || item.video_url || item.preview || item.preview_url;
            if (!url) return null;
            return {
                type,
                url: item.url || url,
                video_url: item.video_url || null,
                preview: item.preview || item.preview_url || null,
                preview_url: item.preview_url || item.preview || null
            };
        })
        .filter(Boolean);
};

const CATEGORIES = [
    'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'She Team', 'Task force', 'Traffic'
];
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                       CRITICISM POPUP                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const CriticismPopup = ({ grievance, onClose, userName = '' }) => {
    /* ─── Position & Size (draggable + resizable) ─── */
    const popupRef = useRef(null);
    const [pos, setPos] = useState({ x: 20, y: Math.max(20, (window.innerHeight - 620) / 2) });
    const [size, setSize] = useState({ width: 720, height: 620 });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    /* ─── Step management ─── */
    const [step, setStep] = useState('compose'); // compose | contacts | done

    /* ─── Data ─── */
    const [message, setMessage] = useState('');
    const [category, setCategory] = useState('Others');
    const [uniqueCode, setUniqueCode] = useState('');
    const [reportId, setReportId] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    /* ─── Contacts ─── */
    const [contacts, setContacts] = useState([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [selectedContact, setSelectedContact] = useState(null);
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContact, setNewContact] = useState({ name: '', phone: '', department: '', designation: '' });
    const [addingContact, setAddingContact] = useState(false);
    const [sharing, setSharing] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const [showAllContactsList, setShowAllContactsList] = useState(false);

    /* ─── Build auto message ─── */
    const buildMessage = useCallback(() => {
        const g = grievance;
        if (!g) return '';

        const greeting = getGreeting();
        const author = g.posted_by?.display_name || g.posted_by?.handle || 'Unknown';
        const handle = g.posted_by?.handle ? `@${g.posted_by.handle}` : '';
        const desc = g.content?.full_text || g.content?.text || '';
        const link = g.tweet_url || g.url || g.post_url || '';
        const engagement = g.engagement || g.metrics || {};
        const views = fmtNum(engagement.views || engagement.impression_count || 0);
        const reposts = fmtNum(engagement.retweet_count || engagement.reposts || engagement.shares || 0);
        const likes = fmtNum(engagement.like_count || engagement.likes || engagement.reactions || 0);
        const replies = fmtNum(engagement.reply_count || engagement.replies || engagement.comments || 0);
        const platform = g.platform || 'x';
        const platformName = platform === 'x' ? 'X (Twitter)' : platform === 'facebook' ? 'Facebook' : 'WhatsApp';
        const phone = extractPhoneFromText(desc) || g.complainant_phone || 'None';

        const lines = [
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
            `# views: ${views} | reposts: ${reposts} | likes: ${likes} | replies: ${replies}`
        ];

        return lines.join('\n');
    }, [grievance]);

    /* ─── Initialize message on mount ─── */
    useEffect(() => {
        setMessage(buildMessage());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ─── Drag handlers ─── */
    useEffect(() => {
        if (!dragging) return;
        const onMove = (e) => setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
        const onUp = () => setDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [dragging, dragOffset]);

    /* ─── Resize handlers ─── */
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e) => {
            if (!popupRef.current) return;
            const rect = popupRef.current.getBoundingClientRect();
            setSize({ width: Math.max(480, e.clientX - rect.left), height: Math.max(400, e.clientY - rect.top) });
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
            const res = await api.get('/criticism/contacts');
            setContacts(res.data || []);
        } catch { /* silent */ }
        finally { setContactsLoading(false); }
    }, []);

    /* ─── Submit report ─── */
    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const g = grievance;
            const engagement = g.engagement || g.metrics || {};
            const context = g.context || {};

            const mediaItems = Array.from(new Map(
                [
                    ...normalizeMediaList(g.content?.media),
                    ...normalizeMediaList(context?.content?.media),
                    ...normalizeMediaList(context?.quoted?.content?.media),
                    ...normalizeMediaList(context?.in_reply_to?.content?.media),
                    ...normalizeMediaList(context?.reposted_from?.content?.media),
                    ...normalizeMediaList(context?.parent?.content?.media),
                    ...normalizeMediaList(context?.thread_parent?.content?.media)
                ]
                    .map((item) => [item.video_url || item.url, item])
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
                    views: engagement.views || engagement.impression_count || 0,
                    reposts: engagement.retweet_count || engagement.reposts || engagement.shares || 0,
                    likes: engagement.like_count || engagement.likes || engagement.reactions || 0,
                    replies: engagement.reply_count || engagement.replies || engagement.comments || 0
                },
                category,
                media_items: mediaItems,
                media_urls: mediaItems.map((m) => m.video_url || m.url).filter(Boolean),
                remarks: extractRemarksFromMessage(message),
                message
            };

            const res = await api.post('/criticism/reports', payload);
            const report = res.data;

            setUniqueCode(report.unique_code);
            setReportId(report.id);
            setSubmitted(true);

            // Update message with real unique code
            setMessage((prev) => {
                if (prev.includes('[Will be generated on submit]')) {
                    return prev.replace('[Will be generated on submit]', report.unique_code);
                }
                if (/\*Unique ID:\*/i.test(prev)) {
                    return prev.replace(/(\*Unique ID:\*\s*)(.*)/i, `$1${report.unique_code}`);
                }
                return `${prev}\n\n🔖 *Unique ID:* ${report.unique_code}`;
            });

            toast.success(`Criticism report created: ${report.unique_code}`);

            // Move to contacts step
            setStep('contacts');
            fetchContacts();
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to create criticism report');
        } finally {
            setSubmitting(false);
        }
    };

    /* ─── Add a new contact ─── */
    const handleAddContact = async () => {
        if (!newContact.name.trim() || !newContact.phone.trim()) {
            toast.error('Name and phone are required');
            return;
        }
        setAddingContact(true);
        try {
            const res = await api.post('/criticism/contacts', newContact);
            setContacts(prev => [...prev, res.data]);
            setNewContact({ name: '', phone: '', department: '', designation: '' });
            setShowAddContact(false);
            toast.success('Contact added');
        } catch {
            toast.error('Failed to add contact');
        } finally {
            setAddingContact(false);
        }
    };

    /* ─── Share via WhatsApp ─── */
    const handleShare = async (contact) => {
        if (!contact) {
            toast.error('Please select a contact');
            return;
        }
        setSharing(true);
        try {
            // Record the share in DB
            if (reportId) {
                await api.put(`/criticism/reports/${reportId}/share`, {
                    contact_id: contact.id,
                    contact_name: contact.name,
                    contact_phone: contact.phone,
                    contact_department: contact.department || ''
                });
            }

            // Open WhatsApp with pre-filled message
            const phone = contact.phone.replace(/[^0-9]/g, '');
            const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;

            // Append Unique ID if available for sharing
            let finalMsg = message;
            if (uniqueCode) {
                finalMsg += `\n\n🔖 *Social Media Grienvence Number * ${uniqueCode}`;
            }

            const encodedMessage = encodeURIComponent(finalMsg);
            const whatsappUrl = `https://wa.me/${phoneWithCountry}?text=${encodedMessage}`;
            window.open(whatsappUrl, '_blank');

            toast.success(`Shared with ${contact.name} via WhatsApp`);
            setSelectedContact(contact);
            setStep('done');
        } catch {
            toast.error('Failed to record share');
        } finally {
            setSharing(false);
        }
    };

    /* ─── Copy message to clipboard ─── */
    const handleCopyMessage = () => {
        navigator.clipboard.writeText(message);
        toast.success('Message copied to clipboard');
    };

    /* ─── Filtered contacts ─── */
    const filteredContacts = contacts.filter(c =>
        !contactSearch ||
        c.name?.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.phone?.includes(contactSearch) ||
        c.department?.toLowerCase().includes(contactSearch.toLowerCase())
    );

    /* ━━━━━ RENDER ━━━━━ */
    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={onClose} />

            {/* Popup */}
            <div
                ref={popupRef}
                className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden select-none"
                style={{
                    left: pos.x,
                    top: pos.y,
                    width: size.width,
                    height: size.height,
                }}
            >
                {/* ─── Title Bar (drag handle) ─── */}
                <div
                    className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-red-600 to-red-700 text-white cursor-move shrink-0"
                    onMouseDown={(e) => {
                        setDragging(true);
                        setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
                    }}
                >
                    <div className="flex items-center gap-3">
                        <GripHorizontal className="h-5 w-5 opacity-60" />
                        <span className="font-bold text-base">Criticism Report</span>
                        {uniqueCode && (
                            <span className="ml-2 px-3 py-1 bg-yellow-300 rounded font-mono font-bold text-sm text-red-700">{uniqueCode}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Step indicator */}
                        <div className="flex items-center gap-2 mr-4 text-sm">
                            <span className={cn(
                                'px-3 py-1 rounded-full font-semibold',
                                step === 'compose' ? 'bg-white text-red-700' : 'bg-white/20'
                            )}>1. Compose</span>
                            <span className={cn(
                                'px-3 py-1 rounded-full font-semibold',
                                step === 'contacts' ? 'bg-white text-red-700' : 'bg-white/20'
                            )}>2. Share</span>
                            <span className={cn(
                                'px-3 py-1 rounded-full font-semibold',
                                step === 'done' ? 'bg-white text-red-700' : 'bg-white/20'
                            )}>3. Done</span>
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded transition-colors">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* ─── Content ─── */}
                <div className="flex-1 overflow-hidden">
                    {/* ═══ STEP 1: COMPOSE ═══ */}
                    {step === 'compose' && (
                        <div className="flex flex-col h-full">
                            <ScrollArea className="flex-1 p-4">
                                <div className="h-full min-h-0 flex flex-col">
                                    {/* Category */}
                                    <div className="mb-3 shrink-0">
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                                        <select
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value)}
                                            className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-red-300 focus:border-red-400 outline-none"
                                        >
                                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>

                                    {/* Generated message preview */}
                                    <div className="flex-1 min-h-0 flex flex-col">
                                        <div className="flex items-center justify-between mb-1.5 shrink-0">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Message Preview (editable)
                                            </label>
                                            <button
                                                onClick={handleCopyMessage}
                                                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                            >
                                                <Copy className="h-3 w-3" /> Copy
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mb-1.5">
                                            Text above “Post Details” will be saved as remarks.
                                        </p>
                                        <Textarea
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            className="text-sm font-mono resize-none bg-white flex-1 min-h-[320px]"
                                        />
                                    </div>
                                </div>
                            </ScrollArea>

                            {/* Submit button */}
                            <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                                <Button
                                    size="sm"
                                    className="bg-red-600 hover:bg-red-700 text-white gap-2"
                                    onClick={handleSubmit}
                                    disabled={submitting}
                                >
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Submit & Continue
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 2: SELECT CONTACT & SHARE ═══ */}
                    {step === 'contacts' && (
                        <div className="flex flex-col h-full">
                            <div className="shrink-0 p-3 border-b bg-slate-50">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-semibold text-slate-900">Select Contact to Share</h3>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5 text-xs"
                                        onClick={() => setShowAddContact(!showAddContact)}
                                    >
                                        <UserPlus className="h-3.5 w-3.5" />
                                        Add Contact
                                    </Button>
                                </div>

                                {/* Add Contact Form */}
                                {showAddContact && (
                                    <div className="p-3 bg-white rounded-lg border border-slate-200 mb-2 space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                placeholder="Name *"
                                                value={newContact.name}
                                                onChange={(e) => setNewContact(p => ({ ...p, name: e.target.value }))}
                                                className="text-sm"
                                            />
                                            <Input
                                                placeholder="Phone * (e.g. 9876543210)"
                                                value={newContact.phone}
                                                onChange={(e) => setNewContact(p => ({ ...p, phone: e.target.value }))}
                                                className="text-sm"
                                            />
                                            <Input
                                                placeholder="Department"
                                                value={newContact.department}
                                                onChange={(e) => setNewContact(p => ({ ...p, department: e.target.value }))}
                                                className="text-sm"
                                            />
                                            <Input
                                                placeholder="Designation"
                                                value={newContact.designation}
                                                onChange={(e) => setNewContact(p => ({ ...p, designation: e.target.value }))}
                                                className="text-sm"
                                            />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setShowAddContact(false)}>Cancel</Button>
                                            <Button size="sm" onClick={handleAddContact} disabled={addingContact} className="gap-1.5">
                                                {addingContact ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                                Save Contact
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Search contacts */}
                                <Input
                                    placeholder="Search contacts..."
                                    value={contactSearch}
                                    onChange={(e) => setContactSearch(e.target.value)}
                                    className="text-sm"
                                />
                            </div>

                            <div className="flex-1 min-h-0 flex flex-col p-3 gap-1.5 overflow-hidden">
                                {contactsLoading ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                                    </div>
                                ) : filteredContacts.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-slate-500">
                                        {contacts.length === 0 ? 'No contacts yet. Add one above.' : 'No contacts match your search.'}
                                    </div>
                                ) : (
                                    <>
                                        {/* When search is empty and not expanded, show only top 2 */}
                                        {!contactSearch && !showAllContactsList ? (
                                            <>
                                                <div className="space-y-1">
                                                    {filteredContacts.slice(0, 2).map((contact) => (
                                                        <div
                                                            key={contact.id}
                                                            className={cn(
                                                                'flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all text-xs',
                                                                selectedContact?.id === contact.id
                                                                    ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
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
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleShare(contact);
                                                                }}
                                                                disabled={sharing}
                                                            >
                                                                {sharing && selectedContact?.id === contact.id
                                                                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                                    : <MessageSquare className="h-2.5 w-2.5" />
                                                                }
                                                                Share
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>

                                                {filteredContacts.length > 2 && (
                                                    <div className="flex items-center justify-center">
                                                        <button
                                                            className="text-[11px] text-slate-500 hover:text-slate-700 py-1"
                                                            onClick={() => setShowAllContactsList(true)}
                                                        >
                                                            +{filteredContacts.length - 2} more — Show all
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            /* Show full results (either because search active or user expanded) */
                                            <ScrollArea className="flex-1 min-h-0">
                                                <div className="space-y-1 pr-3">
                                                    {filteredContacts.map((contact) => (
                                                        <div
                                                            key={contact.id}
                                                            className={cn(
                                                                'flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all text-xs',
                                                                selectedContact?.id === contact.id
                                                                    ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                                            )}
                                                            onClick={() => setSelectedContact(contact)}
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-600 shrink-0">
                                                                    {contact.name?.charAt(0)?.toUpperCase() || '?'}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-slate-900 truncate">{contact.name}</p>
                                                                    <p className="text-[9px] text-slate-500">{contact.phone} {contact.department ? '· ' + contact.department : ''}</p>
                                                                </div>
                                                            </div>

                                                            <Button
                                                                size="sm"
                                                                className="gap-1 bg-green-600 hover:bg-green-700 text-white h-7 px-2 shrink-0"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleShare(contact);
                                                                }}
                                                                disabled={sharing}
                                                            >
                                                                {sharing && selectedContact?.id === contact.id
                                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                    : <MessageSquare className="h-3 w-3" />
                                                                }
                                                                WhatsApp
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-start items-center">
                                <button
                                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                                    onClick={() => setStep('compose')}
                                >
                                    ← Back to edit message
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 3: DONE ═══ */}
                    {step === 'done' && (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                                <Check className="h-8 w-8 text-green-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-1">Report Shared Successfully</h3>
                            <p className="text-sm text-slate-500 mb-4">
                                Criticism report <span className="font-mono font-semibold text-red-600">{uniqueCode}</span> has been
                                shared with <span className="font-semibold">{selectedContact?.name}</span> via WhatsApp.
                            </p>
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => {
                                        setSelectedContact(null);
                                        setStep('contacts');
                                    }}
                                >
                                    <MessageSquare className="h-4 w-4" /> Share with another
                                </Button>
                                <Button size="sm" onClick={onClose} className="bg-red-600 hover:bg-red-700 text-white">
                                    Done
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ─── Resize Handle (bottom-right corner) ─── */}
                <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setResizing(true);
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" className="text-slate-400">
                        <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M14 14L14 11M14 14L11 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </div>
            </div>
        </>
    );
};

export default CriticismPopup;
