-- R3-CONFLICTS-RECIPIENT-DISPUTE — admin review surface for recipient-flagged
-- delivery problems. Closes the operational loop on R3-RECIPIENT-CONFIRM-2:
-- recipients SMS-reply "WRONG ITEM" / "DAMAGED" → Leg.recipientConfirmStatus
-- = DISPUTED → now surfaced in the admin conflicts dashboard.
--
-- Two additive enum changes:
--   1. ConflictType.RECIPIENT_DISPUTE — 9th conflict-type value, registered
--      with the new recipient-dispute conflict-resolver module.
--   2. AdminActionType.RESOLVE_RECIPIENT_DISPUTE — paired audit-action value
--      emitted by the module's decide() path. Maintains hash-chain integrity
--      across the existing 8 conflict types' audit trail.
--
-- 0 INSERT statements per the data-layer additive-only invariant.

-- AlterEnum: ConflictType
ALTER TYPE "ConflictType" ADD VALUE 'RECIPIENT_DISPUTE' AFTER 'DRIVER_NO_SHOW_DISPUTE';

-- AlterEnum: AdminActionType
ALTER TYPE "AdminActionType" ADD VALUE 'RESOLVE_RECIPIENT_DISPUTE' AFTER 'RESOLVE_DRIVER_NO_SHOW_DISPUTE';
