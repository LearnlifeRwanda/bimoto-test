export const SyncRejectionCodes = [
  'FK_VIOLATION',
  'DUPLICATE_EVENT_ID',
  'VALIDATION_ERROR',
  'STALE_TIMESTAMP',
  'PERMISSION_DENIED',
  'UNKNOWN',
] as const;

export type SyncRejectionCode = typeof SyncRejectionCodes[number];

export interface SyncRejection {
  clientEventId: string;
  code: SyncRejectionCode;
  message: string;
  serverState?: Record<string, unknown>;
}

export interface SyncUploadResponse {
  processed: string[];
  rejected: SyncRejection[];
}
