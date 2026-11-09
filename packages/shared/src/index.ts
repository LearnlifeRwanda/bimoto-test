// Types
export * from './types/user.js';
export * from './types/journey.js';
export * from './types/bid.js';
export * from './types/escrow.js';
export * from './types/message.js';
export * from './types/rating.js';
export * from './types/ride-report.js';
export * from './types/event.js';
export * from './types/location.js';
export * from './types/sync-rejection.js';
export * from './types/leg.js';
export type { ApproachStatus, EtaResponse } from './types/approach-status.js';
export { DEFERRAL_REASONS } from './types/account-deletion.js';
export type { DeferralReason } from './types/account-deletion.js';

// State machines
export { transitionJourney } from './state-machine/journey-sm.js';
export {
  transitionBid,
  REOPENABLE_BID_STATUSES,
  reopenedBidStatus,
} from './state-machine/bid-sm.js';
export { transitionEscrow } from './state-machine/escrow-sm.js';

// Constants
export * from './constants/config.js';
export * from './constants/time.js';
export * from './constants/tiers.js';
export * from './constants/map-regions.js';
export * from './constants/admin.js';
export * from './constants/funnel.js';
export { KIGALI_LANDMARKS, UNVERIFIED_LANDMARKS, KIGALI_CENTER } from './constants/locations.js';
export type { Landmark, UnverifiedLandmark, LandmarkCategory } from './constants/locations.js';
export { QUICK_MESSAGES } from './constants/quick-messages.js';
export type { QuickMessage } from './constants/quick-messages.js';
export { SOCKET_EVENTS } from './constants/socket-events.js';
export type {
  SocketEventName,
  JourneyAvailableEvent,
  JourneyWishPriceUpdatedEvent,
  AccountFrozenEvent,
  AutoBidFiredEvent,
  EmergencyAlertEvent,
  EmergencyEndedEvent,
  EmergencyLocationFrame,
  EmergencyLocationUpdateEvent,
  // NOTIFY G3 — the six in-app notification payloads.
  EscrowReleasedEvent,
  EscrowRefundedEvent,
  RatingReceivedEvent,
  VerificationDecidedEvent,
  NoShowWarningEvent,
  DisputeResolvedEvent,
  // COUNTER-READY G2 — the three counter-offer payloads.
  BidCounteredEvent,
  CounterAcceptedEvent,
  CounterDeclinedEvent,
} from './constants/socket-events.js';
export {
  VEHICLE_COMPLIANCE,
  getVehicleCompliance,
  checkDriverCompliance,
} from './constants/vehicle-compliance.js';
export type { VehicleComplianceConfig } from './constants/vehicle-compliance.js';
export {
  estimateTripMinutesRange,
  COMPARABLE_VEHICLE_TYPES,
} from './constants/trip-estimate.js';
export type { TripMinutesRange } from './constants/trip-estimate.js';
export {
  VEHICLE_FARE_MULTIPLIER,
  vehicleFareMultiplier,
} from './constants/vehicle-fare.js';

// Schemas
export {
  requestOtpSchema,
  verifyOtpSchema,
} from './schemas/auth.schema.js';
export type { RequestOtpInput, VerifyOtpInput } from './schemas/auth.schema.js';

export {
  createJourneySchema,
  journeyQuerySchema,
  cancelJourneySchema,
  legInputSchema,
  CANCEL_REASONS,
  OUTSIDE_OPERATION_AREA_KEY,
} from './schemas/journey.schema.js';
export type {
  CreateJourneyInput,
  JourneyQueryInput,
  CancelJourneyInput,
  CancelReasonClient,
  LegInputSchema,
} from './schemas/journey.schema.js';
export { BookingMode } from './types/journey.js';

