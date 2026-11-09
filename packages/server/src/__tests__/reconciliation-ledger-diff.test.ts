jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findMany: jest.fn() },
  },
}));

import prisma from '../prisma';
import { diffGatewayVsLedger } from '../jobs/reconciliation/ledger-diff';

const findMany = (prisma as any).escrow.findMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('diffGatewayVsLedger', () => {
  test('matches gateway+ledger when statuses agree', async () => {
    findMany.mockResolvedValue([
      { id: 'e1', txRef: 'r1', status: 'HELD', amount: 2000 },
    ]);
    const r = await diffGatewayVsLedger({
      gatewayRecords: [
        { tx_ref: 'r1', amount: 2000, status: 'successful', created_at: '' },
      ],
      since: new Date('2026-05-03T00:00:00Z'),
    });
    expect(r.matches).toBe(1);
    expect(r.missingFromLedger).toHaveLength(0);
    expect(r.statusMismatch).toHaveLength(0);
  });

  test('detects gateway-only (missingFromLedger) — money may have moved without a record', async () => {
    findMany.mockResolvedValue([]);
    const r = await diffGatewayVsLedger({
      gatewayRecords: [
        { tx_ref: 'r-orphan', amount: 5000, status: 'successful', created_at: '' },
      ],
      since: new Date(),
    });
    expect(r.missingFromLedger).toHaveLength(1);
    expect(r.missingFromLedger[0].txRef).toBe('r-orphan');
  });

  test('detects ledger-only (missingFromGateway) for HELD/RELEASED rows — BAD', async () => {
    findMany.mockResolvedValue([
      { id: 'e1', txRef: 'r1', status: 'HELD', amount: 2000 },
    ]);
    const r = await diffGatewayVsLedger({
      gatewayRecords: [],
      since: new Date(),
    });
    expect(r.missingFromGateway).toHaveLength(1);
    expect(r.missingFromGateway[0].escrowId).toBe('e1');
  });

  test('PENDING ledger rows missing from gateway are NOT flagged (expected)', async () => {
    findMany.mockResolvedValue([
      { id: 'e1', txRef: 'r1', status: 'PENDING', amount: 2000 },
    ]);
    const r = await diffGatewayVsLedger({
      gatewayRecords: [],
      since: new Date(),
    });
    expect(r.missingFromGateway).toHaveLength(0);
  });

  test('detects status mismatch — gateway success vs ledger FAILED', async () => {
    findMany.mockResolvedValue([
      { id: 'e1', txRef: 'r1', status: 'FAILED', amount: 2000 },
    ]);
    const r = await diffGatewayVsLedger({
      gatewayRecords: [
        { tx_ref: 'r1', amount: 2000, status: 'successful', created_at: '' },
      ],
      since: new Date(),
    });
    expect(r.statusMismatch).toHaveLength(1);
    expect(r.statusMismatch[0].ledgerStatus).toBe('FAILED');
    expect(r.statusMismatch[0].gatewayStatus).toBe('successful');
  });
});
