const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, TextRun, BorderStyle, ShadingType } = require('docx');
const DailyProgramme = require('../models/DailyProgramme');

// Category labels mapping
const defaultCategoryLabels = {
    category1: 'Government of Telangana / CM / Governor / Central Minister Programmes',
    category2: 'Other Programmes',
    category3: 'Religious Programmes',
    category4: 'Ongoing Programmes'
};

// Beautiful color palette
const colors = {
    // Primary brand colors
    primary: '#6366f1',        // Indigo
    primaryDark: '#4f46e5',    // Darker Indigo
    primaryLight: '#818cf8',   // Light Indigo

    // Category colors
    category1: '#3b82f6',      // Blue - Government
    category2: '#8b5cf6',      // Purple - Other
    category3: '#ec4899',      // Pink - Religious
    category4: '#10b981',      // Green - Ongoing

    // Neutral colors
    darkGray: '#1f2937',       // Dark text
    mediumGray: '#6b7280',     // Medium text
    lightGray: '#f3f4f6',      // Light background
    white: '#ffffff',

    // Accent colors
    accent: '#f59e0b',         // Amber
    success: '#10b981',        // Green
    warning: '#f59e0b',        // Amber
    danger: '#ef4444',         // Red

    // Gradient backgrounds
    gradientStart: '#667eea',  // Purple-ish
    gradientEnd: '#764ba2',    // Darker purple
};

// Category color mapping
const categoryColors = {
    category1: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },  // Blue theme
    category2: { bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6' },  // Purple theme
    category3: { bg: '#fce7f3', border: '#ec4899', text: '#9f1239' },  // Pink theme
    category4: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },  // Green theme
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

// Convert hex to RGB
const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

