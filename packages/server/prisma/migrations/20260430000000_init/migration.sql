-- DB-BASELINE — repaired baseline (init) migration.
--
-- The schema's initial state was historically established with
-- `prisma db push`, not a migration, so the earliest real migration
-- (20260506000000_add_device_token) assumed tables that no migration
-- created. This migration is that missing initial state: the schema as
-- it stood immediately BEFORE 20260506000000, reconstructed by
-- reverse-applying all 25 subsequent migrations to the current
-- schema.prisma and generated with
-- `prisma migrate diff --from-empty --to-schema-datamodel`.
--
-- Faithfulness proof: on an empty PostgreSQL 16, this migration plus
-- the 25 that follow produce a schema with an EMPTY
-- `prisma migrate diff` against `prisma db push` of schema.prisma
-- (columns, constraints and indexes verified identical via
-- information_schema/pg_catalog dumps; the migration path additionally
-- carries the FeeWaiver_one_nonrevoked_per_driver partial unique index
-- that Prisma's schema language cannot express).
--
-- Existing databases that were created via `db push` (e.g. the pilot)
-- must NEVER re-run this migration — see prisma/migrations/README.md
-- for the one-time `prisma migrate resolve --applied` baselining step.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'DRIVER', 'BOTH', 'ADMIN', 'COOPERATIVE_LEADER');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('rw', 'en', 'fr');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BIKE', 'MOTO', 'E_MOTO', 'E_BIKE');

