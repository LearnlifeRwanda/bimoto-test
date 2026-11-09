import type PDFKit from 'pdfkit';
import type { AmlFlagsSection, ReportPeriod } from '../../types';

export function renderAmlFlags(
  doc: PDFKit.PDFDocument,
  data: AmlFlagsSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('3. AML / CFT Flags');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Total flags raised: ${data.totalCount}`);
  doc.text(`Flagged users (current snapshot): ${data.flaggedUsers}`);
  doc.text(`Dismissed in period: ${data.dismissedCount}`);
  doc.text(`Pending (open) in period: ${data.pendingCount}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By severity');
  doc.font('Helvetica').fontSize(10);
  for (const row of data.bySeverity) {
    doc.text(`  ${row.severity.padEnd(10)} count=${row.count}`);
  }
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By type');
  doc.font('Helvetica').fontSize(10);
  if (data.byType.length === 0) {
    doc.text('  (no flags recorded in period)');
  } else {
    for (const row of data.byType) {
      doc.text(
        `  ${row.type.padEnd(28)} count=${row.count}  critical=${row.criticalCount}`,
      );
    }
  }
}
