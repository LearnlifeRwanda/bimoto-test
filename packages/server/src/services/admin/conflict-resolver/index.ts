import type { ConflictType } from '@prisma/client';
import { journeyReconciliationModule } from './conflicts/journey-reconciliation';
import { amlAppealModule } from './conflicts/aml-appeal';
import { bidManipulationModule } from './conflicts/bid-manipulation';
import { gpsPlausibilityModule } from './conflicts/gps-plausibility';
import { staleDriverNoShowModule } from './conflicts/stale-driver-no-show';
import { photoMismatchModule } from './conflicts/photo-mismatch';
import { graphAnomalyModule } from './conflicts/graph-anomaly';
import { driverNoShowDisputeModule } from './conflicts/driver-no-show-dispute';
import { recipientDisputeModule } from './conflicts/recipient-dispute';
import { rideReportModule } from './conflicts/ride-report';
import type { ConflictModule } from './types';

export const conflictModuleByType: Record<ConflictType, ConflictModule> = {
  JOURNEY_RECONCILIATION: journeyReconciliationModule,
  AML_APPEAL: amlAppealModule,
  BID_MANIPULATION: bidManipulationModule,
  GPS_PLAUSIBILITY: gpsPlausibilityModule,
  STALE_DRIVER_NO_SHOW: staleDriverNoShowModule,
  PHOTO_MISMATCH: photoMismatchModule,
  GRAPH_ANOMALY: graphAnomalyModule,
  DRIVER_NO_SHOW_DISPUTE: driverNoShowDisputeModule,
  RECIPIENT_DISPUTE: recipientDisputeModule,
  // TEAM-ANSWERS G3 — the tenth type. The registry is a
  // Record<ConflictType, ConflictModule>, so the compiler itself
  // requires this line once the enum grows: adding a type is additive
  // and cannot be half-done.
  RIDE_REPORT: rideReportModule,
};

export const ALL_CONFLICT_TYPES: ReadonlyArray<ConflictType> = [
  'JOURNEY_RECONCILIATION',
  'AML_APPEAL',
  'BID_MANIPULATION',
  'GPS_PLAUSIBILITY',
  'STALE_DRIVER_NO_SHOW',
  'PHOTO_MISMATCH',
  'GRAPH_ANOMALY',
  'DRIVER_NO_SHOW_DISPUTE',
  'RECIPIENT_DISPUTE',
  'RIDE_REPORT',
];

export function isConflictType(value: string): value is ConflictType {
  return (ALL_CONFLICT_TYPES as ReadonlyArray<string>).includes(value);
}

export type {
  ConflictModule,
  ConflictDecisionArgs,
  ConflictListItem,
  ConflictDetail,
} from './types';
