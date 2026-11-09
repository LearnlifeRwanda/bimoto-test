// EXPORT-AND-LEDGER G1/G2 — the self-serve data export, expanded to the
// table list founder decision D20 ruled in (24 August), and made to STATE
// what it withholds.
//
// Before this module the export was five shapes assembled inline in
// user.routes.ts: profile, driverProfile, journeys, ratings, and the
// messages the subject had SENT. A pilot user downloading their data got
// their rides and half of every conversation, and no word about the rest.
//
// D20 ruled the expansion table by table. Three things are load-bearing
// about the shape below and none of them is incidental:
//
//   1. EVERY QUERY IS SCOPED TO THE SUBJECT. There is no join that walks
//      out to another account's rows; each findMany names the subject's
//      own foreign key. The one apparent exception, the message read, is
//      scoped by the journey ids the subject is a party to — which is
//      the same membership test assertJourneyParticipant makes on the
//      live chat route (message.service.ts:23), derived once here from
//      the journeys already fetched rather than asked again.
//
//   2. WHERE A ROW NAMES SOMEBODY ELSE, THE PROJECTION SAYS SO. A row the
//      subject owns can still carry a second person's identity — the
//      rater who graded them, the admin who held their payout, the ops
//      user who closed their alarm. Those columns are selected OUT, by
//      name, at each site, and the reason is recorded in place. The
//      standing rule this serves: the export may not hand somebody an
//      identity their own app screen never showed them.
//
//   3. THE EXCLUSIONS ARE STATED IN THE FILE. Five investigative tables
//      are withheld (see EXPORT_EXCLUDED_INVESTIGATIVE_TABLES). Silence
//      about them would be the dishonest option — the person would have a
//      file that looks complete. `notice` is that sentence, in the
//      payload, above everything else.

import prisma from '../prisma';
import * as userService from './user.service';

/**
 * The carve-out, in one plain English sentence, shipped INSIDE the export.
 *
 * Locale-independent on purpose: the file is downloaded once and may be
 * read years later, by the person or by whoever they hand it to, on a
 * machine that has no idea what language the app was in. `noticeKey`
 * beside it is how a client that wants to show the same sentence on
 * screen, translated, does so without this string having to move.
 *
 * It names WHAT is withheld, WHY, and WHERE to ask — because a carve-out
 * with no route to the data is a refusal wearing a policy's clothes. It
 * names no support address: the repo has none to name, and inventing one
 * here would be inventing policy (docs/data-retention.md carries that as
 * an open item).
 */
export const DATA_EXPORT_NOTICE =
  'This export contains the records Bimoto holds about you as a rider, a ' +
  'driver, and a party to your own rides. It deliberately leaves out our ' +
  'fraud-prevention and investigation records about this account — ' +
  'anti-money-laundering flags, administrator actions taken about you, ' +
  'name-mismatch checks, driver conflict overrides, and the tombstone kept ' +
  'after an account is deleted. Those are withheld so that a fraud check ' +
  'cannot be read by the person it is about. You can ask for them, and for ' +
  'the reasons behind them, by making a request to Bimoto support.';

/** Render key for the same sentence, for a client that wants it translated. */
export const DATA_EXPORT_NOTICE_KEY = 'deletion.exportNotice';

/**
 * The five tables D20 ruled OUT and the export must never carry under any
 * name. Exported so the guard test can assert absence BY KEY rather than
 * by reading this file's prose.
 */
export const EXPORT_EXCLUDED_INVESTIGATIVE_TABLES = [
  'amlFlags',
  'adminActions',
  'nameMismatchLogs',
  'driverConflictOverrides',
  'accountTombstone',
] as const;

/**
 * Ruled out as noise rather than as carve-out — device plumbing and
 * diagnostics that tell the subject nothing about themselves. Not named in
 * the notice, because there is nothing here anybody is being denied.
 */
export const EXPORT_EXCLUDED_NOISE_TABLES = [
  'deviceTokens',
  'syncEvents',
  'syncRejections',
  'errorReports',
] as const;

export type ExportedMessage = {
  id: string;
  journeyId: string;
  text: string;
  isQuickMessage: boolean;
  quickMessageId: string | null;
  createdAt: Date;
  direction: 'SENT' | 'RECEIVED';
  senderNickname: string | null;
};