// Generate PDF with enhanced styling
exports.generatePDF = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }

        const getDayRange = (dateStr) => {
            const d = new Date(dateStr);
            const start = new Date(d.setHours(0, 0, 0, 0));
            const end = new Date(d.setHours(23, 59, 59, 999));
            return { start, end };
        };

        const { start, end } = getDayRange(date);

        const programmes = await DailyProgramme.find({
            date: { $gte: start, $lte: end }
        }).sort({ category: 1, slNo: 1 });

        if (!programmes || programmes.length === 0) {
            return res.status(404).json({ error: 'No programmes found for this date' });
        }

        const grouped = {
            category1: programmes.filter(p => p.category === 'category1'),
            category2: programmes.filter(p => p.category === 'category2'),
            category3: programmes.filter(p => p.category === 'category3'),
            category4: programmes.filter(p => p.category === 'category4'),
        };

        const categoryLabels = {};
        Object.keys(grouped).forEach(cat => {
            if (grouped[cat].length > 0 && grouped[cat][0].categoryLabel) {
                categoryLabels[cat] = grouped[cat][0].categoryLabel;
            } else {
                categoryLabels[cat] = defaultCategoryLabels[cat];
            }
        });

        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            layout: 'landscape'
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=periscope-${date}.pdf`);

        doc.pipe(res);

        // === HEADER SECTION ===

        // Professional solid header background
        doc.rect(40, 40, 760, 90).fill(colors.primaryDark);

        // Add a subtle bottom border accent
        doc.rect(40, 130, 760, 4).fill(colors.accent);

        // Main Title - Centered vertically in top half
        doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
            .text('PERISCOPE', 40, 55, { align: 'center', width: 760 });

        // Subtitle
        doc.fontSize(12).font('Helvetica').fillColor('#e0e7ff')
            .text('Daily Programmes Report', 40, 90, { align: 'center', width: 760 });

        // Date Badge - Centered below header
        const dateY = 145;
        doc.roundedRect(300, dateY, 240, 24, 12).fill('#f3f4f6');
        doc.strokeColor(colors.primary).lineWidth(1)
            .roundedRect(300, dateY, 240, 24, 12).stroke();

        doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.primaryDark)
            .text(formatDateDisplay(date), 300, dateY + 6, { align: 'center', width: 240 });

        doc.y = 180;
        doc.moveDown(1);

        // Helper to draw headers
        const drawTableHeaders = (y) => {
            const headerHeight = 20;
            const colWidths = [35, 60, 100, 100, 100, 50, 75, 100, 80, 60];
            const headers = ['Sl.', 'Zone', 'Programme', 'Location', 'Organizer', 'Members', 'Time', 'Gist', 'Permission', 'Comments'];

            // Header background
            doc.rect(40, y, 760, headerHeight).fill('#f8fafc');
            const accentColor = hexToRgb(colors.primary); // Default accent
            doc.rect(40, y, 760, 1).fill(`rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})`);

            let x = 45;
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#334155');

            headers.forEach((header, i) => {
                doc.text(header, x, y + 6, { width: colWidths[i] - 5, align: 'left' });
                x += colWidths[i];
            });

            doc.moveTo(40, y + headerHeight).lineTo(800, y + headerHeight).lineWidth(0.5).stroke('#cccccc');

            return y + headerHeight;
        };

        // Process each category
        const categories = ['category1', 'category2', 'category3', 'category4'];
        let categoryIndex = 0;

        for (const category of categories) {
            const events = grouped[category] || [];
            if (events.length === 0) continue;

            categoryIndex++;
            const catColors = categoryColors[category];
            const accentColor = hexToRgb(catColors.border);

            // Check for page break before category header
            if (doc.y > 450) {
                doc.addPage();
                doc.y = 40;
            }

            // === CATEGORY HEADER WITH COLORED ACCENT ===
            const categoryY = doc.y;

            // Colored left accent bar
            doc.rect(40, categoryY, 6, 28)
                .fill(`rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})`);

            // Light background for category header
            const bgColor = hexToRgb(catColors.bg);
            doc.rect(46, categoryY, 754, 28)
                .fill(`rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`);

            // Category title with colored text
            const textColor = hexToRgb(catColors.text);
            doc.fontSize(12).font('Helvetica-Bold')
                .fillColor(`rgb(${textColor.r}, ${textColor.g}, ${textColor.b})`)
                .text(`${categoryIndex}. ${categoryLabels[category]}`, 60, categoryY + 8);

            // Event count badge
            const badgeX = 700;
            const badgeY = categoryY + 6;
            doc.roundedRect(badgeX, badgeY, 90, 16, 8)
                .fill(`rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})`);
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
                .text(`${events.length} Events`, badgeX, badgeY + 3, { width: 90, align: 'center' });

            doc.y = categoryY + 32;
            doc.moveDown(0.5);

            // === TABLE HEADERS ===
            let currentY = drawTableHeaders(doc.y);
            doc.y = currentY;

            // === TABLE ROWS ===
            const colWidths = [35, 60, 100, 100, 100, 50, 75, 100, 80, 60];
            doc.font('Helvetica').fontSize(7).fillColor('#1e293b');

            events.forEach((event, eventIndex) => {
                // Determine row height based on content
                const calculateHeight = (text, width) => {
                    const textHeight = doc.heightOfString(text || '', { width: width, lineBreak: true });
                    return Math.max(28, textHeight + 10); // Min 28px height
                };

                const rowHeight = 35; // Fixed reasonable height, extend if needed

                // Check for page break
                if (doc.y + rowHeight > 540) {
                    doc.addPage();
                    doc.y = 40;
                    // Redraw headers on new page
                    currentY = drawTableHeaders(doc.y);
                    doc.y = currentY;
                }

                const rowY = doc.y;

                // Alternate row background
                if (eventIndex % 2 === 0) {
                    doc.rect(40, rowY, 760, rowHeight).fill('#fafbfc');
                } else {
                    doc.rect(40, rowY, 760, rowHeight).fill('#ffffff');
                }

                // Left accent for each row (thinner)
                doc.rect(40, rowY, 2, rowHeight)
                    .fill(`rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, 0.3)`);

                let x = 45;
                const rowData = [
                    event.slNo?.toString() || '',
                    event.zone || '',
                    event.programName || '',
                    event.location || '',
                    event.organizer || '',
                    event.expectedMembers?.toString() || '0',
                    event.time || '',
                    event.gist || '',
                    event.permission || '',
                    event.comments || ''
                ];

                doc.fillColor('#000000');
                rowData.forEach((data, i) => {
                    doc.text(data, x, rowY + 6, {
                        width: colWidths[i] - 5,
                        align: 'left',
                        lineBreak: true,
                        height: rowHeight - 6,
                        ellipsis: true
                    });
                    x += colWidths[i];
                });

                // Bottom border for row
                doc.moveTo(40, rowY + rowHeight).lineTo(800, rowY + rowHeight)
                    .lineWidth(0.5).stroke('#e2e8f0');

                doc.y = rowY + rowHeight;
            });

            doc.moveDown(1.5);
        }

        // === FOOTER WITH STATS ===
        const totalEvents = programmes.length;
        const footerY = doc.y + 10;

        // Summary box with gradient
        doc.roundedRect(280, footerY, 280, 40, 10).fill('#f8fafc');
        doc.roundedRect(280, footerY, 280, 3, 0)
            .fill(colors.primary);

        doc.fontSize(10).font('Helvetica').fillColor('#64748b')
            .text('Total Events', 290, footerY + 10, { align: 'center', width: 260 });

        doc.fontSize(18).font('Helvetica-Bold').fillColor(colors.primary)
            .text(totalEvents.toString(), 290, footerY + 22, { align: 'center', width: 260 });

        // Add generation timestamp at bottom
        doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
            .text(`Generated on ${new Date().toLocaleString('en-IN')}`, 40, 550, { align: 'center', width: 760 });

        doc.end();

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
};

// Generate Word Document with enhanced styling
exports.generateWord = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }

        const getDayRange = (dateStr) => {
            const d = new Date(dateStr);
            const start = new Date(d.setHours(0, 0, 0, 0));
            const end = new Date(d.setHours(23, 59, 59, 999));
            return { start, end };
        };

        const { start, end } = getDayRange(date);

        const programmes = await DailyProgramme.find({
            date: { $gte: start, $lte: end }
        }).sort({ category: 1, slNo: 1 });

        if (!programmes || programmes.length === 0) {
            return res.status(404).json({ error: 'No programmes found for this date' });
        }

        const grouped = {
            category1: programmes.filter(p => p.category === 'category1'),
            category2: programmes.filter(p => p.category === 'category2'),
            category3: programmes.filter(p => p.category === 'category3'),
            category4: programmes.filter(p => p.category === 'category4'),
        };

        const categoryLabels = {};
        Object.keys(grouped).forEach(cat => {
            if (grouped[cat].length > 0 && grouped[cat][0].categoryLabel) {
                categoryLabels[cat] = grouped[cat][0].categoryLabel;
            } else {
                categoryLabels[cat] = defaultCategoryLabels[cat];
            }
        });

        const children = [];

        // === TITLE SECTION ===
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: 'PERISCOPE',
                        bold: true,
                        size: 48,
                        color: '6366f1',
                        font: 'Arial'
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 100 },
                shading: {
                    type: ShadingType.SOLID,
                    color: 'f0f4ff',
                    fill: 'f0f4ff'
                },
                border: {
                    bottom: {
                        color: '6366f1',
                        space: 1,
                        style: BorderStyle.SINGLE,
                        size: 12
                    }
                }
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: 'Daily Programmes Report',
                        size: 20,
                        color: '64748b',
                        font: 'Arial'
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 }
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: formatDateDisplay(date),
                        bold: true,
                        size: 24,
                        color: '1e293b',
                        font: 'Arial'
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                shading: {
                    type: ShadingType.SOLID,
                    color: 'fafbfc',
                    fill: 'fafbfc'
                }
            })
        );

        // Process each category
        const categories = ['category1', 'category2', 'category3', 'category4'];
        let categoryIndex = 0;

        for (const category of categories) {
            const events = grouped[category] || [];
            if (events.length === 0) continue;

            categoryIndex++;
            const catColors = categoryColors[category];

            // === CATEGORY HEADER ===
            children.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `${categoryIndex}. ${categoryLabels[category]}  `,
                            bold: true,
                            size: 24,
                            color: catColors.text.replace('#', ''),
                            font: 'Arial'
                        }),
                        new TextRun({
                            text: `[${events.length} Events]`,
                            size: 18,
                            color: catColors.border.replace('#', ''),
                            font: 'Arial'
                        })
                    ],
                    spacing: { before: 300, after: 200 },
                    shading: {
                        type: ShadingType.SOLID,
                        color: catColors.bg.replace('#', ''),
                        fill: catColors.bg.replace('#', '')
                    },
                    border: {
                        left: {
                            color: catColors.border.replace('#', ''),
                            space: 1,
                            style: BorderStyle.SINGLE,
                            size: 24
                        }
                    }
                })
            );

            // === CREATE TABLE ===
            const tableRows = [
                // Header row with colored background
                new TableRow({
                    tableHeader: true,
                    height: { value: 600, rule: 'atLeast' },
                    children: [
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Sl.', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 4, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Zone', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 8, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Programme', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 12, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Location', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 11, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Organizer', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 11, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Members', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 7, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Time', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 9, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Gist', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 13, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Permission', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 10, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: [new TextRun({ text: 'Comments', bold: true, color: 'ffffff' })],
                                alignment: AlignmentType.CENTER
                            })],
                            shading: { type: ShadingType.SOLID, color: catColors.border.replace('#', ''), fill: catColors.border.replace('#', '') },
                            width: { size: 15, type: WidthType.PERCENTAGE }
                        })
                    ]
                })
            ];

            // Data rows with alternating colors
            events.forEach((event, index) => {
                const rowBg = index % 2 === 0 ? 'ffffff' : 'fafbfc';

                tableRows.push(
                    new TableRow({
                        height: { value: 500, rule: 'atLeast' },
                        children: [
                            new TableCell({
                                children: [new Paragraph({
                                    children: [new TextRun({ text: event.slNo?.toString() || '', bold: true, color: '64748b' })],
                                    alignment: AlignmentType.CENTER
                                })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.zone || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.programName || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.location || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.organizer || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({
                                    children: [new TextRun({ text: event.expectedMembers?.toString() || '0', color: '10b981' })],
                                    alignment: AlignmentType.CENTER
                                })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({
                                    children: [new TextRun({ text: event.time || '', color: '6366f1' })],
                                    alignment: AlignmentType.CENTER
                                })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.gist || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.permission || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            }),
                            new TableCell({
                                children: [new Paragraph({ text: event.comments || '', size: 18 })],
                                shading: { type: ShadingType.SOLID, color: rowBg, fill: rowBg }
                            })
                        ]
                    })
                );
            });

            // Add table to document
            children.push(
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: tableRows,
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: catColors.border.replace('#', '') },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: catColors.border.replace('#', '') },
                        left: { style: BorderStyle.SINGLE, size: 6, color: catColors.border.replace('#', '') },
                        right: { style: BorderStyle.SINGLE, size: 6, color: catColors.border.replace('#', '') },
                        insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: 'e2e8f0' },
                        insideVertical: { style: BorderStyle.SINGLE, size: 3, color: 'e2e8f0' }
                    }
                })
            );

            // Add spacing after table
            children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        }

        // === FOOTER WITH TOTAL ===
        const totalEvents = programmes.length;

        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: `Total Events: ${totalEvents}`,
                        bold: true,
                        size: 28,
                        color: '6366f1',
                        font: 'Arial'
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 400 },
                shading: {
                    type: ShadingType.SOLID,
                    color: 'f0f4ff',
                    fill: 'f0f4ff'
                },
                border: {
                    top: {
                        color: '6366f1',
                        space: 1,
                        style: BorderStyle.SINGLE,
                        size: 12
                    }
                }
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: `Generated on ${new Date().toLocaleString('en-IN')}`,
                        size: 16,
                        color: '94a3b8',
                        italics: true
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 100 }
            })
        );

        // Create document
        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        margin: {
                            top: 720,
                            right: 720,
                            bottom: 720,
                            left: 720
                        }
                    }
                },
                children: children
            }]
        });

        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=periscope-${date}.docx`);

        res.send(buffer);

    } catch (error) {
        console.error('Error generating Word document:', error);
        res.status(500).json({ error: 'Failed to generate Word document' });
    }
};
