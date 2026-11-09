import {
  JourneyStatus, JourneyAction, transitionJourney,
  BidStatus, BidAction, transitionBid, REOPENABLE_BID_STATUSES, reopenedBidStatus,
  EscrowStatus, EscrowAction, transitionEscrow,
} from '@bimoto/shared';

describe('Journey State Machine', () => {
  // --- Valid transitions ---
  test('REQUESTED -> MATCHED via ACCEPT_BID', () => {
    expect(transitionJourney(JourneyStatus.REQUESTED, JourneyAction.ACCEPT_BID))
      .toBe(JourneyStatus.MATCHED);
  });

  test('REQUESTED -> CANCELLED via CANCEL', () => {
    expect(transitionJourney(JourneyStatus.REQUESTED, JourneyAction.CANCEL))
      .toBe(JourneyStatus.CANCELLED);
  });

  test('REQUESTED -> EXPIRED via EXPIRE', () => {
    expect(transitionJourney(JourneyStatus.REQUESTED, JourneyAction.EXPIRE))
      .toBe(JourneyStatus.EXPIRED);
  });

  test('MATCHED -> IN_PROGRESS via START_JOURNEY', () => {
    expect(transitionJourney(JourneyStatus.MATCHED, JourneyAction.START_JOURNEY))
      .toBe(JourneyStatus.IN_PROGRESS);
  });

  test('MATCHED -> CANCELLED via CANCEL', () => {
    expect(transitionJourney(JourneyStatus.MATCHED, JourneyAction.CANCEL))
      .toBe(JourneyStatus.CANCELLED);
  });

  // R3-STALE-NO-SHOW-WIRING-FIX — ADMIN_REFUND now also fires from MATCHED.
  test('MATCHED -> CANCELLED via ADMIN_REFUND', () => {
    expect(transitionJourney(JourneyStatus.MATCHED, JourneyAction.ADMIN_REFUND))
      .toBe(JourneyStatus.CANCELLED);
  });

  test('MATCHED -> EXPIRED via EXPIRE', () => {
    expect(transitionJourney(JourneyStatus.MATCHED, JourneyAction.EXPIRE))
      .toBe(JourneyStatus.EXPIRED);
  });

  test('IN_PROGRESS -> AWAITING_CONFIRMATION via END_JOURNEY', () => {
    expect(transitionJourney(JourneyStatus.IN_PROGRESS, JourneyAction.END_JOURNEY))
      .toBe(JourneyStatus.AWAITING_CONFIRMATION);
  });

  test('IN_PROGRESS -> INTERRUPTED via INTERRUPT', () => {
    expect(transitionJourney(JourneyStatus.IN_PROGRESS, JourneyAction.INTERRUPT))
      .toBe(JourneyStatus.INTERRUPTED);
  });

  test('AWAITING_CONFIRMATION -> COMPLETED via CONFIRM', () => {
    expect(transitionJourney(JourneyStatus.AWAITING_CONFIRMATION, JourneyAction.CONFIRM))
      .toBe(JourneyStatus.COMPLETED);
  });

  test('AWAITING_CONFIRMATION -> COMPLETED via AUTO_CONFIRM', () => {
    expect(transitionJourney(JourneyStatus.AWAITING_CONFIRMATION, JourneyAction.AUTO_CONFIRM))
      .toBe(JourneyStatus.COMPLETED);
  });

  test('AWAITING_CONFIRMATION -> DISPUTED via DISPUTE', () => {
    expect(transitionJourney(JourneyStatus.AWAITING_CONFIRMATION, JourneyAction.DISPUTE))
      .toBe(JourneyStatus.DISPUTED);
  });

  // --- Terminal states reject all actions ---
  test('COMPLETED rejects CANCEL', () => {
    expect(() => transitionJourney(JourneyStatus.COMPLETED, JourneyAction.CANCEL))
      .toThrow('Invalid journey transition');
  });

  test('COMPLETED rejects START_JOURNEY', () => {
    expect(() => transitionJourney(JourneyStatus.COMPLETED, JourneyAction.START_JOURNEY))
      .toThrow('Invalid journey transition');
  });

  test('CANCELLED rejects all actions', () => {
    expect(() => transitionJourney(JourneyStatus.CANCELLED, JourneyAction.ACCEPT_BID))
      .toThrow('Invalid journey transition');
  });

  test('EXPIRED rejects START_JOURNEY', () => {
    expect(() => transitionJourney(JourneyStatus.EXPIRED, JourneyAction.START_JOURNEY))
      .toThrow('Invalid journey transition');
  });

  test('INTERRUPTED rejects END_JOURNEY', () => {
    expect(() => transitionJourney(JourneyStatus.INTERRUPTED, JourneyAction.END_JOURNEY))
      .toThrow('Invalid journey transition');
  });

  test('DISPUTED rejects CONFIRM', () => {
    expect(() => transitionJourney(JourneyStatus.DISPUTED, JourneyAction.CONFIRM))
      .toThrow('Invalid journey transition');
  });

  // R3-RECONCILIATION-WIRING-FIX — DISPUTED gained two admin-resolution exits.
  test('DISPUTED -> CANCELLED via ADMIN_REFUND', () => {
    expect(transitionJourney(JourneyStatus.DISPUTED, JourneyAction.ADMIN_REFUND))
      .toBe(JourneyStatus.CANCELLED);
  });

  test('DISPUTED -> COMPLETED via ADMIN_PAY', () => {
    expect(transitionJourney(JourneyStatus.DISPUTED, JourneyAction.ADMIN_PAY))
      .toBe(JourneyStatus.COMPLETED);
  });

  test('DISPUTED rejects CANCEL (only ADMIN_REFUND/ADMIN_PAY are valid exits)', () => {
    expect(() => transitionJourney(JourneyStatus.DISPUTED, JourneyAction.CANCEL))
      .toThrow('Invalid journey transition');
  });

  // --- Invalid non-terminal transitions ---
  test('REQUESTED cannot START_JOURNEY', () => {
    expect(() => transitionJourney(JourneyStatus.REQUESTED, JourneyAction.START_JOURNEY))
      .toThrow('Invalid journey transition');
  });

  test('MATCHED cannot END_JOURNEY', () => {
    expect(() => transitionJourney(JourneyStatus.MATCHED, JourneyAction.END_JOURNEY))
      .toThrow('Invalid journey transition');
  });

  test('IN_PROGRESS cannot ACCEPT_BID', () => {
    expect(() => transitionJourney(JourneyStatus.IN_PROGRESS, JourneyAction.ACCEPT_BID))
      .toThrow('Invalid journey transition');
  });

  test('AWAITING_CONFIRMATION cannot CANCEL', () => {
    expect(() => transitionJourney(JourneyStatus.AWAITING_CONFIRMATION, JourneyAction.CANCEL))
      .toThrow('Invalid journey transition');
  });
});

