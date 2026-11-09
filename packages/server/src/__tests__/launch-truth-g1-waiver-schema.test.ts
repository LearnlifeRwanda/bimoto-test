// LAUNCH-TRUTH G1 — waiver data model and campaign caps.
//
// Covers: the additive migration content (FeeWaiverType, the three
// AdminActionType values, the FeeWaiver table, the Escrow
// compute-then-zero columns), the partial unique index that enforces
// at most one non-revoked waiver per driver, and the env-overridable
// campaign-cap config module.

import fs from 'fs';
import path from 'path';

const schema = fs.readFileSync(
  path.join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(
    __dirname,
    '../../prisma/migrations/20260713000000_launch_truth_fee_waiver/migration.sql',
  ),
  'utf8',
);

describe('G1 — schema and migration contents', () => {
  test('FeeWaiverType enum with LIFETIME and TEMPORARY (schema + migration)', () => {
    expect(schema).toMatch(/enum FeeWaiverType \{[^}]*LIFETIME[^}]*TEMPORARY[^}]*\}/s);
    expect(migration).toContain(
      `CREATE TYPE "FeeWaiverType" AS ENUM ('LIFETIME', 'TEMPORARY');`,
    );
  });

  test('AdminActionType gains GRANT/EXTEND/REVOKE_FEE_WAIVER (schema + migration)', () => {
    for (const v of ['GRANT_FEE_WAIVER', 'EXTEND_FEE_WAIVER', 'REVOKE_FEE_WAIVER']) {
      expect(schema).toMatch(new RegExp(`enum AdminActionType \\{[^}]*${v}[^}]*\\}`, 's'));
      expect(migration).toContain(`ALTER TYPE "AdminActionType" ADD VALUE '${v}';`);
    }
  });

  test('FeeWaiver model keyed on User.id with the audited-grant fields', () => {
    const model = schema.match(/model FeeWaiver \{[^}]*\}/s)?.[0] ?? '';
    expect(model).toContain('driverId       String        @db.Uuid');
    expect(model).toMatch(/driver\s+User\s+@relation\("DriverFeeWaivers", fields: \[driverId\], references: \[id\]/);
    expect(model).toContain('type           FeeWaiverType');
    expect(model).toContain('campaign       String');
    expect(model).toContain('grantedBy      String        @db.Uuid');
    // Nullable — null for LIFETIME (never expires).
    expect(model).toContain('expiresAt      DateTime?');
    expect(model).toContain('extensionCount Int           @default(0)');
    expect(model).toContain('revokedAt      DateTime?');
    expect(model).toContain('revokedBy      String?       @db.Uuid');
    expect(model).toContain('reason         String');
    expect(model).toContain('@@index([driverId, revokedAt])');
    expect(migration).toContain('CREATE TABLE "FeeWaiver"');
    expect(migration).toContain(
      `FOREIGN KEY ("driverId") REFERENCES "User"("id")`,
    );
  });

  test('at most one non-revoked waiver per driver — partial unique index in the migration', () => {
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "FeeWaiver_one_nonrevoked_per_driver" ON "FeeWaiver"("driverId") WHERE "revokedAt" IS NULL;`,
    );
  });

  test('Escrow gains waivedCommissionAmount + feeWaiverId (compute-then-zero record)', () => {
    const model = schema.match(/model Escrow \{[^}]*escrows[^}]*\}|model Escrow \{.*?\n\}/s)?.[0] ?? '';
    expect(model).toContain('waivedCommissionAmount Int?');
    expect(model).toContain('feeWaiverId            String?    @db.Uuid');
    expect(migration).toContain(
      `ALTER TABLE "Escrow" ADD COLUMN "waivedCommissionAmount" INTEGER,`,
    );
    expect(migration).toContain(`ADD COLUMN "feeWaiverId" UUID;`);
    // Audit must outlive the incentive: the waiver row can never be
    // deleted from under an escrow that references it.
    expect(migration).toContain(
      `FOREIGN KEY ("feeWaiverId") REFERENCES "FeeWaiver"("id") ON DELETE RESTRICT`,
    );
  });

  test('migration is purely additive — no DROP/ALTER-narrowing statements', () => {
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
    expect(migration).not.toMatch(/ALTER COLUMN/i);
  });
});

describe('G1 — campaign-cap config module', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.FEE_WAIVER_LIFETIME_MAX;
    delete process.env.FEE_WAIVER_TEMPORARY_MAX;
    delete process.env.FEE_WAIVER_TEMPORARY_MONTHS;
    delete process.env.FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS;
  });

  test('founder-fixed defaults: 12 lifetime / 500 temporary / 6 months / 12 months ceiling', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require('../services/fee-waiver/config');
      expect(cfg.FEE_WAIVER_LIFETIME_MAX).toBe(12);
      expect(cfg.FEE_WAIVER_TEMPORARY_MAX).toBe(500);
      expect(cfg.FEE_WAIVER_TEMPORARY_MONTHS).toBe(6);
      expect(cfg.FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS).toBe(12);
    });
  });

  test('the temporary cap is env-tunable upward (founder may raise it)', () => {
    process.env.FEE_WAIVER_TEMPORARY_MAX = '750';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require('../services/fee-waiver/config');
      expect(cfg.FEE_WAIVER_TEMPORARY_MAX).toBe(750);
    });
  });
});
