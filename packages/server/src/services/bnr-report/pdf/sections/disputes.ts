import type PDFKit from 'pdfkit';
import type { DisputesSection, ReportPeriod } from '../../types';

export function renderDisputes(
  doc: PDFKit.PDFDocument,
  data: DisputesSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('2. Disputes');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Opened in period: ${data.openedCount}`);
  doc.text(`Resolved in period: ${data.resolvedCount}`);
  doc.text(`Outstanding (open at end of period): ${data.outstandingCount}`);
  const avg =
    data.averageResolutionHours === null
      ? 'n/a'
      : `${data.averageResolutionHours.toFixed(2)} hours`;
  doc.text(`Average resolution time: ${avg}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By outcome');
  doc.font('Helvetica').fontSize(10);
  if (data.byOutcome.length === 0) {
    doc.text('  (no resolution responses recorded)');
  } else {
    for (const row of data.byOutcome) {
      doc.text(`  ${row.outcome.padEnd(20)} count=${row.count}`);
    }
  }
}
