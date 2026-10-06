import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

/**
 * Export a DOM element as a PNG image
 * @param {HTMLElement} element - The DOM element to capture
 * @param {string} filename - The filename (without extension)
 */
export const exportAsPNG = async (element, filename = 'chart') => {
  if (!element) return;
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${filename}.png`);
    }, 'image/png');
  } catch (err) {
    console.error('PNG export failed:', err);
  }
};

/**
 * Export a DOM element as a PDF document
 * @param {HTMLElement} element - The DOM element to capture
 * @param {string} filename - The filename (without extension)
 * @param {string} title - Optional title to show in the PDF header
 */
export const exportAsPDF = async (element, filename = 'chart', title = '') => {
  if (!element) return;
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    const pdfWidth = 297; // A4 landscape width in mm
    const pdfHeight = 210; // A4 landscape height in mm
    const margin = 15;

    const contentWidth = pdfWidth - margin * 2;
    const ratio = contentWidth / imgWidth;
    const scaledHeight = imgHeight * ratio;

    const pdf = new jsPDF({
      orientation: scaledHeight > pdfHeight - margin * 2 ? 'portrait' : 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    if (title) {
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text(title, margin, margin + 4);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(120, 120, 120);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, margin + 10);
      pdf.setTextColor(0, 0, 0);
      pdf.addImage(imgData, 'PNG', margin, margin + 16, contentWidth, scaledHeight);
    } else {
      pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, scaledHeight);
    }

    pdf.save(`${filename}.pdf`);
  } catch (err) {
    console.error('PDF export failed:', err);
  }
};

/**
 * Export data as a CSV file
 * @param {Array<Object>} data - Array of row objects
 * @param {string} filename - The filename (without extension)
 * @param {Array<{key: string, label: string}>} columns - Column definitions
 */
export const exportAsCSV = (data, filename = 'data', columns = []) => {
  if (!data || !data.length) return;

  try {
    const cols = columns.length
      ? columns
      : Object.keys(data[0]).map((key) => ({ key, label: key }));

    const header = cols.map((col) => `"${col.label}"`).join(',');
    const rows = data.map((row) =>
      cols
        .map((col) => {
          const val = row[col.key];
          if (val === null || val === undefined) return '""';
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
          return `"${val}"`;
        })
        .join(',')
    );

    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `${filename}.csv`);
  } catch (err) {
    console.error('CSV export failed:', err);
  }
};
