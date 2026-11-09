export type NotificationEventType =
  | 'bid'
  | 'journey'
  | 'message'
  | 'escrow'
  | 'rating'
  | 'admin-conflict'
  // FIELD-FIT G4 — a verification decision deep-links to the driver's
  // documents screen, not to a journey.
  | 'verification';

export interface PushPayloadData {
  type: NotificationEventType;
  journeyId?: string;
  bidId?: string;
  legId?: string;
  conflictType?: string;
  deepLink?: string;
  [k: string]: string | number | undefined;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: PushPayloadData;
}