-- CreateEnum
CREATE TYPE "JourneyType" AS ENUM ('PASSENGER', 'GOODS');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('SCHEDULED', 'REQUESTED', 'MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'DISPUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('IMMEDIATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "JourneyRequestMode" AS ENUM ('WAIT_AND_COMPARE', 'NEED_TO_GO');

-- CreateEnum
CREATE TYPE "ReconciliationResponse" AS ENUM ('ARRIVED_SAFELY', 'NEVER_ARRIVED', 'NEED_HELP');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'REFUNDED', 'FROZEN', 'FAILED');

-- CreateEnum
CREATE TYPE "DriverPayoutStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutPreference" AS ENUM ('AT_SHIFT_END', 'TWICE_DAILY', 'DAILY_22H');

-- CreateEnum
CREATE TYPE "PayoutBatchTrigger" AS ENUM ('SCHEDULED_22H', 'SCHEDULED_06', 'SCHEDULED_18', 'SHIFT_END', 'PREFERENCE_CHANGE', 'FALLBACK_24H', 'ADMIN');

-- CreateEnum
CREATE TYPE "AmlFlagType" AS ENUM ('HARD_LIMIT_EXCEEDED', 'SOFT_LIMIT_EXCEEDED', 'DAILY_CUMULATIVE_EXCEEDED', 'VELOCITY_EXCEEDED', 'PAIR_FREQUENCY', 'NEW_ACCOUNT_HIGH_VALUE', 'BURST_SILENCE', 'FAILURE_CLUSTERING', 'PAYOUT_CONCENTRATION', 'COLLUSION_RING', 'MONEY_FUNNEL', 'REPUTATION_RING', 'GEO_ANOMALY', 'SYNC_RATING_ATTACK', 'BID_CYCLE_RING');

-- CreateEnum
CREATE TYPE "AmlFlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AmlFlagStatus" AS ENUM ('OPEN', 'DISMISSED', 'MARKED_FOR_FREEZE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BidAmountMode" AS ENUM ('FLAT', 'PERCENT_OF_FAIR_PRICE');

-- CreateEnum
CREATE TYPE "BnrReportStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsInboundIntent" AS ENUM ('CONFIRM_JOURNEY', 'DISPUTE_JOURNEY', 'CONFIRM_SCHEDULED', 'CANCEL_SCHEDULED', 'ACCEPT_BID', 'DECLINE_BID', 'STATUS_QUERY', 'BALANCE_QUERY', 'HELP', 'STOP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SmsInboundStatus" AS ENUM ('PENDING', 'PROCESSED', 'NO_MATCHING_JOURNEY', 'NO_MATCHING_BID', 'NO_MATCHING_SCHEDULED', 'UNMATCHED_SENDER', 'UNKNOWN_INTENT', 'OPT_OUT_RECORDED', 'ERROR');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('FREEZE_USER', 'UNFREEZE_USER', 'HOLD_PAYOUT', 'RELEASE_PAYOUT', 'RESOLVE_JOURNEY_RECONCILIATION', 'RESOLVE_AML_APPEAL', 'RESOLVE_BID_MANIPULATION', 'RESOLVE_GPS_PLAUSIBILITY', 'RESOLVE_STALE_DRIVER_NO_SHOW', 'RESOLVE_PHOTO_MISMATCH', 'RESOLVE_GRAPH_ANOMALY', 'COOPERATIVE_LEADER_ACTION', 'COOPERATIVE_DISPATCH');

-- CreateEnum
CREATE TYPE "FreezeCategory" AS ENUM ('AML_CRITICAL', 'FRAUD_SUSPECTED', 'SAFETY_CONCERN', 'KYC_PENDING', 'REGULATORY_REQUEST', 'ADMIN_DISCRETION');

-- CreateEnum
CREATE TYPE "ConflictType" AS ENUM ('JOURNEY_RECONCILIATION', 'AML_APPEAL', 'BID_MANIPULATION', 'GPS_PLAUSIBILITY', 'STALE_DRIVER_NO_SHOW', 'PHOTO_MISMATCH', 'GRAPH_ANOMALY');

-- CreateEnum
CREATE TYPE "ConflictDecision" AS ENUM ('RESOLVED_REFUND', 'RESOLVED_PAY', 'RESOLVED_SPLIT', 'UPHOLD_FLAG', 'OVERTURN_FLAG', 'FORCE_COMPLETE', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "MobilityTier" AS ENUM ('DENSE', 'MEDIUM', 'LOW', 'SPARSE');

-- CreateEnum
CREATE TYPE "MobilityAggregateType" AS ENUM ('POINT_DENSITY', 'OD_MATRIX');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'rw',
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "licenseVerified" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContacts" TEXT,
    "completedRides" INTEGER NOT NULL DEFAULT 0,
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "privacyConsentAt" TIMESTAMP(3),
    "privacyConsentVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsAcceptedVersion" TEXT,
    "driverTermsAcceptedAt" TIMESTAMP(3),
    "driverTermsVersion" TEXT,
    "accountDeletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "disputeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "payoutPreference" "PayoutPreference" NOT NULL DEFAULT 'AT_SHIFT_END',
    "completedShifts" INTEGER NOT NULL DEFAULT 0,
    "scheduledCancellationCount" INTEGER NOT NULL DEFAULT 0,
    "customerInitiatedCompletionCount" INTEGER NOT NULL DEFAULT 0,
    "lateCompletionCount" INTEGER NOT NULL DEFAULT 0,
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "frozenReason" TEXT,
    "frozenBy" UUID,
    "frozenCategory" "FreezeCategory",
    "cooperativeId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "registrationPlate" TEXT,
    "vehicleDescription" TEXT NOT NULL,
    "avgRating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "totalRides" INTEGER NOT NULL DEFAULT 0,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "drivingLicenseNumber" TEXT,
    "ruraAuthorizationNumber" TEXT,
    "cooperativeName" TEXT,
    "insuranceConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "drivingLicensePhotoUrl" TEXT,
    "ruraAuthorizationPhotoUrl" TEXT,
    "insurancePhotoUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cooperativeId" TEXT,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "driverId" UUID,
    "type" "JourneyType" NOT NULL DEFAULT 'PASSENGER',
    "status" "JourneyStatus" NOT NULL DEFAULT 'REQUESTED',
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupName" TEXT NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "destinationName" TEXT NOT NULL,
    "vehiclePreference" "VehicleType",
    "wishPrice" INTEGER,
    "agreedPrice" INTEGER,
    "commissionAmount" INTEGER,
    "estimatedDistance" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "goodsDescription" TEXT,
    "goodsSizeCategory" TEXT,
    "goodsFragile" BOOLEAN NOT NULL DEFAULT false,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "pickupPhotoUrl" TEXT,
    "deliveryPhotoUrl" TEXT,
    "bookingMode" "BookingMode" NOT NULL DEFAULT 'IMMEDIATE',
    "scheduledFor" TIMESTAMP(3),
    "bidWindowOpensAt" TIMESTAMP(3),
    "autoFallbackAt" TIMESTAMP(3),
    "lastReminderSentAt" TIMESTAMP(3),
    "discoveryStartedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "requestMode" "JourneyRequestMode" NOT NULL DEFAULT 'WAIT_AND_COMPARE',
    "priceCeilingMultiplier" DOUBLE PRECISION,
    "priceCeilingRwf" INTEGER,
    "suggestUpCount" INTEGER NOT NULL DEFAULT 0,
    "lateCompletion" BOOLEAN DEFAULT false,
    "customerInitiatedCompletion" BOOLEAN DEFAULT false,
    "staleDetectedAt" TIMESTAMP(3),
    "reconciliationOpenedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyReconciliationResponse" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "respondingUserId" UUID NOT NULL,
    "response" "ReconciliationResponse" NOT NULL,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyReconciliationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverConflictOverride" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "scheduledRideId" UUID NOT NULL,
    "conflictingRideId" UUID NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNotes" TEXT,

    CONSTRAINT "DriverConflictOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "price" INTEGER NOT NULL,
    "etaMinutes" INTEGER NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "autoBidRuleId" UUID,
    "dispatchedByLeaderId" UUID,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAutoBidRule" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxPickupDistanceM" INTEGER NOT NULL,
    "maxRideDistanceM" INTEGER NOT NULL,
    "vehicleTypeFilter" TEXT,
    "bidAmountMode" "BidAmountMode" NOT NULL DEFAULT 'FLAT',
    "bidAmountValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverAutoBidRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escrow" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "driverPayout" INTEGER NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "driverTier" TEXT,
    "customerTier" TEXT,
    "driverCommissionRate" DOUBLE PRECISION,
    "customerCommissionRate" DOUBLE PRECISION,
    "txRef" TEXT,
    "flwTxId" TEXT,
    "lastChargeAttemptAt" TIMESTAMP(3),

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverBalance" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "pendingAmount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverPayoutBatch" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "txRef" TEXT,
    "flwTransferId" TEXT,
    "status" "DriverPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "PayoutBatchTrigger" NOT NULL DEFAULT 'SCHEDULED_22H',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidOutAt" TIMESTAMP(3),
    "held" BOOLEAN NOT NULL DEFAULT false,
    "heldAt" TIMESTAMP(3),
    "heldBy" UUID,
    "heldReason" TEXT,

    CONSTRAINT "DriverPayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutPreferenceChangeLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "oldPreference" "PayoutPreference" NOT NULL,
    "newPreference" "PayoutPreference" NOT NULL,
    "ipAddress" TEXT,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "payoutFired" BOOLEAN NOT NULL DEFAULT false,
    "payoutDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutPreferenceChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NameMismatchLog" (
    "id" UUID NOT NULL,
    "escrowId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "walletNameOnReceipt" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "txRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameMismatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowAuditLog" (
    "id" UUID NOT NULL,
    "escrowId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsPoint" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "isQuickMessage" BOOLEAN NOT NULL DEFAULT false,
    "quickMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "raterId" UUID NOT NULL,
    "ratedId" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" UUID NOT NULL,
    "journeyId" UUID,
    "userId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientEventId" TEXT NOT NULL,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "userId" UUID,
    "purpose" TEXT,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlFlag" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "journeyId" UUID,
    "escrowId" UUID,
    "type" "AmlFlagType" NOT NULL,
    "severity" "AmlFlagSeverity" NOT NULL,
    "status" "AmlFlagStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,
    "resolutionNotes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AmlFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BnrReport" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "BnrReportStatus" NOT NULL DEFAULT 'PENDING',
    "generatedAt" TIMESTAMP(3),
    "generatedBy" TEXT,
    "pdfPath" TEXT,
    "csvPath" TEXT,
    "pdfBytes" INTEGER,
    "csvBytes" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BnrReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsInbound" (
    "id" TEXT NOT NULL,
    "atMessageId" TEXT NOT NULL,
    "fromMsisdn" TEXT NOT NULL,
    "toShortcode" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "intent" "SmsInboundIntent" NOT NULL DEFAULT 'UNKNOWN',
    "status" "SmsInboundStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedEntityId" TEXT,
    "replyBody" TEXT,
    "replySentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SmsInbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" UUID NOT NULL,
    "action" "AdminActionType" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "conflictType" "ConflictType",
    "conflictDecision" "ConflictDecision",
    "prevHash" TEXT NOT NULL DEFAULT '',
    "entryHash" TEXT NOT NULL,
    "crossLinkedEscrowAuditLogId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooperative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "leaderId" UUID,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooperative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilityAggregate" (
    "id" TEXT NOT NULL,
    "tier" "MobilityTier" NOT NULL,
    "aggregateType" "MobilityAggregateType" NOT NULL,
    "cellId" TEXT NOT NULL,
    "cellCenterLat" DOUBLE PRECISION NOT NULL,
    "cellCenterLng" DOUBLE PRECISION NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketEnd" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "attributesJson" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilityAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "User_phoneHash_idx" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "User_smsOptOut_idx" ON "User"("smsOptOut");

-- CreateIndex
CREATE INDEX "User_frozenAt_idx" ON "User"("frozenAt");

-- CreateIndex
CREATE INDEX "User_cooperativeId_idx" ON "User"("cooperativeId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE INDEX "DriverProfile_isOnline_idx" ON "DriverProfile"("isOnline");

-- CreateIndex
CREATE INDEX "DriverProfile_cooperativeId_idx" ON "DriverProfile"("cooperativeId");

-- CreateIndex
CREATE INDEX "Journey_status_idx" ON "Journey"("status");

-- CreateIndex
CREATE INDEX "Journey_customerId_idx" ON "Journey"("customerId");

-- CreateIndex
CREATE INDEX "Journey_driverId_idx" ON "Journey"("driverId");

-- CreateIndex
CREATE INDEX "Journey_createdAt_idx" ON "Journey"("createdAt");

-- CreateIndex
CREATE INDEX "Journey_status_bidWindowOpensAt_idx" ON "Journey"("status", "bidWindowOpensAt");

-- CreateIndex
CREATE INDEX "Journey_status_autoFallbackAt_idx" ON "Journey"("status", "autoFallbackAt");

-- CreateIndex
CREATE INDEX "Journey_status_dueAt_idx" ON "Journey"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Journey_discoveryStartedAt_idx" ON "Journey"("discoveryStartedAt");

-- CreateIndex
CREATE INDEX "Journey_requestMode_idx" ON "Journey"("requestMode");

-- CreateIndex
CREATE INDEX "JourneyReconciliationResponse_journeyId_idx" ON "JourneyReconciliationResponse"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyReconciliationResponse_journeyId_respondingUserId_key" ON "JourneyReconciliationResponse"("journeyId", "respondingUserId");

-- CreateIndex
CREATE INDEX "DriverConflictOverride_driverId_overriddenAt_idx" ON "DriverConflictOverride"("driverId", "overriddenAt");

-- CreateIndex
CREATE INDEX "DriverConflictOverride_scheduledRideId_idx" ON "DriverConflictOverride"("scheduledRideId");

-- CreateIndex
CREATE INDEX "Bid_journeyId_idx" ON "Bid"("journeyId");

-- CreateIndex
CREATE INDEX "Bid_driverId_idx" ON "Bid"("driverId");

-- CreateIndex
CREATE INDEX "Bid_autoBidRuleId_idx" ON "Bid"("autoBidRuleId");

-- CreateIndex
CREATE INDEX "Bid_dispatchedByLeaderId_idx" ON "Bid"("dispatchedByLeaderId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_journeyId_driverId_key" ON "Bid"("journeyId", "driverId");

-- CreateIndex
CREATE INDEX "DriverAutoBidRule_driverId_enabled_idx" ON "DriverAutoBidRule"("driverId", "enabled");

-- CreateIndex
CREATE INDEX "DriverAutoBidRule_enabled_idx" ON "DriverAutoBidRule"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DriverAutoBidRule_driverId_priority_key" ON "DriverAutoBidRule"("driverId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_journeyId_key" ON "Escrow"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_txRef_key" ON "Escrow"("txRef");

-- CreateIndex
CREATE INDEX "Escrow_status_idx" ON "Escrow"("status");

-- CreateIndex
CREATE INDEX "Escrow_status_createdAt_idx" ON "Escrow"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverBalance_driverId_key" ON "DriverBalance"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayoutBatch_txRef_key" ON "DriverPayoutBatch"("txRef");

-- CreateIndex
CREATE INDEX "DriverPayoutBatch_driverId_status_idx" ON "DriverPayoutBatch"("driverId", "status");

-- CreateIndex
CREATE INDEX "DriverPayoutBatch_createdAt_idx" ON "DriverPayoutBatch"("createdAt");

-- CreateIndex
CREATE INDEX "DriverPayoutBatch_held_idx" ON "DriverPayoutBatch"("held");

-- CreateIndex
CREATE INDEX "PayoutPreferenceChangeLog_userId_createdAt_idx" ON "PayoutPreferenceChangeLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutPreferenceChangeLog_payoutFired_payoutDueAt_idx" ON "PayoutPreferenceChangeLog"("payoutFired", "payoutDueAt");

-- CreateIndex
CREATE INDEX "NameMismatchLog_createdAt_idx" ON "NameMismatchLog"("createdAt");

-- CreateIndex
CREATE INDEX "NameMismatchLog_customerId_idx" ON "NameMismatchLog"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowAuditLog_entryHash_key" ON "EscrowAuditLog"("entryHash");

-- CreateIndex
CREATE INDEX "EscrowAuditLog_escrowId_sequenceNumber_idx" ON "EscrowAuditLog"("escrowId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "GpsPoint_journeyId_timestamp_idx" ON "GpsPoint"("journeyId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_journeyId_createdAt_idx" ON "Message"("journeyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_journeyId_raterId_key" ON "Rating"("journeyId", "raterId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_clientEventId_key" ON "SyncEvent"("clientEventId");

-- CreateIndex
CREATE INDEX "SyncEvent_journeyId_clientTimestamp_idx" ON "SyncEvent"("journeyId", "clientTimestamp");

-- CreateIndex
CREATE INDEX "SyncEvent_userId_serverTimestamp_idx" ON "SyncEvent"("userId", "serverTimestamp");

-- CreateIndex
CREATE INDEX "OtpCode_phoneHash_code_idx" ON "OtpCode"("phoneHash", "code");

-- CreateIndex
CREATE INDEX "OtpCode_userId_purpose_used_idx" ON "OtpCode"("userId", "purpose", "used");

-- CreateIndex
CREATE INDEX "AmlFlag_userId_detectedAt_idx" ON "AmlFlag"("userId", "detectedAt");

-- CreateIndex
CREATE INDEX "AmlFlag_status_severity_idx" ON "AmlFlag"("status", "severity");

-- CreateIndex
CREATE INDEX "AmlFlag_type_detectedAt_idx" ON "AmlFlag"("type", "detectedAt");

-- CreateIndex
CREATE INDEX "BnrReport_period_idx" ON "BnrReport"("period");

-- CreateIndex
CREATE INDEX "BnrReport_status_idx" ON "BnrReport"("status");

-- CreateIndex
CREATE INDEX "BnrReport_createdAt_idx" ON "BnrReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsInbound_atMessageId_key" ON "SmsInbound"("atMessageId");

-- CreateIndex
CREATE INDEX "SmsInbound_fromMsisdn_idx" ON "SmsInbound"("fromMsisdn");

-- CreateIndex
CREATE INDEX "SmsInbound_receivedAt_idx" ON "SmsInbound"("receivedAt");

-- CreateIndex
CREATE INDEX "SmsInbound_status_idx" ON "SmsInbound"("status");

-- CreateIndex
CREATE INDEX "SmsInbound_userId_idx" ON "SmsInbound"("userId");

-- CreateIndex
CREATE INDEX "AdminAction_adminId_idx" ON "AdminAction"("adminId");

-- CreateIndex
CREATE INDEX "AdminAction_action_idx" ON "AdminAction"("action");

-- CreateIndex
CREATE INDEX "AdminAction_targetType_targetId_idx" ON "AdminAction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAction_conflictType_idx" ON "AdminAction"("conflictType");

-- CreateIndex
CREATE INDEX "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cooperative_name_key" ON "Cooperative"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Cooperative_leaderId_key" ON "Cooperative"("leaderId");

-- CreateIndex
CREATE INDEX "Cooperative_leaderId_idx" ON "Cooperative"("leaderId");

-- CreateIndex
CREATE INDEX "Cooperative_active_idx" ON "Cooperative"("active");

-- CreateIndex
CREATE INDEX "Cooperative_name_idx" ON "Cooperative"("name");

-- CreateIndex
CREATE INDEX "MobilityAggregate_tier_bucketStart_idx" ON "MobilityAggregate"("tier", "bucketStart");

-- CreateIndex
CREATE INDEX "MobilityAggregate_aggregateType_idx" ON "MobilityAggregate"("aggregateType");

-- CreateIndex
CREATE INDEX "MobilityAggregate_cellId_idx" ON "MobilityAggregate"("cellId");

-- CreateIndex
CREATE INDEX "MobilityAggregate_bucketStart_idx" ON "MobilityAggregate"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "MobilityAggregate_tier_aggregateType_cellId_bucketStart_key" ON "MobilityAggregate"("tier", "aggregateType", "cellId", "bucketStart");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyReconciliationResponse" ADD CONSTRAINT "JourneyReconciliationResponse_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyReconciliationResponse" ADD CONSTRAINT "JourneyReconciliationResponse_respondingUserId_fkey" FOREIGN KEY ("respondingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverConflictOverride" ADD CONSTRAINT "DriverConflictOverride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_autoBidRuleId_fkey" FOREIGN KEY ("autoBidRuleId") REFERENCES "DriverAutoBidRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_dispatchedByLeaderId_fkey" FOREIGN KEY ("dispatchedByLeaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAutoBidRule" ADD CONSTRAINT "DriverAutoBidRule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutPreferenceChangeLog" ADD CONSTRAINT "PayoutPreferenceChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameMismatchLog" ADD CONSTRAINT "NameMismatchLog_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowAuditLog" ADD CONSTRAINT "EscrowAuditLog_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPoint" ADD CONSTRAINT "GpsPoint_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_ratedId_fkey" FOREIGN KEY ("ratedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlFlag" ADD CONSTRAINT "AmlFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlFlag" ADD CONSTRAINT "AmlFlag_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlFlag" ADD CONSTRAINT "AmlFlag_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInbound" ADD CONSTRAINT "SmsInbound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cooperative" ADD CONSTRAINT "Cooperative_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

