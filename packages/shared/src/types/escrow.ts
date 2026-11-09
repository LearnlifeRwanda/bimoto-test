export enum EscrowStatus {
  PENDING = 'PENDING',
  HELD = 'HELD',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
  FROZEN = 'FROZEN',
  FAILED = 'FAILED',
}

export enum EscrowAction {
  CONFIRM_CHARGE = 'CONFIRM_CHARGE',
  FAIL_CHARGE = 'FAIL_CHARGE',
  RELEASE = 'RELEASE',
  REFUND = 'REFUND',
  FREEZE = 'FREEZE',
  // PAY-TRUTH G2 — the customer pays again after a declined charge.
  // FAILED → PENDING, and ONLY from FAILED: the escrow row is reused in
  // place with a fresh txRef (Escrow.journeyId is unique, so a journey
  // can never own a second escrow — reuse is the only recovery there is).
  // Declaring it here makes the reuse a checked transition instead of the
  // raw status write /api/payments/initiate used to do, and makes the
  // "a SETTLED escrow is never rechargeable" guarantee structural: HELD,
  // RELEASED, REFUNDED and FROZEN have no RETRY_CHARGE edge at all.
  RETRY_CHARGE = 'RETRY_CHARGE',
}

export interface Escrow {
  id: string;
  journeyId: string;
  customerId: string;
  driverId: string;
  amount: number;
  commission: number;
  driverPayout: number;
  status: EscrowStatus;
  createdAt: string;
  releasedAt?: string;
}
