import type PDFKit from 'pdfkit';
import type { ReportPeriod } from '../types';

// Render header/footer onto every page after the cover (page index >= 1).
// Must be called AFTER all content has been rendered, while the document is
// still open (i.e. before doc.end()). Requires bufferPages: true.
export function applyHeaderFooter(
  doc: PDFKit.PDFDocument,
  period: ReportPeriod,
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    if (i === range.start) continue;
    doc.switchToPage(i);
    doc.save();
    doc.font('Helvetica').fontSize(9);
    doc.text(
      `Bimoto BNR Report — ${period.label}`,
      50,
      20,
      { align: 'right', width: doc.page.width - 100, lineBreak: false },
    );
    doc.text(
      `Page ${i + 1}`,
      50,
      doc.page.height - 30,
      { align: 'center', width: doc.page.width - 100, lineBreak: false },
    );
    doc.restore();
  }
}
