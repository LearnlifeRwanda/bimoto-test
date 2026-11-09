// LIVE-WIRE G4 — the passenger sees only their price.
//
// The Kigali team's report was "the passenger can see the amount the
// driver receives after commission — too much information." This suite
// asserts the fix where it has to live: in what the API actually
// answers, per role, for the SAME bid and the SAME journey. A CSS or
// component-level fix would leave the number on the wire, one
// `curl` away.
//
// The negative assertion is deliberately written against the whole
// serialized object, not a hand-listed set of keys, so a future field
// added to the breakdown cannot quietly re-open the leak.

import * as bidService from '../services/bid.service';
import * as journeyService from '../services/journey.service';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    bid: { findMany: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    vehicleChangeLog: { findMany: jest.fn() },
    feeWaiver: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

import mockPrisma from '../prisma';

const CUSTOMER_ID = 'cust-1';
const DRIVER_ID = 'drv-1';
const RIVAL_ID = 'drv-2';

/** Every key from which the driver's net can be read or reconstructed. */
const DRIVER_MONEY_KEYS = [
  'driverPayout',
  'driverTier',
  'driverCommissionRate',
  'driverSavings',
  'totalCommissionAmount',
  'totalCommissionRate',
  'chargedCommissionAmount',
  'waivedCommissionAmount',
];

function driverProfileFixture(totalRides: number) {
  return {
    avgRating: 4.5,
    totalRides,
    vehicleType: 'MOTO',
    vehicleDescription: 'Honda',
    registrationPlate: 'RAB123',
    verificationStatus: 'VERIFIED',
    ruraAuthorizationNumber: 'RURA-001',
    insuranceConfirmed: true,
    cooperativeName: 'Coop A',
  };
}

function seedBidList() {
  (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
    id: 'j1',
    customerId: CUSTOMER_ID,
    status: 'REQUESTED',
  });
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: CUSTOMER_ID,
    completedRides: 50,
  });
  (mockPrisma.vehicleChangeLog.findMany as jest.Mock).mockResolvedValue([]);
  ((mockPrisma as any).feeWaiver.findMany as jest.Mock).mockResolvedValue([]);
  ((mockPrisma as any).feeWaiver.findFirst as jest.Mock).mockResolvedValue(null);
  const rows = [
    {
      id: 'bid-mine',
      journeyId: 'j1',
      driverId: DRIVER_ID,
      price: 1200,
      etaMinutes: 5,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
      driver: { nickname: 'Jean', driverProfile: driverProfileFixture(200) },
    },
    {
      id: 'bid-rival',
      journeyId: 'j1',
      driverId: RIVAL_ID,
      price: 1400,
      etaMinutes: 8,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
      driver: { nickname: 'Alice', driverProfile: driverProfileFixture(3) },
    },
  ];
  // CLEAN-SWEEP G4 — the mock HONOURS `where.driverId`.
  //
  // It used to answer every call with both rows whatever was asked for,
  // which meant this suite could see COLUMN scoping and was structurally
  // blind to ROW scoping: the wide bids read it was written alongside
  // could not have been caught here however the assertions were worded.
  // A mock that ignores the filter under test is not an oracle.
  (mockPrisma.bid.findMany as jest.Mock).mockImplementation(async (args: any) => {
    const wanted = args?.where?.driverId;
    return wanted ? rows.filter((r) => r.driverId === wanted) : rows;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seedBidList();
});

