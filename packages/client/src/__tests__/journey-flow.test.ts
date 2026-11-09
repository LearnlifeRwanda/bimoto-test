import { describe, test, expect } from 'vitest';
import {
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  BidStatus,
  BidAction,
  transitionBid,
  EscrowStatus,
  EscrowAction,
  transitionEscrow,
} from '@bimoto/shared';

/**
 * Tests the full customer journey flow through state machine transitions,
 * simulating the sequence of events a user experiences in the app.
 */
describe('Customer Journey Flow', () => {
  test('happy path: REQUESTED -> MATCHED -> IN_PROGRESS -> AWAITING_CONFIRMATION -> COMPLETED', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.REQUESTED;

    // Customer posts a journey request, driver bids, customer accepts
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.ACCEPT_BID);
    expect(journeyStatus).toBe(JourneyStatus.MATCHED);

    // Driver starts the journey
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.START_JOURNEY);
    expect(journeyStatus).toBe(JourneyStatus.IN_PROGRESS);

    // Driver ends the journey at destination
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.END_JOURNEY);
    expect(journeyStatus).toBe(JourneyStatus.AWAITING_CONFIRMATION);

    // Customer confirms delivery/arrival
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.CONFIRM);
    expect(journeyStatus).toBe(JourneyStatus.COMPLETED);
  });

  test('bid lifecycle alongside journey: bid accepted, escrow created and released', () => {
    // Bid goes from PENDING to ACCEPTED when customer selects it
    let bidStatus = transitionBid(BidStatus.PENDING, BidAction.ACCEPT);
    expect(bidStatus).toBe(BidStatus.ACCEPTED);

    // Escrow is created as HELD when bid is accepted
    let escrowStatus: EscrowStatus = EscrowStatus.HELD;

    // After journey completes, escrow is released
    escrowStatus = transitionEscrow(escrowStatus, EscrowAction.RELEASE);
    expect(escrowStatus).toBe(EscrowStatus.RELEASED);
  });

  test('cancellation flow from REQUESTED: no escrow involved', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.REQUESTED;

    // Customer cancels before any bid is accepted
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.CANCEL);
    expect(journeyStatus).toBe(JourneyStatus.CANCELLED);

    // Terminal state - no further transitions allowed
    expect(() => transitionJourney(journeyStatus, JourneyAction.START_JOURNEY)).toThrow();
  });

  test('cancellation flow from MATCHED: escrow refunded', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.MATCHED;

    // Escrow was created on match
    let escrowStatus: EscrowStatus = EscrowStatus.HELD;

    // Customer or driver cancels after matching
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.CANCEL);
    expect(journeyStatus).toBe(JourneyStatus.CANCELLED);

    // Escrow is refunded
    escrowStatus = transitionEscrow(escrowStatus, EscrowAction.REFUND);
    expect(escrowStatus).toBe(EscrowStatus.REFUNDED);
  });

  test('dispute flow: journey disputed, escrow frozen then resolved', () => {
    // Journey reaches awaiting confirmation
    let journeyStatus = transitionJourney(JourneyStatus.IN_PROGRESS, JourneyAction.END_JOURNEY);
    expect(journeyStatus).toBe(JourneyStatus.AWAITING_CONFIRMATION);

    // Customer disputes
    journeyStatus = transitionJourney(journeyStatus, JourneyAction.DISPUTE);
    expect(journeyStatus).toBe(JourneyStatus.DISPUTED);

    // Escrow frozen during dispute
    let escrowStatus = transitionEscrow(EscrowStatus.HELD, EscrowAction.FREEZE);
    expect(escrowStatus).toBe(EscrowStatus.FROZEN);

    // After dispute resolution, escrow can be refunded
    escrowStatus = transitionEscrow(escrowStatus, EscrowAction.REFUND);
    expect(escrowStatus).toBe(EscrowStatus.REFUNDED);
  });

  test('interrupt flow: journey interrupted mid-ride, escrow frozen', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.IN_PROGRESS;

    journeyStatus = transitionJourney(journeyStatus, JourneyAction.INTERRUPT);
    expect(journeyStatus).toBe(JourneyStatus.INTERRUPTED);

    // Escrow frozen for investigation
    let escrowStatus = transitionEscrow(EscrowStatus.HELD, EscrowAction.FREEZE);
    expect(escrowStatus).toBe(EscrowStatus.FROZEN);

    // After resolution, escrow released to driver
    escrowStatus = transitionEscrow(escrowStatus, EscrowAction.RELEASE);
    expect(escrowStatus).toBe(EscrowStatus.RELEASED);
  });

  test('expiry flow: journey expires with no bids accepted', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.REQUESTED;

    journeyStatus = transitionJourney(journeyStatus, JourneyAction.EXPIRE);
    expect(journeyStatus).toBe(JourneyStatus.EXPIRED);

    // Terminal - cannot restart
    expect(() => transitionJourney(journeyStatus, JourneyAction.ACCEPT_BID)).toThrow();
  });

  test('auto-confirm flow: system auto-confirms after timeout', () => {
    let journeyStatus: JourneyStatus = JourneyStatus.AWAITING_CONFIRMATION;

    journeyStatus = transitionJourney(journeyStatus, JourneyAction.AUTO_CONFIRM);
    expect(journeyStatus).toBe(JourneyStatus.COMPLETED);
  });

  test('competing bids: one accepted, others declined or withdrawn', () => {
    // Driver A bids - PENDING
    const bidA = BidStatus.PENDING;
    // Driver B bids - PENDING
    const bidB = BidStatus.PENDING;
    // Driver C bids - PENDING
    const bidC = BidStatus.PENDING;

    // Customer accepts Driver A's bid
    const bidAAccepted = transitionBid(bidA, BidAction.ACCEPT);
    expect(bidAAccepted).toBe(BidStatus.ACCEPTED);

    // System declines Driver B's bid
    const bidBDeclined = transitionBid(bidB, BidAction.DECLINE);
    expect(bidBDeclined).toBe(BidStatus.DECLINED);

    // Driver C withdraws before decline reaches them
    const bidCWithdrawn = transitionBid(bidC, BidAction.WITHDRAW);
    expect(bidCWithdrawn).toBe(BidStatus.WITHDRAWN);

    // None of the terminal bids can transition further
    expect(() => transitionBid(bidAAccepted, BidAction.WITHDRAW)).toThrow();
    expect(() => transitionBid(bidBDeclined, BidAction.ACCEPT)).toThrow();
    expect(() => transitionBid(bidCWithdrawn, BidAction.ACCEPT)).toThrow();
  });
});
