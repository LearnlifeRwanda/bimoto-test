import type { BnrReport } from '@prisma/client';
import prisma from '../../prisma';
import { GENERATION_TIMEOUT_MS } from './config';
import { aggregateAll } from './aggregator';
import { buildPdf } from './pdf/builder';
import { buildCsv } from './csv/builder';
import { windowFor } from './date-window';
import {
  createReport,
  findById,
  findByPeriod,
  markCompleted,
  markFailed,
  markGenerating,
} from './store/db';
import { ensureDir, pathFor } from './store/filesystem';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function runGeneration(id: string, period: string): Promise<number> {
  const periodObj = windowFor(period);
  await ensureDir(period);
  const data = await aggregateAll(periodObj, prisma);
  const pdfPath = pathFor(period, 'pdf');
  const csvPath = pathFor(period, 'csv');
  const { bytes: pdfBytes } = await buildPdf(data, pdfPath);
  const { bytes: csvBytes, rows } = await buildCsv(data, csvPath);
  await markCompleted(id, pdfPath, pdfBytes, csvPath, csvBytes);
  return rows;
}

/**
 * Returned row plus `csvRows`, the number of CSV rows this run wrote —
 * fed into the job's run-metrics line. Undefined when the period's report
 * already existed and generation was skipped.
 */
export async function generateReport(opts: {
  period: string;
  generatedBy?: string;
}): Promise<BnrReport & { csvRows?: number }> {
  const { period, generatedBy } = opts;
  windowFor(period);

  const existing = await findByPeriod(period);
  if (existing) return existing;

  const row = await createReport(period, generatedBy);
  await markGenerating(row.id);

  let csvRows: number;
  try {
    csvRows = await withTimeout(
      runGeneration(row.id, period),
      GENERATION_TIMEOUT_MS,
      'BNR report generation',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(row.id, message);
    throw err;
  }

  const final = await findById(row.id);
  if (!final) throw new Error(`BnrReport ${row.id} disappeared after completion`);
  return { ...final, csvRows };
}
