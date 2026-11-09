// CUTGUARD v2 amendment 2 — the gate's WIRING, surface by surface.
//
// B-2 is a class, and this is the table that says so. G6 gated the bid
// list and reported the class closed; it was not, because "the class" was
// never written down anywhere a test could read it. Three more surfaces
// carried the same shape to the same phones, and the fourth and fifth
// were found by a guard rule rather than by reading.
//
// So the enumeration lives here, as assertions:
//
//   surface                                     service fn
//   ------------------------------------------- -----------------------
//   GET  /api/journeys                          getJourneys
//   GET  /api/journeys/:id                      getJourneyById
//   GET  /api/journeys/:id/bids                 getBidsForJourney
//   POST /api/journeys/:id/accept-bid           acceptBid
//   POST /api/journeys/:id/accept-bid-card      acceptBidForCard
//   POST /api/scheduled-rides/:id/conflict-…    acceptBid
//
// WHAT THIS FILE PINS, and what it deliberately does not. It pins the
// WIRING: that the header reaches the service as the option, on every
// customer-facing exit, in both directions. What the projection CONTAINS
// is pinned by the service-level tests (money-view-list-attach,
// money-view-escrow-scope, cutguard-accept-bid-customer-money) and at the
// wire on real Postgres by scripts/livewire/cutguard-wire-pins.ts.
//
// Splitting it that way is on purpose: a wiring bug and a projection bug
// have different fixes and should not be able to hide behind each other.

jest.mock('../services/journey.service');
jest.mock('../services/bid.service');

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import journeyRoutes from '../routes/journey.routes';
import bidRoutes from '../routes/bid.routes';
import scheduledRideRoutes from '../routes/scheduled-ride.routes';
import { appVersionMiddleware, CURRENT_APP_VERSION } from '../middleware/app-version';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import * as journeyService from '../services/journey.service';
import * as bidService from '../services/bid.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(appVersionMiddleware);
app.use('/api/journeys', journeyRoutes);
app.use('/api/journeys', bidRoutes);
app.use('/api/scheduled-rides', scheduledRideRoutes);
app.use(errorHandler);

const CUSTOMER = 'c1';
const cookie = `accessToken=${generateAccessToken({ userId: CUSTOMER, role: 'CUSTOMER' })}`;
const BID = '11111111-1111-1111-1111-111111111111';

const mocked = {
  getJourneys: journeyService.getJourneys as jest.Mock,
  getJourneyById: journeyService.getJourneyById as jest.Mock,
  getBidsForJourney: bidService.getBidsForJourney as jest.Mock,
  acceptBid: bidService.acceptBid as jest.Mock,
  acceptBidForCard: bidService.acceptBidForCard as jest.Mock,
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getJourneys.mockResolvedValue([]);
  mocked.getJourneyById.mockResolvedValue({ id: 'j1', customerId: CUSTOMER, driverId: null });
  mocked.getBidsForJourney.mockResolvedValue([]);
  mocked.acceptBid.mockResolvedValue({ journey: { id: 'j1' }, bid: { id: 'b1' } });
  mocked.acceptBidForCard.mockResolvedValue({
    journey: { id: 'j1' },
    cardCheckout: { escrowId: 'e1', txRef: 't1', amount: 2000 },
  });
});

/** The option, as the service actually received it, from the last call. */
function optionFrom(mock: jest.Mock, argIndex: number): unknown {
  expect(mock).toHaveBeenCalled();
  const args = mock.mock.calls[0];
  return (args[argIndex] as { customerSavingsPreview?: unknown })?.customerSavingsPreview;
}

/**
 * The six exits, each with the argument position the option arrives in.
 * `getJourneys` takes it eighth because it was APPENDED — every existing
 * call site keeps its exact meaning, which is what made threading it a
 * safe change rather than a signature migration.
 */
const SURFACES: Array<{
  name: string;
  argIndex: number;
  mock: () => jest.Mock;
  send: (version?: string) => request.Test;
}> = [
  {
    name: 'GET /api/journeys — the rides list (HistoryPage)',
    argIndex: 7,
    mock: () => mocked.getJourneys,
    send: (v) => withVersion(request(app).get('/api/journeys'), v),
  },
  {
    name: 'GET /api/journeys/:id — the journey read (MatchedPage, RideReceiptPage)',
    argIndex: 2,
    mock: () => mocked.getJourneyById,
    send: (v) => withVersion(request(app).get('/api/journeys/j1'), v),
  },
  {
    name: 'GET /api/journeys/:id/bids — the bid list (BidListPage), the one G6 gated',
    argIndex: 2,
    mock: () => mocked.getBidsForJourney,
    send: (v) => withVersion(request(app).get('/api/journeys/j1/bids'), v),
  },
  {
    name: 'POST /api/journeys/:id/accept-bid — the MoMo accept',
    argIndex: 3,
    mock: () => mocked.acceptBid,
    send: (v) => withVersion(request(app).post('/api/journeys/j1/accept-bid'), v).send({ bidId: BID }),
  },
  {
    name: 'POST /api/journeys/:id/accept-bid-card — the card accept',
    argIndex: 3,
    mock: () => mocked.acceptBidForCard,
    send: (v) =>
      withVersion(request(app).post('/api/journeys/j1/accept-bid-card'), v).send({ bidId: BID }),
  },
  {
    name: 'POST /api/scheduled-rides/:id/conflict-acknowledge — the re-accept',
    argIndex: 3,
    mock: () => mocked.acceptBid,
    send: (v) =>
      withVersion(request(app).post('/api/scheduled-rides/j1/conflict-acknowledge'), v).send({
        bidId: BID,
      }),
  },
];

function withVersion(t: request.Test, version?: string): request.Test {
  const withCookie = t.set('Cookie', cookie);
  return version === undefined ? withCookie : withCookie.set('X-App-Version', version);
}

describe('B-2 as a CLASS — every customer commission surface answers by generation', () => {
  for (const surface of SURFACES) {
    describe(surface.name, () => {
      test('a current client is told so', async () => {
        await surface.send(String(CURRENT_APP_VERSION));
        expect(optionFrom(surface.mock(), surface.argIndex)).toBe(true);
      });

      test('a legacy client is told so', async () => {
        await surface.send(String(CURRENT_APP_VERSION - 1));
        expect(optionFrom(surface.mock(), surface.argIndex)).toBe(false);
      });

      test('NO header at all is legacy — the answer that cannot break anybody', async () => {
        await surface.send(undefined);
        expect(optionFrom(surface.mock(), surface.argIndex)).toBe(false);
      });

      test('a header that is not a version is legacy, not a parseInt guess', async () => {
        // `parseInt('14.1-beta')` is 14, which would have a gate believing
        // a client it should not. The parser is one regex for this reason.
        await surface.send('14.1-beta');
        expect(optionFrom(surface.mock(), surface.argIndex)).toBe(false);
      });
    });
  }

  test('all six surfaces are covered here — the enumeration IS the point', () => {
    // A seventh customer-facing exit added later shows up in the guard
    // (S5 refuses a route that does not declare) and should show up here
    // too. This assertion is the reminder to add it.
    expect(SURFACES).toHaveLength(6);
    expect(new Set(SURFACES.map((s) => s.name)).size).toBe(6);
  });
});
