import fs from 'fs';
import PDFDocument from 'pdfkit';
import { PDF_PAGE_SIZE } from '../config';
import type { ReportData } from '../types';
import { renderCover } from './cover';
import { applyHeaderFooter } from './header-footer';
import {
  renderTransactions,
  renderDisputes,
  renderAmlFlags,
  renderUserGrowth,
  renderDriverMetrics,
  renderCompliance,
} from './sections';

export async function buildPdf(
  data: ReportData,
  outputPath: string,
): Promise<{ bytes: number }> {
  const doc = new PDFDocument({ size: PDF_PAGE_SIZE, margin: 50, bufferPages: true });
  const stream = fs.createWriteStream(outputPath);

  const finished = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });

  doc.pipe(stream);

  renderCover(doc, data.period);

  renderTransactions(doc, data.transactions, data.period);
  doc.addPage();

  renderDisputes(doc, data.disputes, data.period);
  doc.addPage();

  renderAmlFlags(doc, data.amlFlags, data.period);
  doc.addPage();

  renderUserGrowth(doc, data.userGrowth, data.period);
  doc.addPage();

  renderDriverMetrics(doc, data.driverMetrics, data.period);
  doc.addPage();

  renderCompliance(doc, data.compliance, data.period);

  applyHeaderFooter(doc, data.period);

  doc.end();
  await finished;

  const bytes = fs.statSync(outputPath).size;
  return { bytes };
}