describe('Bid State Machine', () => {
  // --- Valid transitions ---
  test('PENDING -> ACCEPTED via ACCEPT', () => {
    expect(transitionBid(BidStatus.PENDING, BidAction.ACCEPT))
      .toBe(BidStatus.ACCEPTED);
  });

  test('PENDING -> DECLINED via DECLINE', () => {
    expect(transitionBid(BidStatus.PENDING, BidAction.DECLINE))
      .toBe(BidStatus.DECLINED);
  });

  test('PENDING -> WITHDRAWN via WITHDRAW', () => {
    expect(transitionBid(BidStatus.PENDING, BidAction.WITHDRAW))
      .toBe(BidStatus.WITHDRAWN);
  });

  test('PENDING -> EXPIRED via EXPIRE', () => {
    expect(transitionBid(BidStatus.PENDING, BidAction.EXPIRE))
      .toBe(BidStatus.EXPIRED);
  });

  // --- Terminal states ---
  test('ACCEPTED rejects WITHDRAW', () => {
    expect(() => transitionBid(BidStatus.ACCEPTED, BidAction.WITHDRAW))
      .toThrow('Invalid bid transition');
  });

  test('DECLINED rejects ACCEPT', () => {
    expect(() => transitionBid(BidStatus.DECLINED, BidAction.ACCEPT))
      .toThrow('Invalid bid transition');
  });

  test('WITHDRAWN rejects ACCEPT', () => {
    expect(() => transitionBid(BidStatus.WITHDRAWN, BidAction.ACCEPT))
      .toThrow('Invalid bid transition');
  });

  test('EXPIRED rejects DECLINE', () => {
    expect(() => transitionBid(BidStatus.EXPIRED, BidAction.DECLINE))
      .toThrow('Invalid bid transition');
  });

  // --- REOPEN: a machine put the journey back on the market ---
  //
  // DOC-GUARD G4. ACCEPTED and DECLINED are no longer dead ends,
  // because a webhook or the unpaid-match reaper can release a failed
  // match and the bids that match closed have to become honest again.
  describe('REOPEN', () => {
    test('DECLINED -> PENDING via REOPEN', () => {
      expect(transitionBid(BidStatus.DECLINED, BidAction.REOPEN))
        .toBe(BidStatus.PENDING);
    });

    test('ACCEPTED -> PENDING via REOPEN — the bid that was lying', () => {
      expect(transitionBid(BidStatus.ACCEPTED, BidAction.REOPEN))
        .toBe(BidStatus.PENDING);
    });

    test('WITHDRAWN rejects REOPEN — the driver pulled out himself', () => {
      expect(() => transitionBid(BidStatus.WITHDRAWN, BidAction.REOPEN))
        .toThrow('Invalid bid transition');
    });

    test('EXPIRED rejects REOPEN — the clock, not the payment, closed it', () => {
      expect(() => transitionBid(BidStatus.EXPIRED, BidAction.REOPEN))
        .toThrow('Invalid bid transition');
    });

    test('PENDING rejects REOPEN — it is already open', () => {
      expect(() => transitionBid(BidStatus.PENDING, BidAction.REOPEN))
        .toThrow('Invalid bid transition');
    });

    // The release path builds its updateMany from these rather than
    // hard-coding a status list beside the machine — which is exactly
    // the drift that produced the stale Accept button.
    test('REOPENABLE_BID_STATUSES is derived from the machine', () => {
      expect([...REOPENABLE_BID_STATUSES].sort()).toEqual(
        [BidStatus.ACCEPTED, BidStatus.DECLINED].sort(),
      );
    });

    test('every reopenable status agrees on one target, so a bulk write is safe', () => {
      expect(reopenedBidStatus()).toBe(BidStatus.PENDING);
      for (const status of REOPENABLE_BID_STATUSES) {
        expect(transitionBid(status, BidAction.REOPEN)).toBe(reopenedBidStatus());
      }
    });
  });
});

