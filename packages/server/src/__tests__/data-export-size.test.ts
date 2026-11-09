// EXPORT-AND-LEDGER G4 / §0.5 — the export still buffers, and this is what
// that costs at pilot scale.
//
// The endpoint assembles the whole JSON in memory and hands it to
// res.json(). That was cheap when the export was five shapes; it is a
// decision again now that it is nineteen. The decision here is to KEEP the
// buffer — a streaming JSON writer is real machinery, and the pilot's
// heaviest account does not need it — but "we think it is fine" is not a
// bound. This test IS the bound: it builds the heaviest account the pilot
// can plausibly produce, measures the serialised bytes, and fails if the
// answer stops being small.
//
// It also reports the per-table byte share, so the next reader can see
// WHICH table would be the one to stream first if this ever has to change.
// At the seed below the answer is messages, by a wide margin, and that is
// the number worth watching: everything else grows with rides, and
// messages grow with rides TIMES how talkative two people are.

import { DATA_EXPORT_NOTICE, DATA_EXPORT_NOTICE_KEY } from '../services/data-export.service';

/**
 * A heavy pilot account, twelve months in. Deliberately generous against
 * what the field has actually produced: a full-time motari taking ~8 rides
 * a day, every day, for a year.
 */
const HEAVY = {
  journeys: 2920,
  bids: 8760, // ~3 bids placed per ride won
  escrows: 2920,
  messages: 14600, // 5 messages per ride, both sides
  ratings: 5840, // given + received
  payoutBatches: 365,
  emergencyAlerts: 3,
  rideReports: 12,
  pickupVerifications: 2920,
  reconciliationResponses: 40,
  vehicleChangeLogs: 4,
  autoBidRules: 6,
  feeWaivers: 2,
  payoutPreferenceChanges: 6,
  deletionRequests: 1,
};

/** Rows shaped like the real projections, with realistic string lengths. */
const uuid = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

