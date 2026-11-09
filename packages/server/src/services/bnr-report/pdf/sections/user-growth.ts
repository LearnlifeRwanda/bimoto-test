import type PDFKit from 'pdfkit';
import type { ReportPeriod, UserGrowthSection } from '../../types';

export function renderUserGrowth(
  doc: PDFKit.PDFDocument,
  data: UserGrowthSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('4. User Growth');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Total users (cumulative): ${data.totalUsers}`);
  doc.text(`New users in period: ${data.newUsersInPeriod}`);
  doc.text(`Active users (≥1 booking in period): ${data.activeUsers}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By role');
  doc.font('Helvetica').fontSize(10);
  if (data.byRole.length === 0) {
    doc.text('  (no users)');
  } else {
    for (const row of data.byRole) {
      doc.text(
        `  ${row.role.padEnd(12)} total=${row.total}  new=${row.new}`,
      );
    }
  }
}