describe('Escrow State Machine', () => {
  // --- Valid transitions from HELD ---
  test('HELD -> RELEASED via RELEASE', () => {
    expect(transitionEscrow(EscrowStatus.HELD, EscrowAction.RELEASE))
      .toBe(EscrowStatus.RELEASED);
  });

  test('HELD -> REFUNDED via REFUND', () => {
    expect(transitionEscrow(EscrowStatus.HELD, EscrowAction.REFUND))
      .toBe(EscrowStatus.REFUNDED);
  });

  test('HELD -> FROZEN via FREEZE', () => {
    expect(transitionEscrow(EscrowStatus.HELD, EscrowAction.FREEZE))
      .toBe(EscrowStatus.FROZEN);
  });

  // --- Valid transitions from FROZEN ---
  test('FROZEN -> RELEASED via RELEASE', () => {
    expect(transitionEscrow(EscrowStatus.FROZEN, EscrowAction.RELEASE))
      .toBe(EscrowStatus.RELEASED);
  });

  test('FROZEN -> REFUNDED via REFUND', () => {
    expect(transitionEscrow(EscrowStatus.FROZEN, EscrowAction.REFUND))
      .toBe(EscrowStatus.REFUNDED);
  });

  // --- FROZEN cannot be frozen again ---
  test('FROZEN rejects FREEZE', () => {
    expect(() => transitionEscrow(EscrowStatus.FROZEN, EscrowAction.FREEZE))
      .toThrow('Invalid escrow transition');
  });

  // --- Terminal states ---
  test('RELEASED rejects REFUND', () => {
    expect(() => transitionEscrow(EscrowStatus.RELEASED, EscrowAction.REFUND))
      .toThrow('Invalid escrow transition');
  });

  test('RELEASED rejects RELEASE', () => {
    expect(() => transitionEscrow(EscrowStatus.RELEASED, EscrowAction.RELEASE))
      .toThrow('Invalid escrow transition');
  });

  test('REFUNDED rejects RELEASE', () => {
    expect(() => transitionEscrow(EscrowStatus.REFUNDED, EscrowAction.RELEASE))
      .toThrow('Invalid escrow transition');
  });

  test('REFUNDED rejects FREEZE', () => {
    expect(() => transitionEscrow(EscrowStatus.REFUNDED, EscrowAction.FREEZE))
      .toThrow('Invalid escrow transition');
  });
});