function buildHeavyExport() {
  const seq = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    notice: DATA_EXPORT_NOTICE,
    noticeKey: DATA_EXPORT_NOTICE_KEY,
    profile: { id: uuid(0), nickname: 'Bosco', phone: '+250788123456', role: 'BOTH' },
    driverProfile: { userId: uuid(0), vehicleType: 'MOTO', vehicleDescription: 'red Boxer' },
    journeys: seq(HEAVY.journeys).map((i) => ({
      id: uuid(i),
      customerId: uuid(1),
      driverId: uuid(0),
      status: 'COMPLETED',
      pickupName: 'Kimironko Market, Gasabo, Kigali',
      destinationName: 'Kigali Convention Centre, Nyarugenge',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      destinationLat: -1.9552,
      destinationLng: 30.0918,
      price: 1500,
      createdAt: '2026-08-24T10:00:00.000Z',
      endedAt: '2026-08-24T10:22:00.000Z',
    })),
    bids: seq(HEAVY.bids).map((i) => ({
      id: uuid(i),
      journeyId: uuid(i),
      driverId: uuid(0),
      price: 1500,
      etaMinutes: 7,
      status: 'DECLINED',
      createdAt: '2026-08-24T09:59:00.000Z',
      updatedAt: '2026-08-24T10:00:00.000Z',
    })),
    escrows: seq(HEAVY.escrows).map((i) => ({
      id: uuid(i),
      journeyId: uuid(i),
      customerId: uuid(1),
      driverId: uuid(0),
      amount: 1500,
      commission: 150,
      driverPayout: 1350,
      status: 'RELEASED',
      txRef: `bimoto-${uuid(i)}`,
      createdAt: '2026-08-24T10:00:00.000Z',
      releasedAt: '2026-08-24T10:30:00.000Z',
    })),
    feeWaivers: seq(HEAVY.feeWaivers).map((i) => ({ id: uuid(i), driverId: uuid(0), type: 'LIFETIME', campaign: 'pilot-launch', reason: 'first hundred motari' })),
    payoutBatches: seq(HEAVY.payoutBatches).map((i) => ({
      id: uuid(i),
      driverId: uuid(0),
      amount: 12400,
      txRef: `payout-${uuid(i)}`,
      status: 'SUCCESS',
      trigger: 'SCHEDULED_22H',
      createdAt: '2026-08-24T22:00:00.000Z',
      paidOutAt: '2026-08-24T22:01:00.000Z',
      held: false,
    })),
    payoutPreferenceChanges: seq(HEAVY.payoutPreferenceChanges).map((i) => ({ id: uuid(i), userId: uuid(0), oldPreference: 'SCHEDULED', newPreference: 'INSTANT', ipAddress: '41.186.0.1', otpVerified: true })),
    ratings: seq(HEAVY.ratings).map((i) => ({
      id: uuid(i),
      journeyId: uuid(i),
      direction: i % 2 ? 'GIVEN' : 'RECEIVED',
      stars: 5,
      comment: 'Arrived quickly and drove carefully, thank you very much',
      reason: null,
      createdAt: '2026-08-24T10:35:00.000Z',
    })),
    messages: seq(HEAVY.messages).map((i) => ({
      id: uuid(i),
      journeyId: uuid(i),
      text: 'I am waiting at the blue gate next to the pharmacy, wearing a green jacket',
      isQuickMessage: false,
      quickMessageId: null,
      createdAt: '2026-08-24T10:02:00.000Z',
      direction: i % 2 ? 'SENT' : 'RECEIVED',
      senderNickname: 'Bosco',
    })),
    emergencyAlerts: seq(HEAVY.emergencyAlerts).map((i) => ({ id: uuid(i), journeyId: uuid(i), raisedById: uuid(0), raisedByRole: 'DRIVER', pressLat: -1.95, pressLng: 30.06, status: 'RESOLVED', createdAt: '2026-08-24T10:10:00.000Z', resolvedAt: '2026-08-24T10:40:00.000Z' })),
    rideReports: seq(HEAVY.rideReports).map((i) => ({ id: uuid(i), journeyId: uuid(i), reporterId: uuid(0), reason: 'RUDE_BEHAVIOUR', details: 'Passenger refused to wear the helmet offered', createdAt: '2026-08-24T10:45:00.000Z' })),
    pickupVerifications: seq(HEAVY.pickupVerifications).map((i) => ({ id: uuid(i), journeyId: uuid(i), customerId: uuid(0), outcome: 'CONFIRMED', reason: null, createdAt: '2026-08-24T10:01:00.000Z', updatedAt: '2026-08-24T10:01:00.000Z' })),
    reconciliationResponses: seq(HEAVY.reconciliationResponses).map((i) => ({ id: uuid(i), journeyId: uuid(i), respondingUserId: uuid(0), response: 'ARRIVED_SAFELY', gpsLat: -1.95, gpsLng: 30.06, createdAt: '2026-08-24T10:30:00.000Z' })),
    vehicleChangeLogs: seq(HEAVY.vehicleChangeLogs).map((i) => ({ id: uuid(i), driverId: uuid(0), changedAt: '2026-03-01T08:00:00.000Z', oldVehicleType: 'BIKE', newVehicleType: 'MOTO', oldPlate: 'RAD123A', newPlate: 'RAB456B', oldDescription: 'blue bicycle', newDescription: 'red Boxer' })),
    autoBidRules: seq(HEAVY.autoBidRules).map((i) => ({ id: uuid(i), driverId: uuid(0), priority: i, enabled: true, maxPickupDistanceM: 2000, maxRideDistanceM: 15000, bidAmountMode: 'FLAT', bidAmountValue: 1500 })),
    deletionRequests: seq(HEAVY.deletionRequests).map((i) => ({ id: uuid(i), userId: uuid(0), status: 'CANCELLED', requestedAt: '2026-06-01T09:00:00.000Z', executesAt: '2026-06-04T09:00:00.000Z', cancelledAt: '2026-06-01T10:00:00.000Z' })),
  };
}

/**
 * The ceiling. 24 MB is roughly 3x the measured heavy-account size, which
 * leaves room for a year of ordinary growth and still fails long before
 * the buffer becomes a memory problem on the pilot's server. If a change
 * pushes past this, the answer is not to raise the number — it is to
 * stream the largest table, which the report below names.
 */
const BUFFER_CEILING_BYTES = 24 * 1024 * 1024;

describe('the buffered export stays inside an honest bound', () => {
  const json = JSON.stringify(buildHeavyExport());
  const bytes = Buffer.byteLength(json, 'utf8');

  test('a twelve-month heavy account serialises well under the ceiling', () => {
    expect(bytes).toBeLessThan(BUFFER_CEILING_BYTES);
  });

  test('the largest table is named rather than discovered later', () => {
    const heavy = buildHeavyExport() as unknown as Record<string, unknown>;
    const shares = Object.entries(heavy)
      .map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v), 'utf8')] as const)
      .sort((a, b) => b[1] - a[1]);

    // eslint-disable-next-line no-console
    console.log(
      `[data-export] heavy account: ${(bytes / 1024 / 1024).toFixed(2)} MB total\n` +
        shares
          .map(([k, b]) => `    ${k.padEnd(24)} ${(b / 1024).toFixed(0).padStart(7)} KB`)
          .join('\n'),
    );

    // messages is the table that would have to stream first, and no other
    // table may quietly overtake it without somebody reading this line.
    expect(shares[0][0]).toBe('messages');
  });

  test('no single table is itself over the ceiling', () => {
    const heavy = buildHeavyExport() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(heavy)) {
      expect([k, Buffer.byteLength(JSON.stringify(v), 'utf8') < BUFFER_CEILING_BYTES]).toEqual([
        k,
        true,
      ]);
    }
  });
});
