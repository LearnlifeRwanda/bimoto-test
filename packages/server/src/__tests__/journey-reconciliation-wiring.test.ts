// R3-RECONCILIATION-WIRING-FIX (Group 1) — customer-initiated interruptJourney
// must open reconciliation so the case surfaces to the admin
// JOURNEY_RECONCILIATION queue, mirroring the cron systemInterruptJourney path.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
    escrow: { findUnique: jest.fn() },
    gpsPoint: { create: jest.fn() },
    message: { create: jest.fn() },
  },
}));

jest.mock('../services/escrow.service', () => ({
  freezeEscrow: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';
import * as escrowService from '../services/escrow.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const findOpenedAtUpdate = () =>
  (mockPrisma.journey.update as jest.Mock).mock.calls.find(
    ([arg]) => arg?.data?.reconciliationOpenedAt instanceof Date,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.update as jest.Mock).mockResolvedValue({ id: 'j1' });
});

describe('interruptJourney — opens reconciliation (Gap 1)', () => {
  beforeEach(() => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: 'c1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
    });
  });

  test('interruptJourney sets reconciliationOpenedAt', async () => {
    await journeyService.interruptJourney('j1', 'c1');
    expect(findOpenedAtUpdate()).toBeTruthy();
  });

  test('interruptJourney still freezes escrow and transitions to INTERRUPTED', async () => {
    await journeyService.interruptJourney('j1', 'c1');
    expect(escrowService.freezeEscrow).toHaveBeenCalledWith('j1', 'c1');
    const statusUpdate = (mockPrisma.journey.update as jest.Mock).mock.calls.find(
      ([arg]) => arg?.data?.status === 'INTERRUPTED',
    );
    expect(statusUpdate).toBeTruthy();
  });
});

describe('systemInterruptJourney — still opens reconciliation (regression)', () => {
  test('systemInterruptJourney sets reconciliationOpenedAt', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j2',
      customerId: 'c1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
    });
    (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(null);

    await journeyService.systemInterruptJourney('j2', 'STALE_NO_GPS_HEARTBEAT');
    expect(findOpenedAtUpdate()).toBeTruthy();
  });
});
