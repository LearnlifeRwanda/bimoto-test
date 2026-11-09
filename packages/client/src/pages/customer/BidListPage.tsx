import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAuthStore } from '../../stores/auth.store';
import { useBidStore } from '../../stores/bid.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { useSimulationStore } from '../../stores/simulation.store';
import {
  chargeWithCard,
  retryMomoCharge,
  fetchEscrowStatus,
  PaymentRetryError,
} from '../../services/payment';
import { formatScheduledDateTime } from '../../lib/scheduled';
import { getDriverRatingInfo } from '../../lib/driver-rating';
import { DriverRatingSummary } from '../../components/rating/DriverRatingSummary';
import {
  hasCustomerSafeCommission,
  type WireCommissionBreakdown,
} from '../../lib/commission-view';
import { apiFetch, apiErrorFromResponse, ApiError } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useSocket } from '../../hooks/useSocket';
import { getVehicleCompliance, MIN_PRICE_RWF, MAX_PRICE_RWF } from '@bimoto/shared';


type SortKey = 'price' | 'rating' | 'eta';
type SortDir = 'asc' | 'desc';

// MATCH-CLOSE G2 — bounded polling fallback for the bid list.
//
// The socket is the primary transport (see useSocket(journeyId) below).
// Polling exists because a pilot in Kigali runs on phones that lose the
// socket in a stairwell, and because a room join that fails silently
// would otherwise be invisible — the exact class of severed wiring this
// project has been bitten by before. 10s is the same order as the
// driver dashboard's 15s location tick (DashboardPage
// LOCATION_UPDATE_INTERVAL), costs ~6 small JSON reads a minute, and
// bounds worst-case staleness to ten seconds — instant next to the
// human timescale of a motari deciding to bid.
//
// It is bounded three ways: it runs only while the journey is still
// REQUESTED (a matched, cancelled or expired journey stops it, and the
// server expires journeys after JOURNEY_EXPIRY_MINUTES), it pauses
// while the tab is hidden, and it stops on unmount.
//
// LIVE-WIRE G2 — adaptive, not flat.
//
// The measurement (docs/live-wire-measurements.md) showed the socket
// delivering a bid in p50 15 ms, so on a healthy connection this loop is
// pure insurance. On a phone that has lost the socket it is the ONLY
// path, and ten seconds is the whole of what the passenger experiences.
// So the interval now follows what the screen is waiting for:
//
//   ACTIVE  (4 s) — a request is open and bids can still arrive. This is
//                   the moment the field complained about, and it is
//                   bounded: a request lives minutes, not hours.
//   RELAXED (15 s) — nothing is pending on this screen.
//
// The fallback is never disabled — not when the socket is up, not ever.
// Field networks are the reason it exists, and a socket that reports
// itself connected while silently delivering nothing is exactly the
// failure this page was built to survive.
const BID_POLL_ACTIVE_MS = 4_000;
const BID_POLL_RELAXED_MS = 15_000;

// Consecutive failed polls before the screen admits the connection is
// gone. Two ticks ≈ 20s: long enough that one dropped request on a
// moving moto does not cry wolf, short enough that a passenger is never
// left staring at a lie. The socket dropping ALONE is deliberately not
// surfaced — while polling still succeeds the passenger is not blind,
// so saying "connection lost" would be noise.
const POLL_FAILURES_BEFORE_OFFLINE = 2;

// Journey statuses in which bids can still arrive. Anything else ends
// the live loop.
const OPEN_FOR_BIDS = 'REQUESTED';

// PAY-TRUTH G3 — the gateway's reason, in words a passenger would use.
//
// The server hands back the FLW error code (`detail` on the 502, or
// `paymentFailureCode` on the accept-bid response). One generic "payment
// failed" for insufficient funds, a wrong wallet number and a gateway
// outage alike tells the customer nothing they can act on — and what they
// can act on is the whole point of the retry.
const FAILURE_COPY_KEY: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'payment.reason.insufficientFunds',
  INVALID_WALLET: 'payment.reason.invalidWallet',
  VALIDATION_ERROR: 'payment.reason.declined',
  TIMEOUT: 'payment.reason.timeout',
  GATEWAY_DOWN: 'payment.reason.gatewayDown',
  NETWORK_ERROR: 'payment.reason.gatewayDown',
  NOT_FOUND: 'payment.reason.declined',
  VERIFICATION_FAILED: 'payment.reason.declined',
  AMOUNT_MISMATCH: 'payment.reason.declined',
  TXID_MISMATCH: 'payment.reason.declined',
  UNKNOWN: 'payment.reason.unknown',
};

function failureCopyKey(code: string | null | undefined): string {
  return (code && FAILURE_COPY_KEY[code]) || 'payment.reason.unknown';
}

/** The escrow the retry surface acts on, and why it is showing.
 *
 * MONEY-VIEW v2 — `txRef` is GONE from this state, and it was already
 * dead: written three times and read nowhere. `handleSwitchToCard`, the
 * only consumer that needs a reference, deliberately re-reads it from
 * `GET /api/payments/:escrowId/status` immediately before opening the
 * widget ("never taken from page state", below), because every MoMo
 * retry mints a fresh one and page state is stale by construction. G1
 * removed `txRef` from the customer's escrow view, so the write at the
 * journey-load site was about to become a read of a field that no longer
 * exists — a dead read of a removed field, which is the class this
 * dispatch is closing, not one to leave behind. */
type PaymentFailure = {
  escrowId: string;
  amount: number;
  code: string | null;
  /** A USSD push is out; the customer is waiting on their handset. */
  awaitingPush?: boolean;
};