export type ExportedRating = {
  id: string;
  journeyId: string;
  direction: 'GIVEN' | 'RECEIVED';
  ratedId?: string;
  stars: number;
  comment: string | null;
  reason: string | null;
  createdAt: Date;
};

/**
 * Assemble the export for one subject.
 *
 * Key order is deliberate and is the order a person reads the file in:
 * the notice first, then who they are, then their rides, then their money
 * in one block, then what was said about and to them, then the safety and
 * process records. JSON.stringify preserves insertion order for string
 * keys, so this is the order that reaches the download.
 */
export async function buildDataExport(userId: string) {
  // CUTGUARD v2 G1/U-3 — the export uses THE SAME allowlist as `/me`, not
  // an export-specific superset.
  //
  // It had to change, because it was contradicting its own notice. The
  // notice above promises that "anti-money-laundering flags,
  // administrator actions taken about you, name-mismatch checks…" are
  // withheld, and D20's five investigative TABLES were indeed carved
  // out — but `profile` is built from `getMe`, whose negative list
  // shipped `isFlagged`, `flagReason` and `disputeRate` INLINE. The
  // fraud verdict was in the file the notice said did not contain it.
  //
  // Why the same list rather than a documented superset: a superset
  // would have to name a field the person may read here but not on their
  // own profile screen, and every candidate is either a credential
  // (`moneyPinHash`, `moneyPinPendingHash`, `phoneHash` — never
  // exportable at any width) or exactly the fraud-prevention record the
  // notice promises is withheld. There is no third category, so there is
  // no superset to justify. `getMe` returning `toClientUser` makes this
  // true by construction rather than by a second list kept in step.
  const profile = await userService.getMe(userId);
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  const journeys = await prisma.journey.findMany({
    where: { OR: [{ customerId: userId }, { driverId: userId }] },
  });

  // The membership set the message read is scoped by. Derived from the
  // journeys already fetched above rather than re-queried: it is the same
  // predicate (customer OR driver), and asking twice is how the two
  // answers drift apart.
  const journeyIds = journeys.map((j) => j.id);

  const bids = await prisma.bid.findMany({
    where: { driverId: userId },
    select: {
      id: true,
      journeyId: true,
      driverId: true,
      price: true,
      etaMinutes: true,
      status: true,
      withdrawnSource: true,
      autoBidRuleId: true,
      createdAt: true,
      updatedAt: true,
      // dispatchedByLeaderId is NOT selected. It names the cooperative
      // leader who placed this bid on the driver's behalf — another
      // person's user id, and one no driver-facing screen in this app
      // renders. Same rule as the rating rater below.
    },
  });

  const escrows = await prisma.escrow.findMany({
    where: { OR: [{ customerId: userId }, { driverId: userId }] },
  });

  const feeWaivers = await prisma.feeWaiver.findMany({
    where: { driverId: userId },
    select: {
      id: true,
      driverId: true,
      type: true,
      campaign: true,
      grantedAt: true,
      expiresAt: true,
      extensionCount: true,
      revokedAt: true,
      reason: true,
      // grantedBy / revokedBy are NOT selected: both are ADMIN user ids.
      // The driver is entitled to know they have a waiver, on what
      // campaign, and when it was granted or withdrawn — not to which
      // member of staff decided it.
    },
  });

  const payoutBatches = await prisma.driverPayoutBatch.findMany({
    where: { driverId: userId },
    select: {
      id: true,
      driverId: true,
      amount: true,
      txRef: true,
      flwTransferId: true,
      status: true,
      trigger: true,
      failureReason: true,
      createdAt: true,
      paidOutAt: true,
      reversedAt: true,
      held: true,
      heldAt: true,
      // heldBy / heldReason are NOT selected. `held` and `heldAt` stay,
      // so a driver whose money is sitting still can SEE that it is being
      // held and since when — but heldBy is an admin identity and
      // heldReason is an admin's note, which is exactly the investigative
      // content D20 carved out.
    },
  });

  const payoutPreferenceChanges = await prisma.payoutPreferenceChangeLog.findMany({
    where: { userId },
  });

  const ratingsGiven = await prisma.rating.findMany({
    where: { raterId: userId },
    select: {
      id: true,
      journeyId: true,
      ratedId: true,
      stars: true,
      comment: true,
      reason: true,
      createdAt: true,
    },
  });

  const ratingsReceived = await prisma.rating.findMany({
    where: { ratedId: userId },
    select: {
      id: true,
      journeyId: true,
      stars: true,
      comment: true,
      reason: true,
      createdAt: true,
      // raterId is NOT selected, and this is a live over-share being
      // closed rather than an expansion detail: the export's rating query
      // used to be a whole-row findMany over
      // `OR: [{ raterId }, { ratedId }]`, so every rating a user RECEIVED
      // shipped the id of whoever gave it. Ratings are anonymous on the
      // rated person's screen; the export was de-anonymising them.
    },
  });

  const ratings: ExportedRating[] = [
    ...ratingsGiven.map((r) => ({ ...r, direction: 'GIVEN' as const })),
    ...ratingsReceived.map((r) => ({ ...r, direction: 'RECEIVED' as const })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // FULL conversations, both sides — D20's ruling, replacing a SENT-only
  // read that gave a person their own half of an argument. Scoped by the
  // journey membership set; ordered by journey then time, so the file
  // reads as conversations rather than as an undifferentiated stream.
  //
  // Index sanity: Message carries @@index([journeyId, createdAt]), which
  // is exactly this query's shape. No new index is needed.
  const rawMessages = journeyIds.length
    ? await prisma.message.findMany({
        where: { journeyId: { in: journeyIds } },
        select: {
          id: true,
          journeyId: true,
          senderId: true,
          text: true,
          isQuickMessage: true,
          quickMessageId: true,
          createdAt: true,
        },
        orderBy: [{ journeyId: 'asc' }, { createdAt: 'asc' }],
      })
    : [];

  // The counterparty becomes the nickname the chat showed, and nothing
  // more. getMessages includes `sender: { id, nickname }`; the id is
  // plumbing the chat screen never renders, so it does not survive into
  // the export — `direction` carries the only thing it was doing for a
  // reader, which is saying who spoke.
  const senderIds = [...new Set(rawMessages.map((m) => m.senderId))];
  const senders = senderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, nickname: true },
      })
    : [];
  const nicknameById = new Map(senders.map((s) => [s.id, s.nickname]));

  const messages: ExportedMessage[] = rawMessages.map((m) => ({
    id: m.id,
    journeyId: m.journeyId,
    text: m.text,
    isQuickMessage: m.isQuickMessage,
    quickMessageId: m.quickMessageId,
    createdAt: m.createdAt,
    direction: m.senderId === userId ? ('SENT' as const) : ('RECEIVED' as const),
    senderNickname: nicknameById.get(m.senderId) ?? null,
  }));

  // The subject's own alarm facts. resolvedById and resolveNote are NOT
  // selected: who in ops closed an alarm, and what they wrote when they
  // did, are the resolver's record and not the caller's. `status` and
  // `resolvedAt` stay, so the person can still see that their alarm was
  // closed and when — including the distinction between a person closing
  // it and the valve expiring it, which is what `status` records.
  const emergencyAlerts = await prisma.emergencyAlert.findMany({
    where: { raisedById: userId },
    select: {
      id: true,
      journeyId: true,
      raisedById: true,
      raisedByRole: true,
      pressLat: true,
      pressLng: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  const rideReports = await prisma.rideReport.findMany({ where: { reporterId: userId } });

  const pickupVerifications = await prisma.pickupVerification.findMany({
    where: { customerId: userId },
  });

  const reconciliationResponses = await prisma.journeyReconciliationResponse.findMany({
    where: { respondingUserId: userId },
  });

  const vehicleChangeLogs = await prisma.vehicleChangeLog.findMany({
    where: { driverId: userId },
  });

  const autoBidRules = await prisma.driverAutoBidRule.findMany({ where: { driverId: userId } });

  // Their own asking. D20 ruled these IN: the export runs on a LIVE
  // account, so a pending or cancelled request is a fact about a person
  // who is still here to read it. (The tombstone is a different row and
  // is carved out — by the time one exists there is no account to export
  // from.)
  const deletionRequests = await prisma.deletionRequest.findMany({ where: { userId } });

  return {
    notice: DATA_EXPORT_NOTICE,
    noticeKey: DATA_EXPORT_NOTICE_KEY,

    profile,
    driverProfile: driverProfile ?? undefined,

    journeys,
    bids,

    escrows,
    feeWaivers,
    payoutBatches,
    payoutPreferenceChanges,

    ratings,
    messages,

    emergencyAlerts,
    rideReports,
    pickupVerifications,
    reconciliationResponses,
    vehicleChangeLogs,
    autoBidRules,
    deletionRequests,
  };
}