// FIELD-FIT G5 — the team's own parcel-weight rules, settled 11 August.
export {
  PARCEL_WEIGHT_RULES,
  MOTO_ALONE_MAX_SIZE_CATEGORY,
  ENFORCE_MOTO_ALONE_SIZE_RULE,
  isBicycle,
  isCarryingPassenger,
  getParcelAllowance,
  validateParcelLoad,
} from './constants/parcel-weight.js';
export type {
  GoodsSizeCategory,
  ParcelAllowance,
  ParcelLoadRefusal,
  ParcelLoadResult,
} from './constants/parcel-weight.js';

export {
  createBidSchema,
  acceptBidSchema,
  acceptBidForCardSchema,
  counterBidSchema,
  counterRespondSchema,
} from './schemas/bid.schema.js';
export type {
  CreateBidInput,
  AcceptBidInput,
  AcceptBidForCardInput,
  CounterBidInput,
  CounterRespondInput,
} from './schemas/bid.schema.js';

export {
  createMessageSchema,
} from './schemas/message.schema.js';
export type { CreateMessageInput } from './schemas/message.schema.js';

export {
  createRatingSchema,
} from './schemas/rating.schema.js';
export type { CreateRatingInput } from './schemas/rating.schema.js';
export { createRideReportSchema } from './schemas/ride-report.schema.js';
export type { CreateRideReportInput } from './schemas/ride-report.schema.js';

export {
  PICKUP_OUTCOMES,
  PICKUP_MISMATCH_REASONS,
  createPickupVerificationSchema,
} from './schemas/pickup-verification.schema.js';
export type {
  PickupOutcomeValue,
  PickupMismatchReason,
  CreatePickupVerificationInput,
} from './schemas/pickup-verification.schema.js';

export {
  syncEventInputSchema,
  syncUploadSchema,
  syncRejectionSchema,
  syncUploadResponseSchema,
  gpsBatchSchema,
} from './schemas/sync.schema.js';
export type {
  SyncEventInputSchema,
  SyncUploadInput,
  GpsBatchInput,
  GpsPoint,
} from './schemas/sync.schema.js';

// VALIDATE-MEND G2 — the emergency-contact rule, shared so the client's
// inline check and the server's validate() can never disagree.
export {
  updateMeSchema,
  emergencyContactSchema,
  emergencyContactsSchema,
  normaliseEmergencyContact,
  isValidEmergencyContact,
  INVALID_EMERGENCY_CONTACT_KEY,
} from './schemas/user.schema.js';
export type { UpdateMeInput } from './schemas/user.schema.js';

export { screenerSubmissionSchema } from './schemas/screener.schema.js';
export type { ScreenerSubmissionInput } from './schemas/screener.schema.js';

// Screener catalogue + pure eligibility fn — shared between server and client.
export {
  SCREENER_QUESTIONS,
  SCREENER_QUESTION_COUNT,
} from './screener/questions.js';
export type {
  ScreenerQuestion,
  ScreenerQuestionKind,
  BooleanQuestion,
  EnumQuestion,
  IntegerQuestion,
  OptionalFkQuestion,
  BooleanWithOptionalIntQuestion,
} from './screener/questions.js';
export {
  evaluateEligibility,
  SCREENER_MIN_WEEKLY_AVAILABILITY_HOURS,
} from './screener/eligibility.js';
export type {
  ScreenerAnswers,
  ScreenerSubmission,
  ScreenerEligibilityResult,
  ScreenerEligibilityOutcome,
  ScreenerIneligibilityReason,
  ScreenerLicenceStatus,
  ScreenerRuraStatus,
  ScreenerSubmissionResponse,
} from './screener/types.js';

// Diagnostics
export {
  errorFingerprint,
  normaliseErrorMessage,
  normaliseTopFrame,
} from './diagnostics/fingerprint.js';
export type { FingerprintInput } from './diagnostics/fingerprint.js';

// Translations
export { NOTIFICATION_STRINGS } from './translations/notifications.js';
export type {
  NotificationEventKey,
  NotificationStrings,
} from './translations/notifications.js';
