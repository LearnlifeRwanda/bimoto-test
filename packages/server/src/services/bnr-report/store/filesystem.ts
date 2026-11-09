import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { REPORT_OUTPUT_DIR } from '../config';

export type ReportExt = 'pdf' | 'csv';

export function pathFor(period: string, ext: ReportExt): string {
  return path.join(
    REPORT_OUTPUT_DIR,
    period,
    `bnr-report-${period}.${ext}`,
  );
}

export async function ensureDir(period: string): Promise<void> {
  await fsp.mkdir(path.join(REPORT_OUTPUT_DIR, period), { recursive: true });
}

export async function exists(period: string, ext: ReportExt): Promise<boolean> {
  try {
    await fsp.access(pathFor(period, ext), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function existsAt(absPath: string): Promise<boolean> {
  try {
    await fsp.access(absPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function readStream(absPath: string): NodeJS.ReadableStream {
  return fs.createReadStream(absPath);
}