export const BidListPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { bids, setBids } = useBidStore();
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { showToast } = useUIStore();
  // PREPROTO-SIM G4 — in simulated mode the card option disappears (the
  // Flutterwave Inline widget cannot be simulated client-side) and the
  // MoMo path is relabelled "Pay (simulated)"; the request flow itself is
  // the unchanged /accept-bid MoMo path — the server fakes only the gateway.
  const paymentsSimulated = useSimulationStore((s) => s.paymentsMode === 'simulated');
  // COUNTER-READY G3 — false unless the server said otherwise on this
  // app start. Every counter element on this screen hangs off it, so a
  // dormant server renders NOTHING: no button, no entry, no state line.
  const counterBidEnabled = useSimulationStore((s) => s.counterBidEnabled);
  // PAY-TRUTH G4 — the card option is offered wherever the widget can
  // ACTUALLY be driven, and hidden where it cannot.
  //
  // PREPROTO-SIM G4 hid it in simulated mode because the Flutterwave
  // Inline widget cannot be simulated client-side. That is no longer
  // true: simulated mode now opens the in-app simulated checkout
  // (services/simulated-card-widget.ts) through the same chargeWithCard
  // code path, so the card rail is exercisable in Kigali before it ever
  // meets a real card.
  //
  // What IS hidden now is the case that genuinely cannot work: a live
  // build with no VITE_FLW_PUBLIC_KEY baked in. That used to be offered
  // and then fail with CARD_WIDGET_NO_PUBLIC_KEY — an option that could
  // never have worked, presented to a customer with money in hand.
  const cardHidden = !paymentsSimulated && !import.meta.env.VITE_FLW_PUBLIC_KEY;

  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [isLoading, setIsLoading] = useState(true);
  // NET-UX G3 — a failed load must not look like 'waiting for drivers'.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
  // TEAM-ANSWERS G4 (item 16a) — the passenger can say no to one offer.
  const [decliningBidId, setDecliningBidId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'momo' | 'card'>('momo');
  const [confirmBid, setConfirmBid] = useState<{ id: string; price: number; driverName: string; etaMinutes: number; commissionBreakdown?: WireCommissionBreakdown } | null>(null);
  // PAY-TRUTH G3 — the retry surface's state. Non-null means the charge
  // for this journey failed and the customer is being offered a way
  // forward on the screen where it happened.
  const [paymentFailure, setPaymentFailure] = useState<PaymentFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  // SCHED-UI G3 — scheduled-ride double-booking soft-block. When
  // accept-bid returns { matched: false, conflictWarning } the customer
  // chooses: dismiss (pick another driver) or accept anyway, which
  // retries the SAME accept endpoint exactly once with
  // acknowledgeConflict: true. (The server's retryUrl points at the
  // driver-only conflict-acknowledge route, which a customer cannot
  // call; accept-bid's acknowledgeConflict flag runs the identical
  // server path.)
  // COUNTER-READY G3 — the counter entry, open on ONE bid at a time.
  //
  // Non-null means the passenger is suggesting a price for that offer.
  // Only ever set from a row that is PENDING and carries no counter yet,
  // and only while the server has said the experiment is on: one shot
  // per bid, and the affordance disappears the moment it is spent.
  // REQUEST-WITHDRAW G3 — the clean walk-away the field asked for.
  //
  // Not flag-gated: ruling D4's companion decision put this in APK 14
  // LIVE. Two pieces of state, and no third: whether the confirm is
  // open, and whether the call is in flight.
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const [counterFor, setCounterFor] = useState<{
    bidId: string;
    driverName: string;
    price: number;
  } | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counteringBidId, setCounteringBidId] = useState<string | null>(null);

  const [conflictPrompt, setConflictPrompt] = useState<{
    bidId: string;
    via: 'momo' | 'card';
    conflictingRides: Array<{
      id: string;
      scheduledFor: string;
      pickupName?: string;
      destinationName?: string;
    }>;
  } | null>(null);

  // Closing the modal (cancel, backdrop, Esc) resets the selector so the
  // next bid the customer opens starts on Mobile Money, never inheriting a
  // previous Card selection.
  const closeConfirm = useCallback(() => {
    setConfirmBid(null);
    setPaymentMethod('momo');
  }, []);

  // Fetch journey and bids
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [journeyRes, bidsRes] = await Promise.all([
          apiFetch(`/api/journeys/${journeyId}`, {
            credentials: 'include',
          }),
          apiFetch(`/api/journeys/${journeyId}/bids`, {
            credentials: 'include',
          }),
        ]);

        if (!journeyRes.ok) throw await apiErrorFromResponse(journeyRes);
        if (!bidsRes.ok) throw await apiErrorFromResponse(bidsRes);
        const journey = await journeyRes.json();
        setActiveJourney(journey);
        // PAY-TRUTH G3 — the retry survives a reload. A customer who
        // closed the app on a failed charge and came back still has this
        // journey MATCHED over a FAILED escrow (until the unpaid-match
        // reaper's grace window expires), so the way forward must be here
        // when they return, not only in the moment the charge failed.
        if (journey?.status === 'MATCHED' && journey?.escrow?.status === 'FAILED') {
          setPaymentFailure({
            escrowId: journey.escrow.id,
            amount: journey.escrow.amount ?? 0,
            code: null,
          });
          // SETTLE-UP G3 — and it survives the reload NAMED. The panel
          // above renders immediately on the generic copy; the status
          // read then supplies the gateway's own reason so "top up your
          // wallet" replaces "the payment did not go through". Fetched
          // after the panel is already up, and failing soft: a customer
          // who cannot reach this endpoint still gets the retry, just
          // without the named reason.
          const escrowId = journey.escrow.id;
          fetchEscrowStatus(escrowId)
            .then((s) => {
              if (!s?.failureReason) return;
              setPaymentFailure((prev) =>
                prev && prev.escrowId === escrowId
                  ? { ...prev, code: s.failureReason ?? null }
                  : prev,
              );
            })
            .catch(() => undefined);
        }
        const data = await bidsRes.json();
        setBids(data);
      } catch (err) {
        setLoadFailed(true);
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (journeyId) fetchData();
  }, [journeyId, setBids, setActiveJourney, showToast, t, reloadKey]);

  // MATCH-CLOSE G2 — the bid list is live.
  //
  // This replaces a commented-out placeholder that named an event
  // (`journey:<id>:bid`) nothing has ever emitted, so the page held no
  // subscription and never joined the journey room: a passenger saw the
  // list exactly as it was the instant it mounted, forever. That is the
  // "keeps waiting and doesn't bring anything" field report.
  //
  // useSocket(journeyId) is the composition point, not a fourth
  // implementation: it joins `journey:<id>` via JOIN_JOURNEY (and
  // leaves on unmount), and its BID_PLACED handler pushes each incoming
  // bid into the shared bid store — the same store this page renders
  // from. The server has emitted BID_PLACED into that room since
  // bid.routes.ts:75; only the listener was missing.
  const { isConnected } = useSocket(journeyId);

  // Poll health, and the last time the server list was successfully
  // read. Drives the G3 connection state.
  const [pollFailures, setPollFailures] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // MATCH-CLOSE G2 — one refresh of the server's bid list, merged so
  // that sockets and polling cannot double-insert.
  //
  // De-duplication argument, in two halves:
  //   * Same bid from both transports — impossible to duplicate,
  //     because every insert goes through the store's addBid, which is
  //     idempotent by bid id (bid.store.ts), and because the merge
  //     below is keyed on id rather than appended.
  //   * A bid racing an in-flight poll — the ids present BEFORE the
  //     request goes out are recorded. Anything that appears in the
  //     store while it is in flight arrived by socket AFTER the server
  //     built its snapshot, so it survives the merge instead of being
  //     erased by a response that could not have contained it. Anything
  //     that was already known and is absent from the response was
  //     withdrawn or expired server-side, so it is dropped. The server
  //     is authoritative for what existed at request time; the socket
  //     owns only the window since.
  const refreshBids = useCallback(async () => {
    if (!journeyId) return;
    const knownBefore = new Set(useBidStore.getState().bids.map((b: any) => b.id));

    const res = await apiFetch(`/api/journeys/${journeyId}/bids`, {
      credentials: 'include',
    });
    if (!res.ok) throw await apiErrorFromResponse(res);
    const serverBids: any[] = await res.json();

    const serverIds = new Set(serverBids.map((b) => b.id));
    const arrivedDuringRequest = useBidStore
      .getState()
      .bids.filter((b: any) => !knownBefore.has(b.id) && !serverIds.has(b.id));
    const merged = [...serverBids, ...arrivedDuringRequest];

    // Only write when something actually changed, so a quiet minute is
    // six no-op reads rather than six re-renders of the list.
    const signature = (rows: any[]) =>
      rows.map((b) => `${b.id}:${b.price}:${b.status}`).join('|');
    if (signature(merged) !== signature(useBidStore.getState().bids)) {
      setBids(merged);
    }
  }, [journeyId, setBids]);

  // MATCH-CLOSE G2 — the polling loop itself. Runs only while the
  // journey is still open for bids, pauses while the tab is hidden.
  const journeyStatus = activeJourney?.status;
  const isOpenForBids = journeyStatus === undefined || journeyStatus === OPEN_FOR_BIDS;
  useEffect(() => {
    if (!journeyId || !isOpenForBids || loadFailed) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        await refreshBids();
        if (cancelled) return;
        setPollFailures(0);
        setLastSyncAt(Date.now());
      } catch {
        // Deliberately silent: a failed poll is not a toast-worthy
        // event, it is a state the screen already names (G3). The
        // counter is what the passenger sees, not an error dialog.
        if (!cancelled) setPollFailures((n) => n + 1);
      }
    };

    // G2 — fast while this request can still receive bids, relaxed
    // otherwise. `isOpenForBids` is the same predicate that bounds the
    // loop, so the fast rate can only ever apply to a live request.
    const interval = setInterval(
      tick,
      isOpenForBids ? BID_POLL_ACTIVE_MS : BID_POLL_RELAXED_MS,
    );
    // A tab coming back to the foreground catches up immediately
    // instead of waiting out the rest of its interval.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [journeyId, isOpenForBids, loadFailed, refreshBids]);

  const handleShowAcceptConfirmation = useCallback((bidId: string) => {
    const bid = bids.find((b: any) => b.id === bidId);
    if (bid) {
      setConfirmBid({
        id: bidId,
        price: bid.price,
        driverName: bid.driverName || bid.driver?.nickname || '',
        etaMinutes: bid.etaMinutes,
        commissionBreakdown: (bid as any).commissionBreakdown,
      });
    }
  }, [bids]);

  // TEAM-ANSWERS G4 (item 16a) — the passenger declines ONE offer.
  //
  // Deliberately smaller machinery than accept: no modal, no money, no
  // journey transition. A confirm (the same window.confirm the driver's
  // End tap uses) and one POST. The declined bid leaves the list
  // immediately from the store, so the passenger sees the offer go even
  // if the socket update is slow; a failure restores nothing, because
  // nothing was removed until the server said yes.
  const handleDeclineBid = useCallback(async (bidId: string) => {
    if (decliningBidId) return;
    if (!window.confirm(t('bids.declineConfirm'))) return;
    setDecliningBidId(bidId);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/bids/${bidId}/decline`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      setBids(useBidStore.getState().bids.filter((b: any) => b.id !== bidId));
      showToast(t('bids.declined'), 'info');
    } catch (err) {
      presentApiError(err);
    } finally {
      setDecliningBidId(null);
    }
  }, [journeyId, decliningBidId, setBids, showToast, t]);

  // REQUEST-WITHDRAW G3 — the passenger takes her request back.
  //
  // REUSES THE EXISTING CANCEL BYTE-FOR-BYTE. Same endpoint, same
  // CUSTOMER_CHANGED_MIND reason the route already defaults to, same
  // attribution, same refund-if-any. Nothing new was needed on the
  // server for this: cancelJourney's per-reason switch has always
  // answered "Always allowed" for CUSTOMER_CHANGED_MIND with no status
  // restriction, so a REQUESTED pre-match journey cancels today and has
  // for as long as the reason taxonomy has existed. What was missing was
  // ONLY the affordance on this screen — the passenger could book, watch
  // offers arrive, and had no way to say "never mind" short of letting
  // the request expire.
  const handleWithdrawRequest = useCallback(async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ reason: 'CUSTOMER_CHANGED_MIND' }),
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      showToast(t('bidList.withdrawn'), 'info');
      navigate('/', { replace: true });
    } catch (err) {
      presentApiError(err);
    } finally {
      setWithdrawing(false);
      setWithdrawOpen(false);
    }
  }, [journeyId, withdrawing, showToast, navigate, t]);

  // COUNTER-READY G3 — the passenger suggests one number, once.
  //
  // Bounded on this side with the SAME two constants the server checks
  // against (MIN_PRICE_RWF/MAX_PRICE_RWF, shared/constants/config.ts) and
  // with the same equal-to-the-offer refusal, so the common mistakes are
  // named on the phone instead of costing a round trip. The server
  // re-checks all three regardless — this is courtesy, not the gate.
  const handleSubmitCounter = useCallback(async () => {
    if (!counterFor || counteringBidId) return;
    const amount = parseInt(counterAmount, 10);
    if (!Number.isFinite(amount)) return;
    if (amount < MIN_PRICE_RWF || amount > MAX_PRICE_RWF) {
      showToast(
        t('bids.counterOutOfBounds', {
          min: MIN_PRICE_RWF.toLocaleString(),
          max: MAX_PRICE_RWF.toLocaleString(),
        }),
        'error',
      );
      return;
    }
    if (amount === counterFor.price) {
      showToast(t('bids.counterEqualsPrice'), 'error');
      return;
    }
    setCounteringBidId(counterFor.bidId);
    try {
      const res = await apiFetch(
        `/api/journeys/${journeyId}/bids/${counterFor.bidId}/counter`,
        {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ counterAmountRwf: amount }),
        },
      );
      if (!res.ok) throw await apiErrorFromResponse(res);
      const updated = await res.json();
      // Fold the server's own row back into the list, so the button is
      // spent and the "waiting for an answer" line appears without
      // waiting for the next poll.
      setBids(
        useBidStore.getState().bids.map((b: any) =>
          b.id === counterFor.bidId ? { ...b, ...updated } : b,
        ),
      );
      setCounterFor(null);
      setCounterAmount('');
      showToast(t('bids.counterSent'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setCounteringBidId(null);
    }
  }, [counterFor, counterAmount, counteringBidId, journeyId, setBids, showToast, t]);

  const handleAcceptBid = useCallback(async (bidId: string, acknowledgeConflict = false) => {
    setConfirmBid(null);
    setPaymentMethod('momo');
    setAcceptingBidId(bidId);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/accept-bid`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(
          acknowledgeConflict ? { bidId, acknowledgeConflict: true } : { bidId },
        ),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();

      // SCHED-UI G3 — soft-block: surface the conflict dialog instead of
      // a generic failure. Never re-prompts after an acknowledged retry
      // (retry-once rule).
      if (updated.matched === false && updated.conflictWarning) {
        if (acknowledgeConflict) {
          throw new Error(t('scheduled.acceptAnywayFailed'));
        }
        setConflictPrompt({
          bidId,
          via: 'momo',
          conflictingRides: updated.conflictWarning.conflictingRides ?? [],
        });
        return;
      }

      // PAY-TRUTH G3 — the accept succeeded but the CHARGE did not.
      //
      // /accept-bid answers 200 with a journey object built before the
      // charge was attempted, so it reads MATCHED whatever the gateway
      // said. Navigating on that alone is what put a customer whose money
      // was never taken on a live-tracking map for a ride that did not
      // exist (docs/payment-failure-matrix.md R1). The escrow status is
      // the truth, and it stops us here.
      //
      // Since G2 the motari is still theirs — the match is held — so this
      // is a retry, not a loss.
      if (updated.escrowStatus === 'FAILED' && updated.escrowId) {
        setPaymentFailure({
          escrowId: updated.escrowId,
          amount: updated.escrowAmount ?? 0,
          code: updated.paymentFailureCode ?? null,
        });
        return;
      }

      setActiveJourney(updated);
      showToast(t('bids.accepted'), 'success');
      navigate(`/journey/${journeyId}/matched`, { replace: true });
    } catch (err: any) {
      // NET-UX G2 — API failures speak the shared taxonomy; local throws
      // (e.g. the acknowledged-retry conflict) carry pre-translated copy.
      if (err instanceof ApiError) presentApiError(err);
      else showToast(err?.message || t('bids.acceptFailed'), 'error');
    } finally {
      setAcceptingBidId(null);
    }
  }, [journeyId, setActiveJourney, showToast, navigate, t]);

  // Card sibling of handleAcceptBid. Step 1 posts to /accept-bid-card to
  // create the PENDING escrow and get back its txRef/amount; step 2 opens
  // the Flutterwave widget and verifies the charge (escrow → HELD); step 3
  // navigates to MatchedPage on the same success boundary as MoMo. If the
  // customer closes the widget mid-flow the escrow stays PENDING and the
  // server's expiry cron reclaims it — no client cleanup needed.
  const handleAcceptBidCard = useCallback(async (bidId: string, acknowledgeConflict = false) => {
    setConfirmBid(null);
    setPaymentMethod('momo');
    setAcceptingBidId(bidId);
    try {
      const acceptRes = await apiFetch(`/api/journeys/${journeyId}/accept-bid-card`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(
          acknowledgeConflict ? { bidId, acknowledgeConflict: true } : { bidId },
        ),
      });

      if (!acceptRes.ok) throw await apiErrorFromResponse(acceptRes);

      const acceptData = await acceptRes.json();

      // SCHED-UI G3 — scheduled-ride conflict: same soft-block shape as
      // the MoMo route. Surface the conflict dialog; an acknowledged
      // retry that soft-blocks again fails outright (retry-once rule).
      if (acceptData.matched === false && acceptData.conflictWarning) {
        if (acknowledgeConflict) {
          throw new Error(t('scheduled.acceptAnywayFailed'));
        }
        setConflictPrompt({
          bidId,
          via: 'card',
          conflictingRides: acceptData.conflictWarning.conflictingRides ?? [],
        });
        return;
      }

      if (!acceptData.cardCheckout) {
        showToast(t('payment.card.unexpectedResponse'), 'error');
        return;
      }

      // Card-charge stage. Its failures map to card-specific toasts; the
      // escrow is already PENDING (the server's expiry cron reclaims an
      // abandoned one), so a charge failure simply leaves the customer on
      // this page to retry — no rollback needed.
      try {
        showToast(t('payment.card.opening'), 'info');
        await chargeWithCard({
          cardCheckout: acceptData.cardCheckout,
          customer: {
            email: (user as any)?.email ?? '',
            phone: user?.phone ?? '',
            name: user?.nickname ?? '',
          },
          onVerifying: () => showToast(t('payment.card.verifying'), 'info'),
        });
      } catch (cardErr: any) {
        const code: string = cardErr?.message ?? '';
        if (code === 'CARD_WIDGET_CANCELLED') {
          showToast(t('payment.card.cancelled'), 'info');
        } else if (code === 'CARD_WIDGET_NO_PUBLIC_KEY') {
          showToast(t('payment.card.unavailable'), 'error');
        } else {
          // Any other widget / verification failure (incl. the server
          // forgery guards AMOUNT_MISMATCH / VERIFICATION_FAILED /
          // TXID_MISMATCH).
          showToast(t('payment.card.verifyFailed'), 'error');
        }
        return;
      }

      // Verified → escrow HELD. Same success boundary as the MoMo flow.
      setActiveJourney(acceptData);
      showToast(t('bids.accepted'), 'success');
      navigate(`/journey/${journeyId}/matched`, { replace: true });
    } catch (err: any) {
      // NET-UX G2 — API failures speak the shared taxonomy; local throws
      // (e.g. the acknowledged-retry conflict) carry pre-translated copy.
      if (err instanceof ApiError) presentApiError(err);
      else showToast(err?.message || t('bids.acceptFailed'), 'error');
    } finally {
      setAcceptingBidId(null);
    }
  }, [journeyId, user, setActiveJourney, showToast, navigate, t]);

  // Shared 409 / "I approved it" resolution: the escrow is the authority.
  const settleIfAlreadyPaid = useCallback(
    async (escrowId: string) => {
      try {
        const current = await fetchEscrowStatus(escrowId);
        if (current.status === 'HELD') {
          showToast(t('bids.accepted'), 'success');
          navigate(`/journey/${journeyId}/matched`, { replace: true });
          return true;
        }
        if (current.status === 'PENDING') {
          showToast(t('payment.recover.stillWaiting'), 'info');
          return false;
        }
        showToast(t(failureCopyKey(null)), 'error');
        return false;
      } catch (err) {
        if (err instanceof ApiError) presentApiError(err);
        else showToast(t('errors.rejectedGeneric'), 'error');
        return false;
      }
    },
    [journeyId, navigate, showToast, t],
  );

  // PAY-TRUTH G3 — one tap, no reload: charge the SAME escrow again.
  //
  // Status branching, all of it:
  //   200 {status:'HELD'}      the money is held → this is a ride; go.
  //   200 {status:'PENDING'}   a USSD push is out (the normal MoMo case)
  //                            → stay, tell them to approve it on their
  //                            handset, and offer "I approved it".
  //   409 ESCROW_NOT_RETRIABLE something already moved the escrow — almost
  //                            always the webhook confirming a charge that
  //                            raced us. Re-read the status before saying
  //                            anything: HELD means they paid, and telling
  //                            them otherwise would be the worst lie on
  //                            this screen.
  //   502 CHARGE_FAILED        the gateway declined again; `detail` names
  //                            which failure, and the panel stays open.
  //   429                      the endpoint is rate-limited 5/min.
  //   400/403/404              nothing the customer can fix → the NET-UX
  //                            presenter's shared vocabulary.
  const handleRetryMomo = useCallback(async () => {
    if (!paymentFailure) return;
    setRetrying(true);
    try {
      const res = await retryMomoCharge(paymentFailure.escrowId);
      if (res.status === 'HELD') {
        showToast(t('bids.accepted'), 'success');
        navigate(`/journey/${journeyId}/matched`, { replace: true });
        return;
      }
      setPaymentFailure({ ...paymentFailure, awaitingPush: true, code: null });
      showToast(t('payment.recover.checkPhone'), 'info');
    } catch (err) {
      if (err instanceof PaymentRetryError) {
        if (err.status === 409) {
          await settleIfAlreadyPaid(paymentFailure.escrowId);
          return;
        }
        if (err.status === 429) {
          showToast(t('payment.recover.tooManyAttempts'), 'error');
          return;
        }
        if (err.status === 502) {
          setPaymentFailure({ ...paymentFailure, code: err.detail, awaitingPush: false });
          showToast(t(failureCopyKey(err.detail)), 'error');
          return;
        }
        showToast(t('errors.rejectedGeneric'), 'error');
        return;
      }
      if (err instanceof ApiError) presentApiError(err);
      else showToast(t('payment.failed'), 'error');
    } finally {
      setRetrying(false);
    }
  }, [paymentFailure, journeyId, navigate, showToast, t, settleIfAlreadyPaid]);

  // PAY-TRUTH G3 — switch method after a MoMo failure.
  //
  // The two rails share one escrow row, so they must not disagree about
  // its reference: every MoMo retry mints a fresh txRef, and the widget
  // has to charge against whatever the escrow holds NOW or /initiate-card
  // has nothing to verify. So the current txRef is re-read from the server
  // immediately before the widget opens, never taken from page state.
  const handleSwitchToCard = useCallback(async () => {
    if (!paymentFailure) return;
    setRetrying(true);
    try {
      const current = await fetchEscrowStatus(paymentFailure.escrowId);
      if (current.status === 'HELD') {
        showToast(t('bids.accepted'), 'success');
        navigate(`/journey/${journeyId}/matched`, { replace: true });
        return;
      }
      if (!current.txRef) {
        showToast(t('payment.card.unexpectedResponse'), 'error');
        return;
      }
      try {
        showToast(t('payment.card.opening'), 'info');
        await chargeWithCard({
          cardCheckout: {
            escrowId: paymentFailure.escrowId,
            txRef: current.txRef,
            amount: paymentFailure.amount,
          },
          customer: {
            email: (user as any)?.email ?? '',
            phone: user?.phone ?? '',
            name: user?.nickname ?? '',
          },
          onVerifying: () => showToast(t('payment.card.verifying'), 'info'),
        });
      } catch (cardErr: any) {
        const code: string = cardErr?.message ?? '';
        if (code === 'CARD_WIDGET_CANCELLED') showToast(t('payment.card.cancelled'), 'info');
        else if (code === 'CARD_WIDGET_NO_PUBLIC_KEY') showToast(t('payment.card.unavailable'), 'error');
        else showToast(t('payment.card.verifyFailed'), 'error');
        return;
      }
      showToast(t('bids.accepted'), 'success');
      navigate(`/journey/${journeyId}/matched`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) presentApiError(err);
      else showToast(t('errors.rejectedGeneric'), 'error');
    } finally {
      setRetrying(false);
    }
  }, [paymentFailure, journeyId, user, navigate, showToast, t]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'rating' ? 'desc' : 'asc');
    }
  };

  const sortedBids = [...bids].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'price':
        cmp = (a.price || 0) - (b.price || 0);
        break;
      case 'rating':
        // RATE-DISPLAY — the server nests the rating under bid.driver
        // (bid.service.ts); the legacy top-level driverRating this line
        // used to read is never sent, so it compared undefineds. The
        // shared accessor reads whichever shape the row carries.
        cmp =
          (getDriverRatingInfo(a).avgRating ?? 0) -
          (getDriverRatingInfo(b).avgRating ?? 0);
        break;
      case 'eta':
        cmp = (a.etaMinutes || 0) - (b.etaMinutes || 0);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // ANY-VEHICLE G3 — the comparison view.
  //
  // A journey with no vehiclePreference is one the customer opened to
  // every kind of machine, so the offers arriving are not comparable
  // as one flat list: a bicycle at 900 RWF and a moto at 1,800 RWF are
  // not competing on price, they are two different trips. Grouping
  // them by the bidding motari's own vehicle type is what turns the
  // list back into a choice.
  //
  // No new endpoint and no new request: `bid.driver.vehicleType` has
  // been on every row since DRIVER-ID v3 (bid.service.ts:169, which
  // defaults it to MOTO), alongside the price and the driver's ETA the
  // rows already render.
  //
  // A journey that DOES carry a preference renders exactly as before —
  // one flat sorted list, no section headers, no markers. Every offer
  // on it is the same kind of machine, so sections would be one
  // section, and the marker would mark the row the existing price sort
  // already puts on top.
  const isAnyVehicleJourney =
    !!activeJourney && !(activeJourney as any).vehiclePreference;

  // Sections ordered CHEAPEST FIRST — by each section's own lowest
  // price, which is the number the customer is comparing across kinds.
  // Within a section the existing sort (whatever the customer picked
  // in the sort control) is preserved untouched: `sortedBids` is
  // walked in order, so each section inherits it.
  const bidSections = React.useMemo(() => {
    if (!isAnyVehicleJourney) return [];
    const byType = new Map<string, any[]>();
    for (const bid of sortedBids) {
      const vt = String(bid.driver?.vehicleType ?? bid.vehicleType ?? 'MOTO');
      if (!byType.has(vt)) byType.set(vt, []);
      byType.get(vt)!.push(bid);
    }
    return [...byType.entries()]
      .map(([vehicleType, rows]) => ({
        vehicleType,
        rows,
        // The marker follows the lowest price in the section, not the
        // first row: the customer may be sorting by rating or ETA, and
        // "cheapest here" has to stay true under every sort.
        lowestPrice: Math.min(...rows.map((r: any) => r.price ?? Infinity)),
      }))
      .sort((a, b) => a.lowestPrice - b.lowestPrice);
  }, [isAnyVehicleJourney, sortedBids]);

  // ANY-VEHICLE G3 — one row, rendered identically in both
  // arrangements. Extracted rather than duplicated so the grouped view
  // cannot drift away from the flat one: the accept/decline handles,
  // the rating summary, the price and the driver's ETA are the same
  // elements in the same order either way. `isLowestInSection` is the
  // only thing the grouped view adds, and it is false on every row of
  // the flat view.
  const renderBidRow = (bid: any, isLowestInSection: boolean) => (
      <div
        key={bid.id}
        className="bg-white rounded-xl shadow-sm p-4"
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-semibold text-gray-900">
              {/* LIVE-WIRE G2 — the server has always nested the name under
                  `driver` (bid.service.getBidsForJourney); the flat
                  `driverName` this read alone is never sent, so every
                  motari showed up as "anonymous". Same fallback the
                  accept-confirmation already used at line 336. */}
              {bid.driverName || bid.driver?.nickname || t('bids.anonymousDriver')}
            </p>
            <div className="mt-0.5">
              <DriverRatingSummary info={getDriverRatingInfo(bid)} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-heading font-bold text-[#1B4F72]">
              {bid.price?.toLocaleString()} <span className="text-caption font-normal">RWF</span>
            </p>
            {/* ANY-VEHICLE G3 — only ever rendered inside a grouped
                section, and only on that section's cheapest offer.
                On a journey with a stated vehicle preference this is
                always false, so those rows are unchanged. */}
            {isLowestInSection && (
              <p
                data-testid={`bid-${bid.id}-cheapest`}
                className="text-caption font-medium text-green-700"
              >
                {t('bids.cheapestOfKind')}
              </p>
            )}
            {bid.etaMinutes && (
              <p className="text-caption text-gray-500">
                {t('bids.eta', { min: bid.etaMinutes })}
              </p>
            )}
          </div>
        </div>

        {/* ANY-VEHICLE G6 — the same dead flat read the driverName line
            above was, and the same mend. bid.service.ts:170 nests this
            under `driver`; no flat `vehicleDescription` is ever sent, so
            this line rendered for nobody and every offer lost the one
            sentence describing the machine ("red Boxer, blue helmet") —
            on a request open to every kind of wheel, the sentence that
            most helps a passenger choose. The census that found it
            reconciled EVERY property this row reads against the mapper;
            the reconciliation is in the dispatch report. */}
        {(bid.vehicleDescription || bid.driver?.vehicleDescription) && (
          <p className="text-caption text-gray-500 mb-3">
            {bid.vehicleDescription || bid.driver?.vehicleDescription}
          </p>
        )}

        <div className="flex gap-2">
        <Button
          fullWidth
          size="sm"
          variant="success"
          loading={acceptingBidId === bid.id}
          disabled={!!acceptingBidId || !!decliningBidId}
          // SETTLE-UP G6 — a per-bid handle. The e2e accept
          // helpers already preferred this id and fell back to
          // "the first Accept button" when it was absent, which
          // silently picks the wrong motari on any journey with
          // more than one bid.
          data-testid={`bid-${bid.id}-accept`}
          onClick={() => handleShowAcceptConfirmation(bid.id)}
        >
          {t('bids.accept')}
        </Button>
        {/* TEAM-ANSWERS G4 — one tap plus a confirm, using the
            same window.confirm the driver's End tap uses. The
            request stays open and every other offer stays live;
            this closes one offer and nothing else. */}
        <Button
          fullWidth
          size="sm"
          variant="secondary"
          loading={decliningBidId === bid.id}
          disabled={!!acceptingBidId || !!decliningBidId}
          data-testid={`bid-${bid.id}-decline`}
          onClick={() => handleDeclineBid(bid.id)}
        >
          {t('bids.decline')}
        </Button>
        </div>

        {/* COUNTER-READY G3 — "suggest another price", ruling D4.
            EVERYTHING in this block hangs off counterBidEnabled, which
            is false unless THIS server said otherwise at app start. On a
            dormant server nothing below renders — no button, no state
            line, no hint that the feature exists — which is what the
            invariant means by INVISIBLE.

            ONE SHOT PER BID, expressed as a fork rather than a disabled
            button: before the counter there is a button, after it there
            is the state of the conversation, and there is never a
            second entry point. The bid's own columns decide which —
            counterAmountRwf is null until she counters, counterOutcome
            null until he answers. */}
        {counterBidEnabled && bid.status === 'PENDING' && (
          bid.counterAmountRwf == null ? (
            <Button
              fullWidth
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={!!acceptingBidId || !!decliningBidId || !!counteringBidId}
              data-testid={`bid-${bid.id}-counter`}
              onClick={() => {
                setCounterFor({
                  bidId: bid.id,
                  driverName:
                    bid.driverName || bid.driver?.nickname || t('bids.anonymousDriver'),
                  price: bid.price,
                });
                setCounterAmount('');
              }}
            >
              {t('bids.suggestPrice')}
            </Button>
          ) : (
            <p
              className="mt-2 text-caption text-gray-600"
              data-testid={`bid-${bid.id}-counter-state`}
            >
              {bid.counterOutcome === 'DECLINED'
                ? t('bids.counterDeclinedState', {
                    price: bid.price?.toLocaleString(),
                  })
                : bid.counterOutcome === 'LAPSED'
                  ? t('bids.counterLapsedState')
                  : t('bids.counterPendingState', {
                      amount: bid.counterAmountRwf?.toLocaleString(),
                    })}
            </p>
          )
        )}
      </div>
  );

  // MATCH-CLOSE G3 — the four honest states of a waiting bid list.
  //
  // "Keeps waiting and doesn't bring anything" was possible because one
  // spinner stood for every one of these. Now the screen always names
  // which it is, and offers the one action that helps:
  //
  //   fetching — the first load is in flight (spinner, no action).
  //   live     — connected, no offers yet; says so, and says the page
  //              fills itself in (no action needed, and none offered).
  //   offline  — POLL_FAILURES_BEFORE_OFFLINE consecutive failed polls
  //              (~20s): neither transport is reaching the server.
  //              Offers Retry.
  //   ended    — the request is closed (expired/cancelled server-side)
  //              or the load itself failed. Expired offers "request
  //              again"; a failed load offers Retry via ErrorState.
  type BidListState = 'fetching' | 'live' | 'offline' | 'ended';
  const bidListState: BidListState = loadFailed
    ? 'ended'
    : isLoading
      ? 'fetching'
      : !isOpenForBids && sortedBids.length === 0
        ? 'ended'
        : pollFailures >= POLL_FAILURES_BEFORE_OFFLINE
          ? 'offline'
          : 'live';

  // NOTIFY G2 — the flip. A journey with offers is never "waiting", in
  // either direction: the header reads the same list the page renders,
  // so a bid arriving over the socket moves it with no extra wiring.
  const hasOffers = sortedBids.length > 0;

  const retryNow = useCallback(() => {
    setLoadFailed(false);
    setPollFailures(0);
    setReloadKey((k) => k + 1);
  }, []);

  if (bidListState === 'fetching') {
    return (
      <div
        className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3"
        data-testid="bid-list-state-fetching"
      >
        <Spinner size="lg" />
        <p className="text-secondary text-gray-500">{t('bidList.state.fetching')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        {/* Journey Summary */}
        {activeJourney && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <div className="flex items-center gap-2 text-secondary text-gray-600 mb-1">
              <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="4" />
              </svg>
              <span className="truncate">{activeJourney.pickupName}</span>
            </div>
            <div className="flex items-center gap-2 text-secondary text-gray-600">
              <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="4" />
              </svg>
              <span className="truncate">{activeJourney.destinationName}</span>
            </div>
            {activeJourney.distance && (
              <p className="mt-2 text-caption text-gray-500">
                {t('bids.distance', { km: (activeJourney.distance / 1000).toFixed(1) })}
              </p>
            )}
          </div>
        )}

        {/* Fair price banner (S1) */}
        {activeJourney?.fairPrice && (
          <div className="bg-[#1B4F72]/10 rounded-lg px-4 py-2 mb-4">
            <p className="text-secondary text-[#1B4F72] font-medium">
              {t('bids.fairPrice', { price: activeJourney.fairPrice.toLocaleString() })}
            </p>
            <p className="text-caption text-[#1B4F72] mt-0.5">
              {t('transparency.fairPriceNote')}
            </p>
          </div>
        )}

        {/* PAY-TRUTH G3 — the way forward, on the screen where the
            payment failed.

            This replaces the bid list rather than sitting beside it,
            because there is nothing to choose from any more: the motari
            is already this customer's (G2 holds the match), and the only
            thing standing between them and the ride is the money. One
            tap charges the same escrow again; no reload, no re-pick, no
            losing the driver who already agreed to carry them. */}
        {paymentFailure ? (
          <div
            className="bg-white rounded-xl shadow-sm p-4 space-y-3"
            role="alert"
            data-testid="payment-failure-panel"
          >
            <p className="font-semibold text-gray-900">{t('payment.recover.title')}</p>
            <p className="text-secondary text-gray-600" data-testid="payment-failure-reason">
              {paymentFailure.awaitingPush
                ? t('payment.recover.checkPhone')
                : t(failureCopyKey(paymentFailure.code))}
            </p>
            <p className="text-caption text-gray-500 border-t pt-2">
              {t('payment.recover.driverHeld')}
            </p>

            <Button
              fullWidth
              variant="success"
              loading={retrying}
              disabled={retrying}
              onClick={() =>
                paymentFailure.awaitingPush
                  ? settleIfAlreadyPaid(paymentFailure.escrowId)
                  : handleRetryMomo()
              }
              data-testid="payment-retry-momo"
            >
              {paymentFailure.awaitingPush
                ? t('payment.recover.iApproved')
                : t('payment.recover.tryMomo')}
            </Button>

            {/* Switching method must not be a second dead end: the card
                rail charges the SAME escrow, and handleSwitchToCard
                re-reads its current txRef so the two rails can never
                disagree about which reference was charged. Hidden when
                the card widget is not exercisable in this mode. */}
            {!cardHidden && (
              <Button
                fullWidth
                variant="secondary"
                disabled={retrying}
                onClick={handleSwitchToCard}
                data-testid="payment-retry-card"
              >
                {t('payment.recover.payByCard')}
              </Button>
            )}

            <button
              type="button"
              className="w-full min-h-[44px] text-caption text-gray-500 underline"
              onClick={() => navigate(`/journey/${journeyId}/matched`)}
              data-testid="payment-retry-see-ride"
            >
              {t('payment.recover.seeMyRide')}
            </button>
          </div>
        ) : (
          <>
        {/* NOTIFY G2 — "request sent — waiting for offers", said out loud.
            
            Gakiza's field finding (20 Aug): a passenger posts a ride, is
            navigated straight here, and the screen shows a spinner and a
            sort bar. Nothing on it confirms the request WAS SENT. She
            cannot tell "we have your request, drivers are being asked"
            apart from "this is broken", and the app's own answer to that
            confusion lived twelve lines down inside an empty state she
            had to scroll to reach.
            
            So the state is a HEADER now, above everything, and it names
            which of the two moments she is in. It renders only while the
            request is genuinely live and waiting: a journey WITH offers
            has flipped, and a closed, failed or offline request has its
            own state below and must not be told it is waiting. */}
        {bidListState === 'live' && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 ${
              hasOffers
                ? 'border-[#27AE60] bg-[#27AE60]/5'
                : 'border-[#1B4F72] bg-[#1B4F72]/5'
            }`}
            role="status"
            data-testid="bid-list-request-state"
            data-request-state={hasOffers ? 'offers-arrived' : 'waiting'}
          >
            <p className="text-sm font-semibold text-gray-900">
              {t(hasOffers ? 'bidList.request.offersTitle' : 'bidList.request.sentTitle')}
            </p>
            <p className="mt-0.5 text-caption text-gray-600">
              {t(
                hasOffers
                  ? 'bidList.request.offersBody'
                  : 'bidList.request.sentBody',
                { count: sortedBids.length },
              )}
            </p>
          </div>
        )}

        {/* Sort buttons */}
        <div className="flex gap-2 mb-4">
          {([
            { key: 'price' as SortKey, label: t('bids.sortPrice') },
            { key: 'rating' as SortKey, label: t('bids.sortRating') },
            { key: 'eta' as SortKey, label: t('bids.sortEta') },
          ]).map((s) => (
            <button
              key={s.key}
              onClick={() => handleSort(s.key)}
              className={`flex-1 min-h-[44px] px-2 py-1.5 rounded-lg border text-caption font-medium transition-colors ${
                sortKey === s.key
                  ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                  : 'border-gray-300 bg-white text-gray-600'
              }`}
            >
              {s.label} {sortKey === s.key && (sortDir === 'asc' ? '↑' : '↓')}
            </button>
          ))}
        </div>

        {/* MATCH-CLOSE G3 — a connection that has actually failed says so
            even when offers are already on screen, so a passenger never
            reads a stale list as a live one. */}
        {bidListState === 'offline' && sortedBids.length > 0 && (
          <div
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2"
            role="status"
            data-testid="bid-list-offline-banner"
          >
            <p className="text-caption font-medium text-amber-800">
              {t('bidList.state.offlineTitle')}
            </p>
          </div>
        )}

        {/* Bid list */}
        {loadFailed ? (
          <ErrorState onRetry={retryNow} data-testid="bid-list-state-failed" />
        ) : bidListState === 'ended' ? (
          <EmptyState
            title={t('bidList.state.expiredTitle')}
            body={t('bidList.state.expiredBody')}
            actionLabel={t('bidList.state.requestAgain')}
            onAction={() => navigate('/')}
            data-testid="bid-list-state-ended"
          />
        ) : bidListState === 'offline' ? (
          <EmptyState
            title={t('bidList.state.offlineTitle')}
            body={t('bidList.state.offlineBody')}
            actionLabel={t('common.retry')}
            onAction={retryNow}
            data-testid="bid-list-state-offline"
          />
        ) : sortedBids.length === 0 ? (
          <div className="text-center py-12" data-testid="bid-list-state-live">
            <Spinner size="md" className="mx-auto mb-4 text-[#1B4F72]" />
            <p className="text-gray-500 text-secondary">
              {t('bids.waitingForDrivers')}
            </p>
            <p className="mt-2 text-caption text-gray-500">
              {t('bidList.state.liveHint')}
            </p>
            {/* ANY-VEHICLE G3 — on an any-vehicle request the wait is a
                different wait: the customer has not narrowed the field,
                so it is worth saying who may still answer. */}
            {isAnyVehicleJourney && (
              <p
                className="mt-2 text-caption text-gray-500"
                data-testid="bid-list-any-vehicle-hint"
              >
                {t('bids.anyVehicleWaiting')}
              </p>
            )}
          </div>
        ) : isAnyVehicleJourney ? (
          /* ANY-VEHICLE G3 — grouped by the bidding motari's machine,
             cheapest section first. Same rows, same actions; only the
             arrangement differs. */
          <div className="space-y-5" data-testid="bid-list-grouped">
            {bidSections.map((section) => (
              <section key={section.vehicleType} data-testid={`bid-section-${section.vehicleType}`}>
                <h2 className="mb-2 text-caption font-semibold uppercase tracking-wide text-gray-500">
                  {t('bids.sectionHeader', {
                    vehicle: t(getVehicleCompliance(section.vehicleType).nameKey),
                    count: section.rows.length,
                  })}
                </h2>
                <div className="space-y-3">
                  {section.rows.map((bid: any) =>
                    renderBidRow(bid, bid.price === section.lowestPrice),
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedBids.map((bid) => renderBidRow(bid, false))}
          </div>
        )}
          </>
        )}

        {/* REQUEST-WITHDRAW G3 — "withdraw my request".
            PRE-MATCH ONLY, and strictly: `journeyStatus === OPEN_FOR_BIDS`
            rather than the looser `isOpenForBids` the poll uses, because
            that one treats an unloaded status as open — and a withdraw
            button must never appear on a screen that does not yet know
            what it is looking at. The moment the journey is MATCHED this
            disappears; MatchedPage's cancel flow (with its reason picker
            and its no-show windows) owns that world, and two cancel
            surfaces on one journey is how a passenger ends up accusing a
            motari of something by tapping the wrong one. */}
        {journeyStatus === OPEN_FOR_BIDS && !paymentFailure && (
          <div className="mt-6">
            <button
              type="button"
              data-testid="withdraw-request"
              onClick={() => setWithdrawOpen(true)}
              className="w-full min-h-[44px] text-secondary font-medium text-gray-500 underline"
            >
              {t('bidList.withdraw')}
            </button>
          </div>
        )}

        {/* REQUEST-WITHDRAW G3 — the confirm.
            One tap is a booking; two taps is a walk-away. A Modal rather
            than window.confirm, so it can be mounted and read BESIDE this
            screen in a test — a decision that ends a live request is not
            one to hand to a browser dialog nothing can inspect. */}
        <Modal
          isOpen={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          title={t('bidList.withdrawConfirmTitle')}
        >
          <div className="space-y-3" data-testid="withdraw-dialog">
            <p className="text-secondary text-gray-600">
              {t('bidList.withdrawConfirmBody')}
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => setWithdrawOpen(false)}
              >
                {t('bidList.withdrawKeep')}
              </Button>
              <Button
                fullWidth
                variant="danger"
                loading={withdrawing}
                data-testid="withdraw-confirm"
                onClick={handleWithdrawRequest}
              >
                {t('bidList.withdrawConfirm')}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Accept Bid Confirmation Modal (C3) */}
        <Modal
          isOpen={!!confirmBid}
          onClose={closeConfirm}
          title={t('transparency.confirmRide')}
        >
          {confirmBid && (
            <div className="space-y-3">
              <div className="flex justify-between text-secondary">
                <span className="text-gray-600">{confirmBid.driverName}</span>
                <span className="text-gray-500">ETA ~{confirmBid.etaMinutes} min</span>
              </div>
              <hr />
              <div className="flex justify-between text-secondary">
                <span className="text-gray-600">{t('transparency.totalPaid')}</span>
                <span className="font-semibold">{confirmBid.price.toLocaleString()} RWF</span>
              </div>
              {/* MONEY-VIEW v2 G3 — the passenger's own side of the sum.
                  WAS: platformFee(rate), the commission amount, and
                  "driver receives X" — three lines that never rendered and
                  should not have if they had. Never, because bid.service
                  scopes `commissionBreakdown` OFF for a customer viewer
                  (LIVE-WIRE G4) and this screen is customer-only, so
                  `hasFullCommissionBreakdown` was permanently false here.
                  Should not have, because rate x price IS the commission
                  and price - commission IS the motari's net: the two lines
                  reconstructed precisely what #202 exists to withhold.

                  NOW: bid.service attaches the customer-safe FOUR to a
                  customer's bid rows, computed at the `calculateCommission`
                  call that was already on that path — no new query — and
                  this renders her tier, what it saved her, and whether the
                  fee was waived. `customerSavings` is a function of the
                  CUSTOMER rate alone; nothing here narrows to his payout.

                  The guard is `hasCustomerSafeCommission`, not an object
                  test: CLEAN-SWEEP G1's rule holds, a screen dereferences
                  money fields only behind a shape predicate. */}
              {hasCustomerSafeCommission(confirmBid.commissionBreakdown) && (
                <div className="space-y-1" data-testid="bid-confirm-savings">
                  <p className="text-caption text-gray-500">
                    {t('transparency.customerTierLine', {
                      tier: confirmBid.commissionBreakdown.customerTier,
                    })}
                  </p>
                  {confirmBid.commissionBreakdown.customerSavings > 0 && (
                    <p className="text-caption text-green-700">
                      {t('transparency.tierSavings', {
                        tier: confirmBid.commissionBreakdown.customerTier,
                        amount: confirmBid.commissionBreakdown.customerSavings,
                      })}
                    </p>
                  )}
                  {confirmBid.commissionBreakdown.feeWaiverApplied && (
                    <p className="text-caption text-green-700" data-testid="bid-confirm-fee-waived">
                      {t('transparency.customerFeeWaived')}
                    </p>
                  )}
                </div>
              )}
              <p className="text-caption text-gray-500 pt-2 border-t">
                {t('transparency.paymentHeldInEscrow')}
              </p>

              {/* Payment-method selector (R3-PAYMENT-CARD-CLIENT).
                  PAY-TRUTH G4 — shown in simulated mode too, now that the
                  card rail has a simulated checkout of its own. Hidden
                  only where the widget genuinely cannot run. */}
              {!cardHidden && (
                <div className="mt-2 space-y-2 pt-2 border-t">
                  <p className="font-semibold text-secondary text-gray-700">{t('payment.method.label')}</p>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-secondary">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="momo"
                        checked={paymentMethod === 'momo'}
                        onChange={() => setPaymentMethod('momo')}
                      />
                      <span className="font-medium">{t('payment.method.momo')}</span>
                      <span className="text-caption text-gray-500">{t('payment.method.momoHint')}</span>
                    </label>
                    <label className="flex items-center gap-2 text-secondary">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="card"
                        checked={paymentMethod === 'card'}
                        onChange={() => setPaymentMethod('card')}
                      />
                      <span className="font-medium">{t('payment.method.card')}</span>
                      <span className="text-caption text-gray-500">{t('payment.method.cardHint')}</span>
                    </label>
                  </div>
                </div>
              )}

              {paymentsSimulated && (
                <p className="mt-2 pt-2 border-t text-caption font-semibold text-amber-700">
                  {t('simulation.banner')}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button fullWidth variant="secondary" onClick={closeConfirm}>
                  {t('common.cancel')}
                </Button>
                <Button
                  fullWidth
                  variant="success"
                  loading={!!acceptingBidId}
                  onClick={() =>
                    !cardHidden && paymentMethod === 'card'
                      ? handleAcceptBidCard(confirmBid.id)
                      : handleAcceptBid(confirmBid.id)
                  }
                >
                  {!cardHidden && paymentMethod === 'card'
                    ? t('payment.method.confirmCard')
                    : paymentsSimulated
                      ? t('simulation.payConfirm')
                      : t('transparency.confirmAndPay')}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* SCHED-UI G3 — scheduled-ride conflict dialog (soft-block). */}
        <Modal
          isOpen={!!conflictPrompt}
          onClose={() => setConflictPrompt(null)}
          title={t('scheduled.conflictTitle')}
        >
          {conflictPrompt && (
            <div className="space-y-3" data-testid="conflict-dialog">
              <p className="text-secondary text-gray-600">{t('scheduled.conflictBody')}</p>
              {conflictPrompt.conflictingRides.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-amber-50 border border-amber-200 p-3">
                  {conflictPrompt.conflictingRides.map((ride) => (
                    <li key={ride.id} className="text-caption text-amber-800">
                      {t('scheduled.conflictRide', {
                        time: ride.scheduledFor
                          ? formatScheduledDateTime(ride.scheduledFor)
                          : '',
                        pickup: ride.pickupName ?? '',
                        destination: ride.destinationName ?? '',
                      })}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3 pt-2">
                <Button
                  fullWidth
                  variant="secondary"
                  onClick={() => setConflictPrompt(null)}
                  data-testid="conflict-choose-another"
                >
                  {t('scheduled.chooseAnotherDriver')}
                </Button>
                <Button
                  fullWidth
                  variant="success"
                  loading={!!acceptingBidId}
                  data-testid="conflict-accept-anyway"
                  onClick={() => {
                    const prompt = conflictPrompt;
                    setConflictPrompt(null);
                    if (prompt.via === 'card') {
                      handleAcceptBidCard(prompt.bidId, true);
                    } else {
                      handleAcceptBid(prompt.bidId, true);
                    }
                  }}
                >
                  {t('scheduled.acceptAnyway')}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* COUNTER-READY G3 — the counter entry.
            Rendered only while counterBidEnabled AND a row opened it, so
            on a dormant server `counterFor` can never be set and this
            Modal never mounts. One number, bounded on both sides, and no
            way back to it once sent. */}
        <Modal
          isOpen={counterBidEnabled && !!counterFor}
          onClose={() => {
            setCounterFor(null);
            setCounterAmount('');
          }}
          title={t('bids.suggestPrice')}
        >
          {counterFor && (
            <div className="space-y-3" data-testid="counter-dialog">
              <p className="text-secondary text-gray-600">
                {t('bids.counterIntro', {
                  driver: counterFor.driverName,
                  price: counterFor.price.toLocaleString(),
                })}
              </p>
              <label className="block">
                <span className="text-caption text-gray-500">
                  {t('bids.counterLabel')}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_PRICE_RWF}
                  max={MAX_PRICE_RWF}
                  value={counterAmount}
                  onChange={(e) => setCounterAmount(e.target.value)}
                  data-testid="counter-amount-input"
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-base"
                />
              </label>
              {/* The one-shot rule, said out loud before it is spent —
                  she cannot come back and adjust it. */}
              <p className="text-caption text-gray-500">{t('bids.counterOnce')}</p>
              <div className="flex gap-3 pt-2">
                <Button
                  fullWidth
                  variant="secondary"
                  onClick={() => {
                    setCounterFor(null);
                    setCounterAmount('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  fullWidth
                  variant="primary"
                  loading={counteringBidId === counterFor.bidId}
                  disabled={counterAmount.trim() === ''}
                  data-testid="counter-submit"
                  onClick={handleSubmitCounter}
                >
                  {t('bids.counterSend')}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};

export default BidListPage;
