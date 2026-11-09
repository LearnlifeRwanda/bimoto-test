import type PDFKit from 'pdfkit';
import type { ComplianceSection, ReportPeriod } from '../../types';

export function renderCompliance(
  doc: PDFKit.PDFDocument,
  data: ComplianceSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('6. Compliance Attestations');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Hash-chain audit trail');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Entries appended in period: ${data.hashChainEntries}`);
  doc.text(`Last entry hash (head): ${data.hashChainHead ?? 'n/a'}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Attestations');
  doc.font('Helvetica').fontSize(10);
  for (const a of data.attestations) {
    doc.text(`  [${a.id}] (${a.status}) ${a.statement}`, {
      width: doc.page.width - 100,
    });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.5);
  doc.font('Helvetica-Oblique').fontSize(9);
  doc.text(`Generated at: ${data.generatedAt}`);
}