describe('GET /journeys/:id/bids — customer view', () => {
  // MONEY-VIEW v2 G3 — this test used to say "carries no commission data
  // at all", and that was the right answer to the wrong question. The
  // motari's net is not hers; her OWN tier and what it saved her are, and
  // `customerSavings` is a function of the CUSTOMER rate alone, so it
  // narrows to nothing about him. Withholding it did not protect him — it
  // left her confirm dialog reading three fields that were never sent.
  //
  // So the pin states the stronger fact: she carries the customer-safe
  // FOUR, and STILL not one column from which his payout is readable.
  test('carries the savings preview and STILL no money column of his', async () => {
    // CUTGUARD v2 G6 (B-2) — the preview is now scoped to a client that
    // can RENDER it: a v13 BidListPage reads `totalCommissionAmount` off
    // this object and the customer-safe shape has no such key, so sending
    // it to an un-updated phone crashes her confirm dialog. This case is
    // about a CURRENT client, so it asks for the current payload; the
    // legacy arm and the contract test live in
    // cutguard-savings-preview-gate.
    const rows = await bidService.getBidsForJourney('j1', CUSTOMER_ID, {
      customerSavingsPreview: true,
    });

    expect(rows).toHaveLength(2);
    for (const row of rows as any[]) {
      expect(row.commissionBreakdown).toBeDefined();
      // Exactly the four. Asserted as a SET, so a field added to this
      // projection later shows up as a failing list rather than as a
      // quiet widening of what a passenger receives.
      expect(Object.keys(row.commissionBreakdown).sort()).toEqual([
        'bidPrice',
        'customerSavings',
        'customerTier',
        'feeWaiverApplied',
      ]);
      expect(row.commissionBreakdown.bidPrice).toBe(row.price);

      const serialized = JSON.stringify(row);
      for (const key of DRIVER_MONEY_KEYS) {
        expect(serialized).not.toContain(key);
      }
    }
  });

  test('still carries everything the passenger decides on', async () => {
    const [cheapest] = await bidService.getBidsForJourney('j1', CUSTOMER_ID);

    // The price they will pay, and who is offering it.
    expect(cheapest.price).toBe(1200);
    expect(cheapest.etaMinutes).toBe(5);
    expect(cheapest.driver.nickname).toBe('Jean');
    expect(cheapest.driver.avgRating).toBe(4.5);
    expect(cheapest.driver.verificationStatus).toBe('VERIFIED');
  });
});

