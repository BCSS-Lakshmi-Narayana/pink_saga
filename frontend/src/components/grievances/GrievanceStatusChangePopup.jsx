import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    X, GripHorizontal, Loader2, Check, Copy, Search,
    AlertTriangle, MessageSquare, Phone
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

/* ─── Helpers ─── */
const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
};
const fmtDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return ''; }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*           GRIEVANCE STATUS CHANGE POPUP                          */
/*   Triggered from the post-card dropdown when user picks          */
/*   ESCALATED or CLOSED.                                           */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const GrievanceStatusChangePopup = ({
    grievance,
    targetStatus,          // 'ESCALATED' | 'CLOSED'
    onClose,
    onStatusUpdated,       // callback(grievanceId, newStatus)
    userName = ''
}) => {
    const popupRef = useRef(null);
    const [pos, setPos] = useState({ x: Math.max(60, window.innerWidth / 2 - 340), y: 80 });
    const [size] = useState({ width: 680, height: 560 });
    const [dragging, setDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    /* ─── Report data ─── */
    const [report, setReport] = useState(null);
    const [loadingReport, setLoadingReport] = useState(true);

    /* ─── ESCALATED flow state ─── */
    const [escalateStep, setEscalateStep] = useState('contacts');  // contacts → message → done
    const [contacts, setContacts] = useState([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const [showAllContacts, setShowAllContacts] = useState(false);
    const [selectedContact, setSelectedContact] = useState(null);
    const [escalateMessage, setEscalateMessage] = useState('');
    const [sharing, setSharing] = useState(false);

    /* ─── CLOSED flow state ─── */
    const [closingRemarks, setClosingRemarks] = useState('');
    const [finalReplyToUser, setFinalReplyToUser] = useState('');
    const [firOption, setFirOption] = useState('');      // '' | 'Yes' | 'No'
    const [firNumber, setFirNumber] = useState('');
    const [closingFiles, setClosingFiles] = useState([]);
    const [uploadingClosingMedia, setUploadingClosingMedia] = useState(false);
    const [closing, setClosing] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);

    const isEscalate = targetStatus === 'ESCALATED';
    const isClose = targetStatus === 'CLOSED';

    /* ─── Fetch report data ─── */
    useEffect(() => {
        const reportId = grievance?.grievance_workflow?.report_id;
        if (!reportId) { setLoadingReport(false); return; }
        (async () => {
            try {
                const res = await api.get(`/grievance-workflow/reports/${reportId}`);
                setReport(res.data);
            } catch { toast.error('Could not load report details'); }
            finally { setLoadingReport(false); }
        })();
    }, [grievance]);

    /* ─── Fetch contacts (for ESCALATED) ─── */
    useEffect(() => {
        if (!isEscalate) return;
        setContactsLoading(true);
        api.get('/grievance-workflow/contacts')
            .then(res => setContacts(Array.isArray(res.data) ? res.data : []))
            .catch(() => toast.error('Failed to load contacts'))
            .finally(() => setContactsLoading(false));
    }, [isEscalate]);

    /* ─── Build escalation message ─── */
    const buildEscalationMessage = useCallback((contact) => {
        const g = grievance;
        const r = report;
        if (!g || !r) return '';

        const greeting = getGreeting();
        const uniqueCode = r.unique_code || g.grievance_workflow?.unique_code || '';
        const receivedDate = fmtDate(r.post_date || g.post_date);
        const profileId = g.posted_by?.handle ? `@${g.posted_by.handle}` : (r.profile_id || 'Unknown');
        const complaintPhone = r.complaint_phone || g.complainant_phone || 'N/A';

        // Who was it previously forwarded to?
        const prevOfficer = r.informed_to?.name
            ? `${r.informed_to.name} - ${r.informed_to.department || ''}`
            : 'the concerned officer';
        const forwardedDate = r.shared_at ? fmtDate(r.shared_at) : receivedDate;
        const currentDate = fmtDate(new Date());

        return [
            `Social Media Grievance No: ${uniqueCode}`,
            `Date & Time Received: ${receivedDate}`,
            ``,
            `${greeting} Sir/Ma'am,`,
            ``,
            `On ${receivedDate}, we received a complaint`,
            ``,
            `From user ID: ${profileId}`,
            `Mobile Number: ${complaintPhone}`,
            ``,
            `On ${forwardedDate}, we forwarded this complaint to ${prevOfficer}`,
            `However, it is still pending as of ${currentDate}.`,
            ``,
            `Kindly look into the matter at the earliest.`,
            ``,
            `📌 *Post Details:*`,
            `• Link: ${r.post_link || g.tweet_url || ''}`,
            `• Description: ${(r.post_description || g.content?.full_text || g.content?.text || '').substring(0, 250)}`
        ].join('\n');
    }, [grievance, report]);

    /* ─── Drag logic ─── */
    useEffect(() => {
        if (!dragging) return;
        const onMove = (e) => setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
        const onUp = () => setDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [dragging, dragOffset]);

    /* ─── Filtered contacts ─── */
    const filteredContacts = contactSearch.trim()
        ? contacts.filter(c =>
            (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) ||
            (c.phone || '').includes(contactSearch) ||
            (c.department || '').toLowerCase().includes(contactSearch.toLowerCase())
        )
        : contacts;

    /* ─── Select contact & build escalation message ─── */
    const handleContactSelect = (contact) => {
        setSelectedContact(contact);
        setEscalateMessage(buildEscalationMessage(contact));
        setEscalateStep('message');
    };

    /* ─── WhatsApp share (ESCALATED) ─── */
    const handleEscalateShare = async () => {
        if (!selectedContact || !report) return;
        setSharing(true);
        try {
            // Call share endpoint with explicit ESCALATED flag
            await api.put(`/grievance-workflow/reports/${report.id}/share`, {
                contact_name: selectedContact.name,
                contact_phone: selectedContact.phone,
                contact_department: selectedContact.department || '',
                set_status: 'ESCALATED',
                shared_message: escalateMessage
            });

            // Copy + open WhatsApp
            const phone = selectedContact.phone.replace(/[^0-9]/g, '');
            const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;
            navigator.clipboard.writeText(escalateMessage);
            toast.success('Escalation message copied to clipboard');
            window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(escalateMessage)}`, '_blank');

            onStatusUpdated?.(grievance.id, 'ESCALATED');
            toast.success(`Escalated to ${selectedContact.name} — Status: ESCALATED`);
            setEscalateStep('done');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to escalate');
        } finally { setSharing(false); }
    };

    /* ─── Close grievance (CLOSED) ─── */
    const handleCloseGrievance = async () => {
        if (!report) return;
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

            const firStatusValue = firOption || '';
            const firNumberValue = firOption === 'Yes' ? firNumber.trim() : '';

            await api.put(`/grievance-workflow/reports/${report.id}/close`, {
                closing_remarks: closingRemarks,
                final_reply_to_user: finalReplyToUser,
                fir_status: firStatusValue,
                fir_number: firNumberValue,
                closing_media_s3_urls: closingMediaS3Urls
            });

            onStatusUpdated?.(grievance.id, 'CLOSED');
            toast.success('Grievance closed successfully');
            onClose();
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to close grievance');
        } finally {
            setUploadingClosingMedia(false);
            setClosing(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(escalateMessage);
        toast.success('Message copied');
    };

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

    /* ─── Contact card ─── */
    const ContactCard = ({ contact }) => (
        <div
            className={cn(
                'flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all text-xs',
                selectedContact?.id === contact.id ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : 'border-slate-200 hover:border-amber-200 hover:bg-amber-50/30'
            )}
            onClick={() => handleContactSelect(contact)}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-amber-700" />
                </div>
                <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{contact.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{contact.department || ''} · {contact.phone}</p>
                </div>
            </div>
            <Button
                size="sm"
                className="h-7 text-[10px] bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                onClick={(e) => { e.stopPropagation(); handleContactSelect(contact); }}
            >
                Select
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
                {/* ─── Title bar ─── */}
                <div
                    className={cn(
                        'flex items-center justify-between px-4 py-2.5 text-white cursor-move shrink-0',
                        isEscalate ? 'bg-gradient-to-r from-orange-600 to-orange-700' : 'bg-gradient-to-r from-red-600 to-red-700'
                    )}
                    onMouseDown={(e) => { setDragging(true); setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y }); }}
                >
                    <div className="flex items-center gap-2">
                        <GripHorizontal className="h-4 w-4 opacity-60" />
                        <span className="font-semibold text-sm">
                            {isEscalate ? 'Escalate Grievance' : 'Close Grievance'}
                        </span>
                        {report?.unique_code && (
                            <span className="ml-2 px-2.5 py-0.5 bg-yellow-300 rounded font-mono font-bold text-xs text-red-700">
                                {report.unique_code}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* ─── Loading ─── */}
                {loadingReport ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                ) : !report ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
                        No report found. Please use the G button first to create a report.
                    </div>
                ) : (
                    <div className="flex-1 overflow-hidden flex flex-col">

                        {/* ═══════════ ESCALATED FLOW ═══════════ */}
                        {isEscalate && escalateStep === 'contacts' && (
                            <div className="flex flex-col h-full">
                                <div className="shrink-0 p-3 border-b bg-slate-50 space-y-2">
                                    <h3 className="text-sm font-semibold text-slate-900">
                                        Step 1: Select Contact for Escalation
                                    </h3>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                        <Input
                                            placeholder="Search contacts..."
                                            value={contactSearch}
                                            onChange={(e) => setContactSearch(e.target.value)}
                                            className="text-sm pl-9"
                                        />
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 flex flex-col p-3 gap-1.5 overflow-hidden">
                                    {contactsLoading ? (
                                        <div className="flex items-center justify-center py-6">
                                            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                                        </div>
                                    ) : filteredContacts.length === 0 ? (
                                        <div className="text-center py-6 text-xs text-slate-500">
                                            {contacts.length === 0 ? 'No contacts available.' : 'No match found.'}
                                        </div>
                                    ) : (
                                        <>
                                            {!contactSearch && !showAllContacts ? (
                                                <>
                                                    <div className="space-y-1.5">
                                                        {filteredContacts.slice(0, 2).map(c => (
                                                            <ContactCard key={c.id} contact={c} />
                                                        ))}
                                                    </div>
                                                    {filteredContacts.length > 2 && (
                                                        <div className="flex items-center justify-center">
                                                            <button
                                                                className="text-[11px] text-slate-500 hover:text-slate-700 py-1"
                                                                onClick={() => setShowAllContacts(true)}
                                                            >
                                                                +{filteredContacts.length - 2} more — Show all
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <ScrollArea className="flex-1 min-h-0">
                                                    <div className="space-y-1.5 pr-3">
                                                        {filteredContacts.map(c => (
                                                            <ContactCard key={c.id} contact={c} />
                                                        ))}
                                                    </div>
                                                </ScrollArea>
                                            )}
                                        </>
                                    )}
                                </div>
                                <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-end">
                                    <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                                </div>
                            </div>
                        )}

                        {isEscalate && escalateStep === 'message' && (
                            <div className="flex flex-col h-full">
                                <div className="shrink-0 p-3 border-b bg-slate-50">
                                    <h3 className="text-sm font-semibold text-slate-900">
                                        Step 2: Escalation Message
                                    </h3>
                                    {selectedContact && (
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            To: <strong>{selectedContact.name}</strong> ({selectedContact.phone})
                                        </p>
                                    )}
                                </div>
                                <div className="flex-1 min-h-0 p-4 flex flex-col">
                                    <div className="flex items-center justify-between mb-1.5 shrink-0">
                                        <label className="text-xs font-semibold text-slate-700">
                                            Escalation Message (editable)
                                        </label>
                                        <button onClick={handleCopy} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                                            <Copy className="h-3 w-3" /> Copy
                                        </button>
                                    </div>
                                    <Textarea
                                        value={escalateMessage}
                                        onChange={(e) => setEscalateMessage(e.target.value)}
                                        className="text-sm font-mono resize-none bg-white flex-1 min-h-[280px]"
                                    />
                                </div>
                                <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-between items-center">
                                    <button
                                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                                        onClick={() => { setEscalateStep('contacts'); setSelectedContact(null); }}
                                    >
                                        ← Back to contacts
                                    </button>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
                                            <Copy className="h-3.5 w-3.5" /> Copy
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                                            onClick={handleEscalateShare}
                                            disabled={sharing}
                                        >
                                            {sharing
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : <MessageSquare className="h-3.5 w-3.5" />}
                                            Share on WhatsApp
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {isEscalate && escalateStep === 'done' && (
                            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                                <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center mb-4">
                                    <Check className="h-8 w-8 text-orange-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-1">Grievance Escalated</h3>
                                <p className="text-sm text-slate-500 mb-1">
                                    <span className="font-mono font-semibold text-red-600">{report.unique_code}</span>
                                </p>
                                <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-200 text-orange-800">ESCALATED</span>
                                {selectedContact && (
                                    <p className="text-xs text-slate-500 mt-2">
                                        Escalated to {selectedContact.name} ({selectedContact.department})
                                    </p>
                                )}
                                <Button size="sm" onClick={onClose} className="mt-4 bg-amber-600 hover:bg-amber-700 text-white">
                                    Done
                                </Button>
                            </div>
                        )}

                        {/* ═══════════ CLOSED FLOW ═══════════ */}
                        {isClose && !confirmClose && (
                            <div className="flex flex-col h-full">
                                <ScrollArea className="flex-1 p-4">
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-slate-900">
                                            Close Grievance — {report.unique_code}
                                        </h3>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                                                Closing Remarks <span className="text-red-500">*</span>
                                            </label>
                                            <Textarea
                                                value={closingRemarks}
                                                onChange={(e) => setClosingRemarks(e.target.value)}
                                                placeholder="Enter closing remarks..."
                                                className="text-sm resize-none"
                                                rows={4}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                                                Final Reply to User
                                            </label>
                                            <Textarea
                                                value={finalReplyToUser}
                                                onChange={(e) => setFinalReplyToUser(e.target.value)}
                                                placeholder="Enter final reply..."
                                                className="text-sm resize-none"
                                                rows={2}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                                                Converted to FIR
                                            </label>
                                            <select
                                                value={firOption}
                                                onChange={(e) => { setFirOption(e.target.value); setFirNumber(''); }}
                                                className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-red-300 outline-none"
                                            >
                                                <option value="">Select</option>
                                                <option value="Yes">Yes</option>
                                                <option value="No">No</option>
                                            </select>
                                            {firOption === 'Yes' && (
                                                <div className="mt-2">
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                                        FIR Number
                                                    </label>
                                                    <Input
                                                        value={firNumber}
                                                        onChange={(e) => setFirNumber(e.target.value)}
                                                        placeholder="Enter FIR Number"
                                                        className="text-sm"
                                                    />
                                                </div>
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

                                <div className="shrink-0 p-3 border-t bg-slate-50 flex justify-between items-center">
                                    <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                                    <Button
                                        size="sm"
                                        className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                                        onClick={() => {
                                            if (!closingRemarks.trim()) {
                                                toast.error('Closing remarks are required');
                                                return;
                                            }
                                            setConfirmClose(true);
                                        }}
                                    >
                                        <X className="h-3.5 w-3.5" /> Close Grievance
                                    </Button>
                                </div>
                            </div>
                        )}

                        {isClose && confirmClose && (
                            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                                <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                                    <AlertTriangle className="h-8 w-8 text-red-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">
                                    Are you sure you want to close this grievance?
                                </h3>
                                <p className="text-sm text-slate-500 mb-1">
                                    <span className="font-mono font-semibold text-red-600">{report.unique_code}</span>
                                </p>
                                {firOption === 'Yes' && firNumber && (
                                    <p className="text-xs text-slate-600 mb-1">FIR Number: <strong>{firNumber}</strong></p>
                                )}
                                <p className="text-xs text-slate-500 mb-4 max-w-sm">
                                    This will store closing remarks, update status to CLOSED, and log the action.
                                </p>
                                <div className="flex items-center gap-3">
                                    <Button variant="outline" size="sm" onClick={() => setConfirmClose(false)}>
                                        No, Go Back
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                                        onClick={handleCloseGrievance}
                                        disabled={closing || uploadingClosingMedia}
                                    >
                                        {(closing || uploadingClosingMedia)
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <Check className="h-3.5 w-3.5" />}
                                        Yes, Close
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default GrievanceStatusChangePopup;
