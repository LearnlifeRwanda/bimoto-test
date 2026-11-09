import type PDFKit from 'pdfkit';
import type { ReportPeriod } from '../types';

export function renderCover(doc: PDFKit.PDFDocument, period: ReportPeriod): void {
  const top = 150;
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('BIMOTO', 50, top, { align: 'center' });
  doc.moveDown(0.5);
  doc
    .fontSize(16)
    .text('BNR Monthly AML/CFT Report', { align: 'center' });

  doc.moveDown(2);
  doc
    .font('Helvetica')
    .fontSize(14)
    .text(`Reporting period: ${period.label}`, { align: 'center' });
  doc.moveDown(0.5);
  doc
    .fontSize(11)
    .text(`Period code: ${period.period}`, { align: 'center' });
  doc.moveDown(0.5);
  doc.text(`Timezone: ${period.timezone}`, { align: 'center' });
  doc.moveDown(0.5);
  doc.text(`Generated: ${new Date().toISOString()}`, { align: 'center' });

  doc
    .font('Helvetica-Oblique')
    .fontSize(10)
    .text('Confidential — Submitted to BNR', 50, 720, { align: 'center' });

  doc.addPage();
}
