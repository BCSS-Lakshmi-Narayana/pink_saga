import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import api from '../lib/api';
import {
    ArrowLeft, Printer, AlertCircle, Loader2, Repeat2, Save, CheckCircle, AlertTriangle, FileText, ChevronDown
} from 'lucide-react';
import { Button } from '../components/ui/button';
import * as ReactToPrintModule from 'react-to-print';
const useReactToPrint = ReactToPrintModule.useReactToPrint || (ReactToPrintModule.default && ReactToPrintModule.default.useReactToPrint);
import { format } from 'date-fns';

const RichTextEditor = lazy(() => import('../components/RichTextEditor'));

const GenerateReport = () => {
    const { id } = useParams();
    const location = useLocation();
    const [alert, setAlert] = useState(null);
    const [content, setContent] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const reportRef = useRef();
    const isInitialLoadRef = useRef(true);

    // Template state
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState(null);
    const [templateHtml, setTemplateHtml] = useState('');
    const [useCustomTemplate, setUseCustomTemplate] = useState(false);
    const [templateLoading, setTemplateLoading] = useState(false);

    // Query params
    const queryParams = new URLSearchParams(location.search);
    const shouldAutoPrint = queryParams.get('print') === 'true';

    // ... (rest of states remain same)

    // --- SECTION-LEVEL EDITABLE STATES ---
    const [headerGovt, setHeaderGovt] = useState('Government of Telangana');
    const [headerDept, setHeaderDept] = useState('([ISSUING DEPARTMENT])');
    const [dateLine, setDateLine] = useState('');
    const [subject, setSubject] = useState('');
    const [greeting, setGreeting] = useState('Sir/Madam,');
    const [introText, setIntroText] = useState('');
    const [bodyText, setBodyText] = useState('');

    // Account details sections
    const [accountHeader, setAccountHeader] = useState('Alleged X Account URL');
    const [targetUserLine, setTargetUserLine] = useState('');
    const [profileUrl, setProfileUrl] = useState('');
    const [isRepost, setIsRepost] = useState(false);
    const [originalUserLine, setOriginalUserLine] = useState('');
    const [originalProfileUrl, setOriginalProfileUrl] = useState('');

    const [postHeader, setPostHeader] = useState('Alleged Post/Tweet URL');
    const [contentUrl, setContentUrl] = useState('');

    // Logical Blocks
    const [legalBlock, setLegalBlock] = useState('');
    const [requestBlock, setRequestBlock] = useState('');
    const [closingStatement, setClosingStatement] = useState('');
    const [declarationBlock, setDeclarationBlock] = useState('');
    const [addressBlock, setAddressBlock] = useState('');
    const [recipientBlock, setRecipientBlock] = useState('');
    const [signatureBlock, setSignatureBlock] = useState('');

    const [serialNumber, setSerialNumber] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [alertRes, reportRes] = await Promise.all([
                    api.get(`/alerts/${id}`),
                    api.get(`/reports`).then(res => res.data.find(r => r.alert_id === id)).catch(() => null)
                ]);

                const alertData = alertRes.data;
                let reportData = reportRes || null;

                // IF NO REPORT EXISTS, CREATE IT NOW
                // This ensures the report is saved to DB immediately when user opens this page
                if (!reportData && alertData) {
                    try {
                        const createRes = await api.post(`/reports/escalate/${id}`);
                        reportData = createRes.data;
                        console.log('Auto-created report:', reportData);
                    } catch (err) {
                        console.error('Failed to auto-create report:', err);
                    }
                }

                if (!alertData) {
                    setLoading(false);
                    return;
                }

                setAlert(alertData);
                setReport(reportData || null);

                let contentData = null;
                if (alertData.content_id) {
                    try {
                        const contentRes = await api.get(`/content/${alertData.content_id}`);
                        contentData = contentRes.data;
                        setContent(contentData);
                    } catch (e) {
                        console.warn('Content fetch failed', e);
                    }
                }

                // --- DATA SYNCHRONIZATION ---
                const platform = alertData.platform?.toUpperCase() || 'X';
                const pCode = alertData.platform === 'x' ? 'TW' : alertData.platform === 'facebook' ? 'FB' : 'YT';
                const operator = alertData.platform === 'x' ? 'X Corp.' : alertData.platform === 'facebook' ? 'Meta' : 'Google';
                const domain = alertData.platform === 'x' ? 'www.x.com' : alertData.platform === 'facebook' ? 'www.facebook.com' : 'www.youtube.com';

                // Load existing edits or defaults
                const edits = reportData?.edited_content || {};

                const dd = format(new Date(), 'dd');
                const mm = format(new Date(), 'MM');
                const yyyy = format(new Date(), 'yyyy');
                setSerialNumber(reportData?.serial_number || `${pCode.substring(0, 1)}0001 - ${dd}${mm}${yyyy} `);

                setHeaderGovt(edits.headerGovt || 'Government of Telangana');
                setHeaderDept(edits.headerDept || '([ISSUING DEPARTMENT])');
                setDateLine(edits.dateLine || `Date: ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')} `);

                const sectionsList = alertData.legal_sections?.length > 0
                    ? alertData.legal_sections.map(s => s.section).join(', ')
                    : '505, 353, 153A, 196';
                setSubject(edits.subject || `NOTICE: U/Sec: 69(A) & 79(3) Information Technology Amendment Act 2008 and 94 BNSS of India. (Cr.No [__]/${yyyy}, U/Sec ${sectionsList} of BNS of [Police Station / Unit], Telangana)`);

                setGreeting(edits.greeting || 'Sir/Madam,');
                setIntroText(edits.introText || `I am the [Designation], presently working at [Unit / Office], Telangana, India. I am investigating the above-referenced crime, which pertains to the circulation of objectionable and communally sensitive content on the social media platform ${platform} (formerly Twitter) operated by ${operator}.`);

                let postDateStr = 'recent date';
                try {
                    const d = contentData?.published_at ? new Date(contentData.published_at) : new Date();
                    postDateStr = format(d, 'do MMMM yyyy');
                } catch (e) {
                    postDateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                }

                const intent = alertData.threat_details?.intent || 'circulation of sensitive content';
                setBodyText(edits.bodyText || `It is brought to notice that on ${postDateStr}, posts/videos were uploaded through the below-mentioned ${platform} account, containing content relating to the ${intent}. The said content is highly sensitive in nature, and its continued circulation is likely to incite communal disharmony, thereby posing a serious threat to public order and law & order across the State of Telangana, India.`);

                setAccountHeader(edits.accountHeader || `Alleged ${platform} Account URL`);

                const name = reportData?.target_user_details?.name || alertData.author || 'User';
                const handle = (reportData?.target_user_details?.handle || alertData.author_handle || alertData.author || '').replace('@', '');
                setTargetUserLine(edits.targetUserLine || `${name} – @${handle} `);
                setProfileUrl(edits.profileUrl || reportData?.target_user_details?.profile_url || (platform === 'X' ? `https://x.com/${handle}` : `https://${platform.toLowerCase()}.com/${handle}`));

                setPostHeader(edits.postHeader || `Alleged Post/Tweet URL`);
                setContentUrl(edits.contentUrl || alertData.content_url || '#');

                const isRep = (contentData?.is_repost === true);
                setIsRepost(isRep);
                if (isRep) {
                    const origAuthor = contentData.original_author_name || contentData.original_author || 'Original Author';
                    const origHandle = (contentData.original_author || '').replace('@', '');
                    setOriginalUserLine(edits.originalUserLine || `${origAuthor} – @${origHandle}`);
                    setOriginalProfileUrl(edits.originalProfileUrl || (platform === 'X' ? `https://x.com/${origHandle}` : `https://${platform.toLowerCase()}.com/${origHandle}`));
                }

                // GROUPED: Legal Block
                if (edits.legalBlock) {
                    setLegalBlock(edits.legalBlock);
                } else {
                    const legalIntroText = `The acts done by the ${platform} User are punishable in India under the Sections of Law, Section U/Sec ${sectionsList} Bharatiya Nyaya Sanhita.`;
                    const defaultLegal = [
                        { section: '352', act: 'BNS 2023', description: 'Intentional insult with intent to provoke breach of peace.' },
                        { section: '196', act: 'BNS 2023', description: 'Promoting enmity / acts prejudicial to maintenance of harmony.' },
                        { section: '351', act: 'BNS 2023', description: 'Criminal intimidation (threatening to cause injury).' }
                    ];
                    const legalSecs = (alertData.legal_sections?.length > 0 ? alertData.legal_sections : defaultLegal)
                        .map(sec => `Section ${sec.section} ${sec.act || 'BNS'}:\n${sec.description}`)
                        .join('\n\n');
                    setLegalBlock(`${legalIntroText}\n\n${legalSecs}`);
                }

                // GROUPED: Request Block
                setRequestBlock(edits.requestBlock || (
                    `In this connection it is requested to furnish the following information for the purpose of investigation.\n\n` +
                    `1. Immediately Furnish the details of the alleged account\n` +
                    `2. IPlogs of the user from 01.11.2025 to till date\n` +
                    `3. Registered email id of the above-mentioned Accounts\n` +
                    `4. Registered mobile number of Accounts mentioned above.`
                ));

                setClosingStatement(edits.closingStatement || `I would like to inform that furnishing of the requested information may go a long way in further improving the service offered by ${domain} and also making users feel safe while on ${domain}`);

                // GROUPED: Declaration & Address Block
                setDeclarationBlock(edits.declarationBlock || (
                    `DECLARATION\n\n` +
                    `I declare that the case under investigation is not political, Military, Racial or Religious character as required under Mutual Legal Assistance Treaty (MLAT) and arrangements of international conventions under which the request was being made.\n\n` +
                    `I further declare that the information requested shall be used only for the purpose of the investigation of this case and shall not be disclosed directly or indirectly to any other agency or person without the consent of the competent authority of ${operator}`
                ));

                setAddressBlock(edits.addressBlock || (
                    `[Office name]\n` +
                    `[Street address]\n` +
                    `[City], Telangana, India. Mobile No: [__________]\n` +
                    `e-mail ID: [official e-mail]`
                ));

                setRecipientBlock(edits.recipientBlock || (
                    `To\n` +
                    `${alertData.platform === 'x' ? 'X Corp.' : alertData.platform === 'facebook' ? 'Meta Platforms, Inc.' : 'Google LLC'}\n` +
                    `c/o Trust & Safety - Legal Policy\n` +
                    `${alertData.platform === 'x' ? '1355 Market Street, Suite 900' : '1601 Willow Road'}\n` +
                    `${alertData.platform === 'x' ? 'San Francisco, CA 94103' : 'Menlo Park, CA 94025'}`
                ));

                setSignatureBlock(edits.signatureBlock || (
                    `[Designation],\n` +
                    `[Unit / Office]\n` +
                    `TELANGANA.`
                ));

                // --- SIMILAR ALERTS CHECK (Run Once) ---
                const textToCheck = contentData?.text || alertData.description;
                if (textToCheck) {
                    try {
                        const simRes = await api.post('/alerts/similar', { text: textToCheck });
                        if (simRes.data.similarCount > 0) {
                            const others = simRes.data.alerts.filter(a => a.id !== id);
                            if (others.length > 0) {
                                setSimilarAlerts(others);
                                setShowSimilarityDialog(true);
                            }
                        }
                    } catch (simErr) {
                        console.error('Failed to check similar alerts:', simErr);
                    }
                }

                setLoading(false);
            } catch (err) {
                console.error('Master fetch error:', err);
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    // Fetch templates for this platform and restore previously selected template
    useEffect(() => {
        if (!alert) return;
        const fetchTemplates = async () => {
            try {
                const res = await api.get(`/templates?platform=${alert.platform || 'x'}`);
                setTemplates(res.data || []);

                // Check if report has a previously selected template
                const savedTemplateId = report?.edited_content?.selectedTemplateId;
                const savedTemplateHtml = report?.edited_content?.templateHtml;

                if (savedTemplateId && savedTemplateHtml) {
                    // Restore saved template and HTML
                    setSelectedTemplateId(savedTemplateId);
                    setTemplateHtml(savedTemplateHtml);
                    setUseCustomTemplate(true);
                } else {
                    // Auto-select default template if exists
                    const defaultTpl = res.data?.find(t => t.is_default);
                    if (defaultTpl) {
                        setSelectedTemplateId(defaultTpl.id);
                        loadTemplateHtml(defaultTpl.id);
                    }
                }
            } catch (err) {
                console.error('Failed to load templates:', err);
            }
        };
        fetchTemplates();
    }, [alert, report]);

    // Track unsaved changes
    useEffect(() => {
        // Skip on initial load
        if (isInitialLoadRef.current || loading || !report) {
            if (!loading && report) {
                isInitialLoadRef.current = false;
            }
            setHasUnsavedChanges(false);
            return;
        }
        // If successfully saved, reset flag
        if (saveSuccess) {
            const timer = setTimeout(() => {
                setHasUnsavedChanges(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
        // Any edits after initial load = unsaved changes
        setHasUnsavedChanges(true);
    }, [headerGovt, headerDept, dateLine, subject, greeting, introText, bodyText,
        accountHeader, targetUserLine, profileUrl, originalUserLine, originalProfileUrl,
        postHeader, contentUrl, legalBlock, requestBlock, closingStatement,
        declarationBlock, addressBlock, recipientBlock, signatureBlock,
        templateHtml, selectedTemplateId, useCustomTemplate, loading, report?.id]);

    const loadTemplateHtml = async (templateId) => {
        if (!templateId) {
            setUseCustomTemplate(false);
            setTemplateHtml('');
            return;
        }
        try {
            setTemplateLoading(true);
            const res = await api.post(`/templates/${templateId}/generate/${id}`);
            setTemplateHtml(res.data.html);
            setUseCustomTemplate(true);
        } catch (err) {
            console.error('Failed to load template:', err);
            setUseCustomTemplate(false);
        } finally {
            setTemplateLoading(false);
        }
    };

    const handleTemplateChange = (templateId) => {
        if (templateId === 'default') {
            setSelectedTemplateId(null);
            setUseCustomTemplate(false);
            setTemplateHtml('');
        } else {
            setSelectedTemplateId(templateId);
            loadTemplateHtml(templateId);
        }
    };

    // Check for similar escalated alerts
    const [similarAlerts, setSimilarAlerts] = useState([]);
    const [showSimilarityDialog, setShowSimilarityDialog] = useState(false);

    const saveReport = async (silent = false) => {
        try {
            if (!silent) setSaving(true);
            const edited_content = {
                headerGovt, headerDept, dateLine, subject, greeting, introText, bodyText,
                accountHeader, targetUserLine, profileUrl, originalUserLine, originalProfileUrl,
                postHeader, contentUrl, legalBlock, requestBlock, closingStatement,
                declarationBlock, addressBlock, recipientBlock, signatureBlock,
                // Template-related data
                selectedTemplateId: selectedTemplateId || null,
                templateHtml: useCustomTemplate ? templateHtml : null
            };

            await api.put(`/reports/${id}`, { edited_content });

            if (!silent) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
            }
        } catch (err) {
            console.error('Save failed', err);
        } finally {
            if (!silent) setSaving(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: reportRef,
        documentTitle: `Official_Notice_${serialNumber}`,
        onBeforePrint: () => saveReport(true),
        pageStyle: `
            @page {
                size: A4;
                margin: 25mm 20mm !important; /* Forces professional margins on every physical page */
            }
            @media print {
                * {
                    box-sizing: border-box !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    background: white !important;
                    color: black !important;
                    font-size: 14px !important;
                }

                /* Hide all non-printable UI */
                .no-print, 
                nav, aside, header, footer, 
                button, [role="banner"],
                [class*="sidebar"],
                [class*="ql-toolbar"], [class*="tox-"],
                .bg-slate-100 > .max-w-5xl,
                .fixed {
                    display: none !important;
                }

                /* Container visibility */
                .min-h-screen, .no-print-workspace {
                    min-height: 0 !important;
                    height: auto !important;
                    padding: 0 !important;
                    background: white !important;
                }

                .print-area {
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    border: 0 !important;
                    outline: 0 !important;
                    background: white !important;
                    overflow: visible !important;
                }

                /* Page Layout */
                .report-page, .report-page-sheet {
                    page-break-after: always !important;
                    page-break-inside: auto !important;
                    width: 100% !important;
                    height: auto !important;
                    padding: 0 !important; /* Controlled by @page margins now */
                    margin: 0 !important;
                    border: 0 !important;
                    outline: 0 !important;
                    box-shadow: none !important;
                    background: white !important;
                    display: block !important;
                    overflow: visible !important;
                }
                .report-page:last-child {
                    page-break-after: auto;
                    margin-bottom: 0 !important;
                }


                /* Editor Content Cleanup */
                .ql-container, .ql-editor,
                [class*="editor-content"],
                [class*="ProseMirror"] {
                    border: none !important;
                    box-shadow: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    min-height: auto !important;
                    overflow: visible !important;
                    color: black !important;
                }

                /* Prevent awkward breaks */
                h1, h2, h3, h4, .font-bold {
                    page-break-after: avoid;
                }
                p, li, blockquote, pre, table, img {
                    page-break-inside: avoid;
                }

                /* Tables */
                table {
                    width: 100% !important;
                    border-collapse: collapse !important;
                }
                th, td {
                    border: 1px solid #333 !important;
                    padding: 6pt 10pt !important;
                }
                th { background: #f0f0f0 !important; }

                /* Links */
                a, .text-slate-900 {
                    color: inherit !important;
                    text-decoration: underline !important;
                }
            }
        `,
    });

    // Auto-print effect
    useEffect(() => {
        if (!loading && shouldAutoPrint && handlePrint) {
            // Small delay to ensure ref is attached and content is rendered
            const timer = setTimeout(() => {
                handlePrint();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [loading, shouldAutoPrint]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 font-sans">
            <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-600 font-medium font-sans">Preparing Editable Notice...</p>
        </div>
    );

    if (!alert) return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-slate-50 font-sans">
            <AlertCircle className="h-20 w-20 text-red-500 mb-6" />
            <h1 className="text-3xl font-bold mb-4">Sync Error</h1>
            <Button asChild variant="outline"><Link to="/alerts?status=reports">Back</Link></Button>
        </div>
    );


    const EditableArea = ({ text, onChange, className = "", bold = false }) => (
        <div
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onChange(e.target.innerText)}
            className={`cursor-text outline-none whitespace-pre-wrap ${bold ? 'font-bold' : ''} ${className}`}
        >
            {text}
        </div>
    );

    return (
        <div className="bg-background p-0 font-sans flex flex-col relative">
            <div className="sticky top-0 z-40 bg-white border-b border-slate-300 shadow-sm px-6 py-4 no-print mb-4 flex-shrink-0">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <Button variant="ghost" size="sm" asChild className="shrink-0">
                            <Link to="/alerts?status=reports"><ArrowLeft className="h-5 w-5" /></Link>
                        </Button>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg font-bold text-slate-900 truncate">Official Notice Generator</h1>
                                {hasUnsavedChanges && <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes"></span>}
                            </div>
                            <p className="text-blue-600 text-xs font-semibold uppercase tracking-widest whitespace-nowrap">{serialNumber}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Template Selector */}
                        {templates.length > 0 && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 border border-slate-200">
                                <FileText className="h-4 w-4 text-slate-600" />
                                <select
                                    value={selectedTemplateId || 'default'}
                                    onChange={(e) => handleTemplateChange(e.target.value)}
                                    disabled={templateLoading}
                                    className={`text-xs bg-transparent border-0 cursor-pointer focus:outline-none focus:ring-0 font-medium text-slate-700 ${templateLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <option value="default">Default</option>
                                    {templates.map(t => (
                                        <option key={t.id} value={t.id}>
                                            {t.name} {t.is_default ? '★' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            className={`gap-2 whitespace-nowrap transition-colors ${hasUnsavedChanges ? 'border-amber-400 bg-amber-50 hover:bg-amber-100' : ''}`}
                            onClick={() => saveReport()}
                            disabled={saving}
                            title={hasUnsavedChanges ? 'You have unsaved changes' : 'All changes saved'}
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (saveSuccess ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Save className="h-4 w-4" />)}
                            <span className="hidden sm:inline">{saveSuccess ? 'Saved' : 'Save'}</span>
                        </Button>
                        <Button size="sm" className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold whitespace-nowrap" onClick={handlePrint}>
                            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Print / PDF</span>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Similarity Warning Dialog */}
            {showSimilarityDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200 no-print">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border-l-4 border-red-600 animate-in zoom-in-95 duration-200">
                        <div className="flex items-start gap-4">
                            <div className="bg-red-100 p-3 rounded-full">
                                <AlertTriangle className="h-6 w-6 text-red-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-slate-900">Recurring Threat Detected</h3>
                                <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                                    This content is highly similar to previously escalated alert(s).
                                </p>
                                <div className="mt-6 flex justify-end">
                                    <Button
                                        className="bg-slate-900 hover:bg-slate-800 text-white"
                                        onClick={() => setShowSimilarityDialog(false)}
                                    >
                                        Dismiss
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 py-12 px-4 no-print-workspace" style={{ scrollBehavior: 'smooth' }}>
                <div ref={reportRef} className="print-area bg-transparent text-black mx-auto font-serif flex flex-col gap-12 print:gap-0">

                    {templateLoading ? (
                        <div className="flex flex-col items-center justify-center h-[600px] bg-white rounded-none shadow-xl border border-slate-200 mx-auto" style={{ width: '210mm' }}>
                            <div className="relative">
                                <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-25"></div>
                                <Loader2 className="h-12 w-12 animate-spin text-blue-600 relative z-10" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mt-6">Generating Notice</h3>
                            <p className="text-slate-500 mt-2">Merging report data with template...</p>
                            <div className="w-48 h-1.5 bg-slate-100 rounded-full mt-8 overflow-hidden">
                                <div className="h-full bg-blue-600 animate-progress-indeterminate"></div>
                            </div>
                        </div>
                    ) : useCustomTemplate && templateHtml ? (
                        /* CUSTOM TEMPLATE SHEET */
                        <Suspense fallback={<div className="flex items-center justify-center h-[200px]"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
                            <RichTextEditor
                                key={selectedTemplateId}
                                initialContent={templateHtml}
                                onChange={(html) => setTemplateHtml(html)}
                                minHeight="297mm"
                                showPrint={false}
                                showStatusBar={false}
                                placeholder="Template content will appear here..."
                                variant="minimal"
                                serialNumber={serialNumber}
                                stickyOffset="top-[76px]"
                            />
                        </Suspense>
                    ) : (
                        <>
                            {/* DEFAULT TEMPLATE - PAGE 1 */}
                            <div className="report-page bg-white p-[20mm] relative flex flex-col shadow-[0_0_20px_rgba(0,0,0,0.1),0_0_5px_rgba(0,0,0,0.05)] border border-slate-200/50 mx-auto"
                                style={{ width: '210mm', minHeight: '297mm' }}>
                                <div className="flex flex-col items-center mb-8">
                                    <div className="h-[75px] w-full"></div>
                                    <h2 className="text-[18px] font-bold uppercase tracking-tight text-center">
                                        <EditableArea text={headerGovt} onChange={setHeaderGovt} />
                                    </h2>
                                    <h3 className="text-[16px] font-bold uppercase tracking-tight text-center leading-none">
                                        <EditableArea text={headerDept} onChange={setHeaderDept} />
                                    </h3>
                                    <div className="w-full flex justify-between mt-4">
                                        <p className="font-bold underline text-[14px]">Ref No: {serialNumber}</p>
                                        <p className="font-bold underline"><EditableArea text={dateLine} onChange={setDateLine} /></p>
                                    </div>
                                </div>

                                <div className="text-center font-bold underline mb-8 mt-4 px-6 uppercase text-[15px] leading-relaxed">
                                    <div contentEditable suppressContentEditableWarning onBlur={(e) => setSubject(e.target.innerText)}>{subject}</div>
                                </div>

                                <div className="space-y-6 text-[15.5px] leading-[1.6] text-left whitespace-pre-wrap">
                                    <p className="font-bold cursor-text"><EditableArea text={greeting} onChange={setGreeting} /></p>
                                    <p contentEditable suppressContentEditableWarning onBlur={(e) => setIntroText(e.target.innerText)}>{introText}</p>
                                    <p contentEditable suppressContentEditableWarning onBlur={(e) => setBodyText(e.target.innerText)}>{bodyText}</p>

                                    <div className="mt-8">
                                        <p className="font-bold underline mb-4 uppercase">
                                            <EditableArea text={accountHeader} onChange={setAccountHeader} />
                                        </p>
                                        <div className="pl-6 space-y-4">
                                            <div className="flex gap-3">
                                                <span className="font-bold">1.</span>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <EditableArea text={targetUserLine} onChange={setTargetUserLine} bold />
                                                        {isRepost && <span className="text-[10px] bg-slate-100 px-1 rounded font-sans uppercase text-slate-500 flex items-center gap-0.5"><Repeat2 className="h-2.5 w-2.5" /> Reposted By</span>}
                                                    </div>
                                                    <EditableArea text={profileUrl} onChange={setProfileUrl} className="text-slate-900 underline text-[14px] break-all" />
                                                </div>
                                            </div>

                                            {isRepost && (
                                                <div className="flex gap-3 mt-4">
                                                    <span className="font-bold">2.</span>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <EditableArea text={originalUserLine} onChange={setOriginalUserLine} bold />
                                                            <span className="text-[10px] bg-slate-100 px-1 rounded font-sans uppercase text-slate-600 font-bold tracking-tighter">Original Author</span>
                                                        </div>
                                                        <EditableArea text={originalProfileUrl} onChange={setOriginalProfileUrl} className="text-slate-900 underline text-[14px] break-all" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* PAGE 2 */}
                            <div className="report-page bg-white p-[20mm] relative flex flex-col shadow-[0_0_20px_rgba(0,0,0,0.1),0_0_5px_rgba(0,0,0,0.05)] border border-slate-200/50 mx-auto"
                                style={{ width: '210mm', minHeight: '297mm' }}>
                                <div className="mt-4">
                                    <p className="font-bold underline mb-6 uppercase">
                                        <EditableArea text={postHeader} onChange={setPostHeader} />
                                    </p>
                                    <div className="pl-6 space-y-2">
                                        <div className="flex gap-3">
                                            <span className="font-bold">1.</span>
                                            <EditableArea text={contentUrl} onChange={setContentUrl} className="text-slate-900 underline text-[14px] break-all" />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6 text-[15.5px] leading-[1.6] mt-8 whitespace-pre-wrap text-left">
                                    <EditableArea text={legalBlock} onChange={setLegalBlock} className="focus:bg-slate-50/50 p-2 rounded" />
                                    <EditableArea text={requestBlock} onChange={setRequestBlock} className="font-semibold focus:bg-slate-50/50 p-2 rounded" />
                                    <p className="mt-10 italic" contentEditable suppressContentEditableWarning onBlur={(e) => setClosingStatement(e.target.innerText)}>{closingStatement}</p>
                                </div>
                            </div>

                            {/* PAGE 3 */}
                            <div className="report-page bg-white p-[20mm] relative flex flex-col shadow-[0_0_20px_rgba(0,0,0,0.1),0_0_5px_rgba(0,0,0,0.05)] border border-slate-200/50 mx-auto"
                                style={{ width: '210mm', minHeight: '297mm' }}>
                                <div className="space-y-8 text-[15.5px] leading-[1.7] mt-10 whitespace-pre-wrap text-left">
                                    <EditableArea text={declarationBlock} onChange={setDeclarationBlock} className="focus:bg-slate-50/50 p-2 rounded" />
                                    <div className="border-t border-slate-200 pt-6">
                                        <EditableArea text={addressBlock} onChange={setAddressBlock} className="text-[13px] font-semibold leading-relaxed" />
                                    </div>
                                    <div className="mt-12 space-y-10">
                                        <EditableArea text={recipientBlock} onChange={setRecipientBlock} className="text-[14.5px] leading-snug" />
                                        <div className="w-full flex justify-end pr-10">
                                            <div className="text-center font-bold">
                                                <div className="h-16 mb-2"></div>
                                                <EditableArea text={signatureBlock} onChange={setSignatureBlock} className="text-[16px]" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    /* Consolidation of print styles to ensure absolute WYSIWYG */
                    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box !important; }
                    html, body { height: auto !important; margin: 0 !important; padding: 0 !important; background: white !important; }
                    
                    .no-print, .no-print-workspace { display: none !important; }
                    
                    .print-area { 
                        display: block !important;
                        width: 210mm !important; 
                        margin: 0 auto !important;
                        padding: 0 !important;
                        box-shadow: none !important;
                        border: none !important;
                        overflow: visible !important;
                    }
                    
                    .report-page, .report-page-sheet {
                        page-break-after: always !important;
                        width: 210mm !important;
                        min-height: 297mm !important;
                        padding: 20mm !important;
                        margin: 0 auto !important;
                        box-shadow: none !important;
                        border: 0 !important;
                        border-width: 0 !important;
                        outline: 0 !important;
                        background: white !important;
                        overflow: visible !important;
                    }
                    
                    .report-page-sheet {
                        padding: 0 !important; /* RichTextEditor already has padding inside */
                    }

                    .report-page:last-child { page-break-after: auto !important; }
                    
                    /* Strip everything else */
                    .print-area { gap: 0 !important; border: 0 !important; box-shadow: none !important; }
                    .print-area * { box-shadow: none !important; border-color: transparent !important; }
                    .print-area .border, .print-area .border-t { border-color: #eee !important; } /* Restore intentional lines like address divider */
                }
                [contentEditable] {
                    min-height: 1.2em;
                    border-radius: 4px;
                    transition: all 0.2s;
                    border-bottom: 2px solid transparent;
                    padding: 0 4px;
                }
                [contentEditable]:hover {
                    background-color: rgba(59, 130, 246, 0.05);
                }
                [contentEditable]:focus {
                    background-color: #f8fafc;
                    border-bottom: 2px solid #3b82f6;
                    outline: none;
                }
            `}} />
        </div>
    );
};

export default GenerateReport;