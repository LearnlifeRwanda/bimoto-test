import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import {
  findById,
  findByPeriod,
  generateReport,
  listReports,
  existsAt,
  readStream,
} from '../services/bnr-report';
import { priorPeriodFromNow } from '../services/bnr-report/date-window';

const router = Router();

router.use(authMiddleware);
router.use(adminOnly);

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * @openapi
 * /api/admin/bnr-reports:
 *   get:
 *     summary: List BNR reports (most-recent-first, max 50).
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: BnrReport metadata array.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const reports = await listReports({ limit: 50 });
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/bnr-reports/generate:
 *   post:
 *     summary: Trigger BNR report generation for a given period (YYYY-MM).
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [period]
 *             properties:
 *               period: { type: string, example: "2026-04" }
 *     responses:
 *       202:
 *         description: Report row created in PENDING/GENERATING; generation runs in background.
 *       400:
 *         description: Malformed period or future period.
 *       409:
 *         description: A COMPLETED report for this period already exists.
 */
router.post(
  '/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = String(req.body?.period ?? '');
      if (!PERIOD_RE.test(period)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Period must match YYYY-MM');
      }
      const currentPeriod = priorPeriodFromNow(
        new Date(new Date().getTime() + 32 * 24 * 3600 * 1000),
      );
      if (period > currentPeriod) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Cannot generate future periods');
      }

      const existing = await findByPeriod(period);
      if (existing) {
        res.status(202).json({ report: existing, deduplicated: true });
        return;
      }

      const adminId = req.user?.userId;
      const generatedBy = adminId ?? undefined;

      generateReport({ period, generatedBy }).catch((err) => {
        console.error(`[BNR-REPORT] Background generation for ${period} failed:`, err);
      });

      res.status(202).json({
        period,
        status: 'PENDING',
        message: 'Generation started; poll GET /api/admin/bnr-reports for status.',
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/bnr-reports/{id}:
 *   get:
 *     summary: Get a specific BNR report's metadata.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: BnrReport row }
 *       404: { description: Not found }
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await findById(req.params.id);
    if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found');
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

async function streamReportFile(
  req: Request,
  res: Response,
  ext: 'pdf' | 'csv',
  contentType: string,
): Promise<void> {
  const report = await findById(req.params.id);
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found');
  if (report.status !== 'COMPLETED') {
    throw new AppError(
      404,
      'REPORT_NOT_READY',
      `Report is ${report.status}; download unavailable`,
    );
  }
  const filePath = ext === 'pdf' ? report.pdfPath : report.csvPath;
  if (!filePath) {
    throw new AppError(404, 'REPORT_NOT_READY', 'File path missing on report row');
  }
  const present = await existsAt(filePath);
  if (!present) {
    throw new AppError(
      410,
      'REPORT_FILE_GONE',
      'Report file deleted by retention policy (7 years)',
    );
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="bnr-report-${report.period}.${ext}"`,
  );
  readStream(filePath).pipe(res);
}

/**
 * @openapi
 * /api/admin/bnr-reports/{id}/download.pdf:
 *   get:
 *     summary: Download the PDF report.
 *     tags: [Admin]
 *     responses:
 *       200: { description: Streamed PDF }
 *       404: { description: Report not found or not ready }
 *       410: { description: File deleted by retention sweep }
 */
router.get(
  '/:id/download.pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await streamReportFile(req, res, 'pdf', 'application/pdf');
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/bnr-reports/{id}/download.csv:
 *   get:
 *     summary: Download the CSV report.
 *     tags: [Admin]
 *     responses:
 *       200: { description: Streamed CSV }
 *       404: { description: Report not found or not ready }
 *       410: { description: File deleted by retention sweep }
 */
router.get(
  '/:id/download.csv',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await streamReportFile(req, res, 'csv', 'text/csv');
    } catch (err) {
      next(err);
    }
  },
);

export default router;
