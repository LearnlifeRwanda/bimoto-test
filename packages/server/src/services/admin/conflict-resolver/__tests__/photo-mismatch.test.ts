import { photoMismatchModule } from '../conflicts/photo-mismatch';

function buildPrisma() {
  const adminActionRows: any[] = [];
  const escrowAuditRows: any[] = [];
  const journeys = new Map<string, any>();

  const tx: any = {
    journey: {
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(journeys.values()).filter((j: any) => {
          if (where.type && j.type !== where.type) return false;
          if (where.status && j.status !== where.status) return false;
          if (where.pickupPhotoUrl?.not !== undefined && !j.pickupPhotoUrl)
            return false;
          if (where.deliveryPhotoUrl?.not !== undefined && !j.deliveryPhotoUrl)
            return false;
          return true;
        });
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const j = journeys.get(where.id);
        if (!j) return null;
        return { ...j };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async () =>
        adminActionRows.length === 0
          ? null
          : adminActionRows[adminActionRows.length - 1],
      ),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId))
            return false;
          return true;
        });
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async () =>
        escrowAuditRows.length === 0
          ? null
          : escrowAuditRows[escrowAuditRows.length - 1],
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ea-${escrowAuditRows.length + 1}`, ...data };
        escrowAuditRows.push(row);
        return row;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, journeys, adminActionRows, escrowAuditRows };
}

describe('photo-mismatch conflict module', () => {
  test('listOpen returns goods journeys with both photos within window', async () => {
    const { prisma, journeys } = buildPrisma();
    journeys.set('j1', {
      id: 'j1',
      type: 'GOODS',
      status: 'COMPLETED',
      pickupPhotoUrl: '/u/1.jpg',
      deliveryPhotoUrl: '/u/2.jpg',
      endedAt: new Date(),
      pickupName: 'A',
      destinationName: 'B',
      recipientName: 'Recipient',
    });
    journeys.set('j2', {
      id: 'j2',
      type: 'PASSENGER',
      status: 'COMPLETED',
      pickupPhotoUrl: null,
      deliveryPhotoUrl: null,
      endedAt: new Date(),
    });
    const items = await photoMismatchModule.listOpen(prisma, { limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('j1');
  });

  test('decide RESOLVED_REFUND cross-writes EscrowAuditLog', async () => {
    const { prisma, journeys, adminActionRows, escrowAuditRows } = buildPrisma();
    journeys.set('j1', {
      id: 'j1',
      type: 'GOODS',
      status: 'COMPLETED',
      pickupPhotoUrl: '/u/1.jpg',
      deliveryPhotoUrl: '/u/2.jpg',
      endedAt: new Date(),
      escrow: { id: 'e-1', amount: 5000 },
    });
    await photoMismatchModule.decide(
      {
        id: 'j1',
        decision: 'RESOLVED_REFUND',
        reason: 'photo did not match recipient',
        adminId: 'admin-1',
      },
      prisma,
    );
    expect(escrowAuditRows).toHaveLength(1);
    expect(escrowAuditRows[0].action).toBe('ADMIN_PHOTO_MISMATCH_REFUND');
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].crossLinkedEscrowAuditLogId).toBe('ea-1');
  });

  test('decide NO_ACTION does NOT cross-write EscrowAuditLog', async () => {
    const { prisma, journeys, adminActionRows, escrowAuditRows } = buildPrisma();
    journeys.set('j1', {
      id: 'j1',
      type: 'GOODS',
      status: 'COMPLETED',
      pickupPhotoUrl: '/u/1.jpg',
      deliveryPhotoUrl: '/u/2.jpg',
      endedAt: new Date(),
      escrow: { id: 'e-1', amount: 5000 },
    });
    await photoMismatchModule.decide(
      {
        id: 'j1',
        decision: 'NO_ACTION',
        reason: 'photo verified by support',
        adminId: 'admin-1',
      },
      prisma,
    );
    expect(escrowAuditRows).toHaveLength(0);
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].crossLinkedEscrowAuditLogId).toBeNull();
  });
});
