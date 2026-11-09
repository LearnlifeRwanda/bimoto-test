import type PDFKit from 'pdfkit';
import type { DriverMetricsSection, ReportPeriod } from '../../types';

export function renderDriverMetrics(
  doc: PDFKit.PDFDocument,
  data: DriverMetricsSection,
  period: ReportPeriod,
): void {
  doc.font('Helvetica-Bold').fontSize(14).text('5. Driver-side Metrics');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(`Period: ${period.label}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Active drivers: ${data.activeDrivers}`);
  doc.text(`Rides completed: ${data.totalRidesCompleted}`);
  doc.text(`Cancellations: ${data.cancellationCount}`);
  doc.text(
    `Average rides per active driver: ${data.averageRidesPerDriver.toFixed(2)}`,
  );
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Payouts');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Total payouts (RWF): ${data.totalPayoutsRwf.toLocaleString('en-US')}`);
  doc.text(`Payout batches succeeded: ${data.payoutBatchCount}`);
}
