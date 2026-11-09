import type PDFKit from 'pdfkit';
import type { ReportPeriod, TransactionsSection } from '../../types';

export function renderTransactions(
  doc: PDFKit.PDFDocument,
  data: TransactionsSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('1. Transactions');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Total transactions: ${data.totalCount}`);
  doc.text(`Total volume (RWF): ${data.totalAmountRwf.toLocaleString('en-US')}`);
  doc.text(`Success rate: ${(data.successRate * 100).toFixed(2)}%`);
  doc.text(`Failed (PSP): ${data.failedCount}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By tier');
  doc.font('Helvetica').fontSize(10);
  for (const row of data.byTier) {
    doc.text(
      `  ${row.tier.padEnd(10)} count=${row.count}  amount=${row.amount.toLocaleString('en-US')}`,
    );
  }
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('By payment method');
  doc.font('Helvetica').fontSize(10);
  for (const row of data.byPaymentMethod) {
    doc.text(
      `  ${row.method.padEnd(14)} count=${row.count}  amount=${row.amount.toLocaleString('en-US')}`,
    );
  }
}
