export enum EventType {
  JOURNEY_CREATED = 'JOURNEY_CREATED',
  BID_PLACED = 'BID_PLACED',
  BID_ACCEPTED = 'BID_ACCEPTED',
  BID_DECLINED = 'BID_DECLINED',
  BID_WITHDRAWN = 'BID_WITHDRAWN',
  BID_EXPIRED = 'BID_EXPIRED',
  JOURNEY_STARTED = 'JOURNEY_STARTED',
  JOURNEY_ENDED = 'JOURNEY_ENDED',
  JOURNEY_CONFIRMED = 'JOURNEY_CONFIRMED',
  JOURNEY_CANCELLED = 'JOURNEY_CANCELLED',
  JOURNEY_INTERRUPTED = 'JOURNEY_INTERRUPTED',
  JOURNEY_DISPUTED = 'JOURNEY_DISPUTED',
  JOURNEY_EXPIRED = 'JOURNEY_EXPIRED',
  ESCROW_HELD = 'ESCROW_HELD',
  ESCROW_RELEASED = 'ESCROW_RELEASED',
  ESCROW_REFUNDED = 'ESCROW_REFUNDED',
  ESCROW_FROZEN = 'ESCROW_FROZEN',
  MESSAGE_SENT = 'MESSAGE_SENT',
  GPS_BATCH = 'GPS_BATCH',
  EMERGENCY_ALERT = 'EMERGENCY_ALERT',
  DRIVER_LOCATION = 'DRIVER_LOCATION',
  RATING_SUBMITTED = 'RATING_SUBMITTED',
}

export interface SyncEvent {
  id: string;
  journeyId?: string;
  userId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  serverTimestamp: string;
  clientEventId: string;
}

export interface SyncEventInput {
  clientEventId: string;
  journeyId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  clientTimestamp: string;
}