describe('GET /journeys/:id/bids — driver view', () => {
  test('carries the breakdown on his own bid', async () => {
    const rows = await bidService.getBidsForJourney('j1', DRIVER_ID);
    const mine = rows.find((r: any) => r.id === 'bid-mine')!;

    // MONEY-VIEW v2 G3 — `commissionBreakdown` is now a UNION on the wire:
    // the full block for a driver/privileged caller, the customer-safe four
    // for the passenger. The compiler said so during that change (TS2532 on
    // `totalCommissionAmount`), which is the same lesson CLEAN-SWEEP G1
    // learned client-side — a key carrying more than one shape must be
    // narrowed before it is dereferenced. Narrowed here rather than
    // asserted through `!`, so this test keeps proving the DRIVER shape
    // specifically.
    const full = mine.commissionBreakdown as
      | { bidPrice: number; driverPayout: number; totalCommissionAmount: number }
      | undefined;
    expect(full).toBeDefined();
    expect(full!.bidPrice).toBe(1200);
    expect(typeof full!.totalCommissionAmount).toBe('number');
    expect(full!.driverPayout).toBe(1200 - full!.totalCommissionAmount);
  });

  // CLEAN-SWEEP G4 — the rival's bid is not in the response AT ALL.
  //
  // LIVE-WIRE G4 wrote "a rival's payout is no more his business than it
  // is the customer's" and could only act on the COLUMNS, so this test
  // asserted the absence of a breakdown on a row that was still being
  // handed over — price, ETA, nickname and plate included. In a sealed-bid
  // marketplace the PRICE is the bid; scoping the money off a row a rival
  // can still read is not a redaction. The row is now filtered out at the
  // query, which makes the original assertion vacuously true and states
  // the stronger fact instead.
  test("a rival's bid is absent from a driver's read — row, not just columns", async () => {
    const rows = await bidService.getBidsForJourney('j1', DRIVER_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('bid-mine');
    expect(rows.find((r: any) => r.id === 'bid-rival')).toBeUndefined();

    // Not one field of the rival's offer, on the whole response.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('1400');
    expect(serialized).not.toContain('Alice');
    expect(serialized).not.toContain(RIVAL_ID);
  });

  test('the driver still gets his own row whole', async () => {
    const [mine] = await bidService.getBidsForJourney('j1', DRIVER_ID);

    expect(mine.price).toBe(1200);
    expect(mine.etaMinutes).toBe(5);
    expect(mine.commissionBreakdown).toBeDefined();
  });
});

// CLEAN-SWEEP G4 — who may read the list at all.
describe('GET /journeys/:id/bids — the rows are scoped, not only the columns', () => {
  test('the journey CUSTOMER reads every bid — she is choosing between them', async () => {
    const rows = await bidService.getBidsForJourney('j1', CUSTOMER_ID);

    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['bid-mine', 'bid-rival']);
  });

  test('a privileged (no-viewer) caller reads every bid — admin tooling, unchanged', async () => {
    const rows = await bidService.getBidsForJourney('j1');

    expect(rows).toHaveLength(2);
  });

  test('a STRANGER — a driver with no bid on this journey — is refused, not given []', async () => {
    // `[]` would assert "this journey has no bids", which is false and,
    // to a motari deciding whether to bid, useful.
    await expect(bidService.getBidsForJourney('j1', 'drv-nobody')).rejects.toMatchObject({
      statusCode: 404,
      code: 'JOURNEY_NOT_FOUND',
    });
  });

  test('a STRANGER — another customer — is refused too', async () => {
    // Another passenger is `driver` scope by elimination, holds no bid,
    // and is refused on the same path.
    await expect(bidService.getBidsForJourney('j1', 'cust-2')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('the socket payload is the polled payload', () => {
  // CUTGUARD v2 G6 (B-2) — THIS INVARIANT WAS DELIBERATELY NARROWED, and
  // the narrowing is worth reading before it is worth judging.
  //
  // MONEY-VIEW v2 G3 asserted that the socket payload and the polled
  // payload cannot drift, because the socket reuses `getBidsForJourney`
  // rather than duplicating the mapper. Two halves of that were being
  // asserted at once:
  //
  //   THE SECURITY HALF — the socket row is CUSTOMER-SCOPED and carries
  //     no column of the motari's money. UNCHANGED, and still asserted
  //     below. That is the half MONEY-VIEW was built for.
  //
  //   THE FRESHNESS HALF — the savings preview arrives on the socket too,
  //     so she sees it the instant a bid lands rather than on her next
  //     fetch. This is the half that had to give, and only for the
  //     length of the rollout.
  //
  // WHY IT HAD TO GIVE. A socket emit has no `X-App-Version`: this one is
  // triggered by the DRIVER's `POST /bids` request, and his version says
  // nothing about the passenger's phone. There is no signal about the
  // RECIPIENT at this point in the code. With no signal the only safe
  // shape is the legacy one, because the alternative is a v13 passenger's
  // screen going white on a push she did not ask for.
  //
  // THE COST, and its end. During the window the savings line appears on
  // her next fetch instead of on the live push. The follow-up is to carry
  // the app version through the socket handshake (where the client
  // already sends its token) and shape per recipient;
  // docs/rollout-window.md records it, and once every client is >= 14 the
  // gate simply goes and this test goes back to asserting both halves.
  test('getBidViewForCustomer returns the customer-scoped row, not the raw Prisma bid', async () => {
    const view: any = await bidService.getBidViewForCustomer('j1', 'bid-mine');

    // The shape the list renders — this is what was missing from the
    // socket emit and cost the passenger a whole poll interval. Unchanged.
    expect(view.driver.nickname).toBe('Jean');
    expect(view.driver.avgRating).toBe(4.5);

    // THE SECURITY HALF, unchanged and still the point: not one column
    // from which the motari's payout is readable, on any path.
    for (const key of DRIVER_MONEY_KEYS) {
      expect(JSON.stringify(view)).not.toContain(key);
    }

    // THE FRESHNESS HALF, narrowed: the preview is withheld from a
    // payload whose recipient cannot be identified. Asserted explicitly
    // rather than dropped, so the day the handshake carries a version
    // this line is the one that says what to change.
    expect(view.commissionBreakdown).toBeUndefined();
  });

  test('the socket and the polled payload still agree for a LEGACY client', async () => {
    // The no-drift property, in the form that survives: for the same
    // recipient generation the two paths produce the same object. What
    // ended was drift-free-ness ACROSS generations, not within one.
    const view: any = await bidService.getBidViewForCustomer('j1', 'bid-mine');
    const polled = (await bidService.getBidsForJourney('j1', CUSTOMER_ID, {
      customerSavingsPreview: false,
    })) as any[];
    const same = polled.find((b) => b.id === 'bid-mine');
    expect(Object.keys(view).sort()).toEqual(Object.keys(same).sort());
  });
});

describe('GET /journeys/:id — matched journey', () => {
  const matchedJourney = {
    id: 'j1',
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
    agreedPrice: 1200,
    status: 'MATCHED',
    escrow: null,
    customer: { id: CUSTOMER_ID, nickname: 'Chantal', completedRides: 50 },
    driver: { id: DRIVER_ID, nickname: 'Jean', driverProfile: driverProfileFixture(200) },
    bids: [],
    messages: [],
    legs: [],
  };

  beforeEach(() => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(matchedJourney);
  });

  test('customer view carries no field that reconstructs the driver net', async () => {
    // CUTGUARD v2 amendment 2 — as a CURRENT client. The claim here is
    // about what the customer PROJECTION contains, so the projection has
    // to be present; the version gate deciding whether it is attached at
    // all is a separate question, pinned separately.
    const journey: any = await journeyService.getJourneyById('j1', CUSTOMER_ID, {
      customerSavingsPreview: true,
    });

    expect(journey.commissionBreakdown).toBeDefined();
    for (const key of DRIVER_MONEY_KEYS) {
      expect(journey.commissionBreakdown).not.toHaveProperty(key);
    }
    // What the passenger legitimately keeps: their price and their own
    // tier's saving.
    expect(journey.commissionBreakdown.bidPrice).toBe(1200);
    expect(journey.commissionBreakdown.customerTier).toBe('SUPER');
    expect(typeof journey.commissionBreakdown.customerSavings).toBe('number');
  });

  test('driver view keeps the full breakdown', async () => {
    const journey: any = await journeyService.getJourneyById('j1', DRIVER_ID);

    expect(journey.commissionBreakdown.driverPayout).toBeDefined();
    expect(journey.commissionBreakdown.totalCommissionAmount).toBeDefined();
  });
});

describe('GET /journeys/:id — unmatched journey, driver view', () => {
  test('carries payoutContext so the bid screen can state an exact net', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: CUSTOMER_ID,
      driverId: null,
      agreedPrice: null,
      status: 'REQUESTED',
      escrow: null,
      customer: { id: CUSTOMER_ID, nickname: 'Chantal', completedRides: 50 },
      driver: null,
      bids: [],
      messages: [],
      legs: [],
    });
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      totalRides: 200,
    });

    const journey: any = await journeyService.getJourneyById('j1', DRIVER_ID);

    // PRO driver 2.5% + SUPER customer 2.5% = 5%.
    expect(journey.payoutContext.totalCommissionRate).toBeCloseTo(0.05, 6);
    expect(journey.payoutContext.driverTier).toBe('PRO');
    expect(journey.payoutContext.feeWaiverApplied).toBe(false);
  });

  test('customer view of their own unmatched journey carries no payoutContext', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customerId: CUSTOMER_ID,
      driverId: null,
      agreedPrice: null,
      status: 'REQUESTED',
      escrow: null,
      customer: { id: CUSTOMER_ID, nickname: 'Chantal', completedRides: 50 },
      driver: null,
      bids: [],
      messages: [],
      legs: [],
    });

    const journey: any = await journeyService.getJourneyById('j1', CUSTOMER_ID);
    expect(journey).not.toHaveProperty('payoutContext');
  });
});
