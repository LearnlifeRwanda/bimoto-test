import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { ValuePulse } from '../../components/ui/ValuePulse';
import { UrgentBadge } from '../../components/journey/UrgentBadge';
import { ParcelBadge } from '../../components/journey/ParcelBadge';
import { ParcelSummary } from '../../components/journey/ParcelSummary';
import { ChildPassengerBadge } from '../../components/journey/ChildPassengerBadge';
import { ActiveJourneyBanner } from '../../components/journey/ActiveJourneyBanner';
import { DriverStatsCard } from '../../components/driver/DriverStatsCard';
import { DriverEarningsCard } from '../../components/driver/DriverEarningsCard';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { useDiagnosticsStore } from '../../stores/diagnostics.store';
import { useDriverLivenessStore } from '../../stores/driver-liveness.store';
import {
  ensureDriverLivenessRunning,
  pingDriverLivenessNow,
  setDriverLivenessOnline,
} from '../../services/driver-liveness';
import { useSocket } from '../../hooks/useSocket';
import { geolocation } from '../../hooks/useGeolocation';
import { formatScheduledDateTime } from '../../lib/scheduled';
import { getVehicleCompliance } from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse, isConnectivityError } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

// LIVE-WIRE G2 — the request feed gets its own, faster clock.
//
// Until this dispatch the feed rode the location tick: one 15 s timer
// did GPS fix → PUT /users/me/location → GET /journeys?viewAs=driver.
// That coupling set the motari's worst-case wait for a new request at
// 15 seconds even though nothing about a *read* needs a GPS fix or a
// write to precede it.
//
// The two are now separate concerns on separate clocks:
//   - the location WRITE stays at 15 s. It costs a GPS fix and a server
//     write, it is what the cascade reads to decide who is in a ring,
//     and 15 s is already fresh enough for that (the server's own
//     freshness window is far wider). Nothing is gained by burning
//     battery faster.
//   - the feed READ runs at 5 s while the driver is online and free.
//     It is a small JSON GET, and it is the number the field feels.
//
// The socket push path is still primary and unchanged: the cascade
// emits journey:available into `user:<driverId>` and the effect below
// refetches on it (measured working). This is the fallback for the
// phone that is on polling, in a stairwell, or outside the current ring
// — and, per the invariant, it is never disabled.
const FEED_POLL_ACTIVE_MS = 5000;

// BOOK-UNBLOCK G4 — every failure in the location-sync flow is now
// visible and retryable. Which message + retry action the banner
// carries depends on where the flow broke.
type LocationSyncIssue = 'go-online' | 'tracking' | 'go-offline';

const SYNC_ISSUE_COPY: Record<LocationSyncIssue, string> = {
  'go-online': 'dashboard.goOnlineFailed',
  tracking: 'dashboard.locationSyncLost',
  'go-offline': 'dashboard.goOfflineFailed',
};

interface TierStatus {
  role: string;
  driverTier?: {
    currentTier: string;
    commissionRate: number;
    totalRides: number;
    nextTier: string | null;
    ridesUntilNextTier: number;
    nextTierRate: number | null;
    savingsPerRideVsNew: string;
  };
}

// R3-N-5 — slim shape: only what the dashboard banner needs.
interface AccountStatusSummary {
  status: 'ACTIVE' | 'SUSPENDED' | 'FLAGGED';
  suspendedUntil: string | null;
}

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { nearbyRequests, setNearbyRequests, availableSignal } = useJourneyStore();
  const { showToast } = useUIStore();

  // SOCKET-FIX G2 — the dashboard is where the driver actually looks, so
  // it owns a live socket while mounted; journey:available lands as the
  // store's availableSignal (see the effect below).
  useSocket();

  const [isOnline, setIsOnline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // FIELD-FIT G5 — set by ActiveJourneyBanner; drives the feed's
  // "finish your current ride first" state.
  const [hasActiveRide, setHasActiveRide] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [tierStatus, setTierStatus] = useState<TierStatus | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatusSummary | null>(null);
  const [newRequestCue, setNewRequestCue] = useState(false);
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenSignalSeqRef = useRef(0);

  const [syncIssue, setSyncIssue] = useState<LocationSyncIssue | null>(null);

  // FEED-CONTRACT G3 — mount-time restore of the server's online truth
  // runs exactly once (see the effect below); a manual toggle always
  // wins over an in-flight restore.
  const restoreAttemptedRef = useRef(false);
  const userToggledRef = useRef(false);

  // BOOK-UNBLOCK G4 — no more silent fail: a rejected or non-2xx write
  // throws so every caller must decide what the driver sees.
  // (FEED-CONTRACT G3 dropped the isOnline key from this body — the
  // location route only ever read lat/lng; online state has its own
  // endpoint below.)
  const updateLocation = useCallback(async (lat: number, lng: number) => {
    const res = await apiFetch(`/api/users/me/location`, {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ lat, lng }),
    });
    if (!res.ok) throw await apiErrorFromResponse(res);
    // MATCH-CLOSE G4 — the position the server was just told, and when.
    // Nothing new is exposed: this is the value the request carried.
    useDiagnosticsStore.getState().recordLocationSent(lat, lng);
  }, []);

  // FEED-CONTRACT G3 — the ONE writer of the server's online truth.
  // PUT /me/online-status is the only endpoint that writes
  // driverProfile.isOnline (the column supply counts and broadcasts
  // read, and the column the mount-time restore below reads back).
  // The old flow put isOnline inside the location body, which the
  // location route silently drops — so the server never actually had
  // this driver online.
  const sendOnlineStatus = useCallback(async (isOnline: boolean) => {
    const res = await apiFetch(`/api/users/me/online-status`, {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ isOnline }),
    });
    if (!res.ok) throw await apiErrorFromResponse(res);
  }, []);

  const sendOfflineStatus = useCallback(
    () => sendOnlineStatus(false),
    [sendOnlineStatus],
  );

  const fetchNearbyRequests = useCallback(async (lat: number, lng: number) => {
    setIsLoading(true);
    try {
      // FEED-CONTRACT G1 — the branch selector the handler actually
      // reads is `viewAs` (journeyQuerySchema strips undeclared keys,
      // so the old `role=driver` never reached it): without viewAs a
      // BOTH-role driver — the shape onboarding produces — fell into
      // the customer branch and saw their own journeys instead of
      // nearby requests.
      const res = await apiFetch(
        `/api/journeys?viewAs=driver&lat=${lat}&lng=${lng}`,
        { credentials: 'include' }
      );
      // MATCH-CLOSE G4 — record what the feed asked and what it answered,
      // so the diagnostics screen can name this hop. Recorded before the
      // ok-check so a 4xx is captured too — that is the interesting case.
      useDiagnosticsStore.getState().recordFeedRequest('driver', res.status);
      if (!res.ok) throw await apiErrorFromResponse(res);
      const data = await res.json();
      setNearbyRequests(data);
      setLoadFailed(false);
    } catch (err) {
      // NET-UX G3 — a failed load renders the retryable error state,
      // never a fake "no requests". Polled refresh: connectivity trouble
      // is the banner's story; only real server answers earn a toast.
      setLoadFailed(true);
      if (!isConnectivityError(err)) presentApiError(err);
    } finally {
      setIsLoading(false);
    }
  }, [setNearbyRequests, showToast, t]);

  // LOCATION-LIFE A G2 — the periodic location write is NOT this page's
  // any more, and that is the whole dispatch.
  //
  // It used to be a 15 s setInterval created in handleGoOnline and
  // cleared by the unmount effect below, which made the motari's
  // existence a property of this screen being on top: a tap through to
  // a bid, a chat or the account page stopped the heartbeat, and 300 s
  // later he was dropped by every consumer of `lastLocationAt` — the
  // supply count, the cascade ring, both broadcasters, the auto-bid
  // evaluator and this very feed — with the toggle still reading
  // "I'm online". The field called it "no requests for ~15 minutes
  // unless you restart the app"; restarting worked because remounting
  // this page rebuilt the interval.
  //
  // The heartbeat now lives in services/driver-liveness.ts, held by
  // App.tsx above the router, and runs on a fact (`active`) rather than
  // on a mount. This page's remaining job is to SET that fact when the
  // driver toggles, and to keep showing the failures — which is the
  // BOOK-UNBLOCK G4 contract, unchanged.
  //
  // The call below is idempotent and is here so the dashboard is
  // self-sufficient in isolation: App holds liveness in the real app,
  // and this keeps the page's own contract tests honest when they
  // render it alone. Note there is no cleanup — installing the runner
  // is not something a page may undo.
  useEffect(() => {
    ensureDriverLivenessRunning();
  }, []);

  const livenessFailed = useDriverLivenessStore((s) => s.lastPingFailed);
  const livenessCoords = useDriverLivenessStore((s) => s.lastCoords);
  const setDriverOnline = useAuthStore((s) => s.setDriverOnline);

  // A heartbeat that stops reaching the server is the same event the
  // page's own tick used to raise, and it raises the same retryable
  // banner: "your position is not being sent". A recovered beat clears
  // it, and only that issue — a go-online or go-offline failure is a
  // different story and stays on screen until its own retry.
  useEffect(() => {
    if (livenessFailed) setSyncIssue('tracking');
    else setSyncIssue((prev) => (prev === 'tracking' ? null : prev));
  }, [livenessFailed]);

  // Follow the motari as he moves: the feed effect is keyed on
  // currentPosition, so mirroring each successful beat keeps the list
  // scoped to where he actually is — what the page's own tick did.
  useEffect(() => {
    if (livenessCoords) setCurrentPosition(livenessCoords);
  }, [livenessCoords]);

  // Both halves of "this driver is working", written together: the
  // store the heartbeat follows, and the auth store's mirror of the
  // server's own isOnline column.
  const markOnline = useCallback(
    (online: boolean) => {
      setDriverOnline(online);
      setDriverLivenessOnline(online);
    },
    [setDriverOnline],
  );

  // LIVE-WIRE G2 — the feed's own loop, on its own clock (see
  // FEED_POLL_ACTIVE_MS). Runs only while the driver is online with a
  // known position and no ride in hand — a motari mid-ride is not
  // shopping — and pauses with the tab, so an app in a pocket is not
  // reading the feed five times a minute. A returning tab catches up
  // immediately rather than waiting out its interval.
  useEffect(() => {
    if (!isOnline || !currentPosition || hasActiveRide) return;
    const tick = () => {
      if (document.hidden) return;
      fetchNearbyRequests(currentPosition.lat, currentPosition.lng);
    };
    const interval = setInterval(tick, FEED_POLL_ACTIVE_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isOnline, currentPosition, hasActiveRide, fetchNearbyRequests]);

  // LOCATION-LIFE A G2 — no interval to clear here any more. Going
  // offline is a fact about the driver, so it is written as one: the
  // heartbeat stops because `active` went false, not because a screen
  // tore something down.
  const stopLocationTracking = useCallback(async () => {
    markOnline(false);
    await sendOfflineStatus();
  }, [markOnline, sendOfflineStatus]);

  // BOOK-UNBLOCK G4 — "I'm online" may only render once the server has
  // confirmed the first location write. Every failure leaves the driver
  // visibly offline with a retryable banner instead of a silent lie.
  //
  // LOCATION-LIFE A G3 — going online stops fighting the GPS.
  //
  // This handler used to await a single `{ enableHighAccuracy: true }`
  // fix, which merges useGeolocation's DEFAULT_OPTIONS: a 10 s ceiling
  // and `maximumAge: 0`, i.e. a fresh high-accuracy fix or nothing. A
  // cold or indoor phone cannot give that inside ten seconds, so the
  // motari tapped, waited, hit the retry banner, and tapped again —
  // the field's "about fifteen minutes before it works".
  //
  // Two tiers now, and the change is entirely per-call: DEFAULT_OPTIONS
  // is untouched, because eleven call sites share it and the ride-trace
  // and emergency-follow contracts depend on it staying strict.
  //
  //   1. a good fix, but a cached one from the last two minutes is
  //      accepted rather than refused, with a ceiling that lets a slow
  //      chip finish instead of timing out under it;
  //   2. failing that, ANY fix — accuracy off, a five-minute-old
  //      position accepted. For deciding which ring a motari is in,
  //      a coarse position now beats a precise one never.
  //
  // Only when both fail does the driver see the banner, and the
  // fail-closed contract is exactly as before: still offline, still
  // retryable, no silent lie.
  const handleGoOnline = async () => {
    setSyncIssue(null);
    let coords: { lat: number; lng: number };
    try {
      try {
        coords = await geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          maximumAge: 120_000,
          timeout: 25_000,
        });
      } catch {
        coords = await geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 10_000,
        });
      }
    } catch (err: any) {
      const key = err?.code === 'unsupported' ? 'journey.geoNotSupported' : 'journey.geoFailed';
      showToast(t(key), 'error');
      setSyncIssue('go-online');
      return;
    }
    setCurrentPosition({ lat: coords.lat, lng: coords.lng });
    try {
      await updateLocation(coords.lat, coords.lng);
      // G3 — also flip the server's isOnline column (the location
      // write never did; see sendOnlineStatus). Both writes must
      // confirm before the UI claims "online".
      await sendOnlineStatus(true);
    } catch {
      setSyncIssue('go-online');
      return;
    }
    // Server confirmed the writes — only now flip to online.
    setIsOnline(true);
    fetchNearbyRequests(coords.lat, coords.lng);
    // LOCATION-LIFE A G2 — and hand the heartbeat to the app. From here
    // it is no longer this page's to keep or to lose.
    markOnline(true);
  };

  const handleGoOffline = async () => {
    setSyncIssue(null);
    setIsOnline(false);
    setNearbyRequests([]);
    try {
      await stopLocationTracking();
    } catch {
      // Tracking is stopped and the UI is offline (the driver's intent),
      // but the server may still list them as online — say so, retryably.
      setSyncIssue('go-offline');
    }
  };

  const handleToggleOnline = async () => {
    userToggledRef.current = true;
    setIsTogglingStatus(true);
    try {
      if (isOnline) await handleGoOffline();
      else await handleGoOnline();
    } finally {
      setIsTogglingStatus(false);
    }
  };

  // Retry action matching what actually failed.
  const handleSyncRetry = async () => {
    if (syncIssue === 'go-online') {
      await handleToggleOnline();
    } else if (syncIssue === 'tracking') {
      // LOCATION-LIFE A G2 — retry the heartbeat itself, off the beat.
      // A success clears the banner through the same store the periodic
      // beat reports into.
      await pingDriverLivenessNow();
    } else if (syncIssue === 'go-offline') {
      try {
        await sendOfflineStatus();
        setSyncIssue(null);
      } catch {
        // Still failing — the banner stays.
      }
    }
  };

  // FEED-CONTRACT G3 — the driver's online state survives the app
  // closing. Read the server's truth on mount (GET /api/users/me →
  // driverProfile.isOnline, the column PUT /me/online-status writes)
  // and, when the server has this driver online, run the exact
  // go-online chain — GPS fix → confirmed writes → only then "online"
  // — so BOOK-UNBLOCK G4's discipline holds: the UI never claims
  // online on anything but server-confirmed truth. A failed or
  // unknown restore stays visibly offline with the existing retryable
  // banner (retry runs the same go-online chain).
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const restoreOnlineState = async () => {
      try {
        const res = await apiFetch(`/api/users/me`, { credentials: 'include' });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        const me = (data as { user?: unknown })?.user ?? data;
        const profile = (me as { driverProfile?: { isOnline?: boolean; verificationStatus?: string } })
          ?.driverProfile;
        // The driver tapped the toggle while we were reading — their
        // intent wins over the restore.
        if (userToggledRef.current) return;
        // A REVOKED driver cannot come online (server enforces this on
        // the write side too); anything not explicitly online restores
        // as offline — the default state, no banner.
        if (profile?.verificationStatus === 'REVOKED') return;
        if (profile?.isOnline === true) {
          await handleGoOnline();
        }
      } catch {
        if (userToggledRef.current) return;
        // Unknown server state: stay visibly offline — never an
        // optimistic lie — and surface the existing retry banner.
        setSyncIssue('go-online');
      }
    };
    void restoreOnlineState();
    // Run-once mount restore; handleGoOnline's closure only touches
    // stable callbacks and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch tier status on mount
  useEffect(() => {
    const fetchTierStatus = async () => {
      try {
        const res = await apiFetch(`/api/users/me/tier-status`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setTierStatus(data);
        }
      } catch {
        // Silent fail
      }
    };
    fetchTierStatus();
  }, []);

  // R3-N-5 — surface SUSPENDED / FLAGGED state at the top of the
  // driver dashboard. Silent for ACTIVE drivers; ACTIVE callers still
  // see the "View account status" link below.
  useEffect(() => {
    const fetchAccountStatus = async () => {
      try {
        const res = await apiFetch(`/api/users/me/account-status`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setAccountStatus({ status: data.status, suspendedUntil: data.suspendedUntil });
        }
      } catch {
        // Silent fail
      }
    };
    fetchAccountStatus();
  }, []);

  // SOCKET-FIX G2 — a journey:available signal means a new job entered
  // this driver's ring: refetch the list and show a brief non-blocking
  // cue. The seq guard makes each signal fire exactly once even though
  // isOnline/currentPosition churn re-runs the effect; an offline driver
  // (or one with no fix yet) ignores the signal — the next feed poll
  // will pick the journey up.
  useEffect(() => {
    if (!availableSignal || availableSignal.seq === seenSignalSeqRef.current) return;
    seenSignalSeqRef.current = availableSignal.seq;
    if (!isOnline || !currentPosition) return;
    fetchNearbyRequests(currentPosition.lat, currentPosition.lng);
    setNewRequestCue(true);
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    cueTimerRef.current = setTimeout(() => setNewRequestCue(false), 5000);
  }, [availableSignal, isOnline, currentPosition, fetchNearbyRequests]);

  // Cleanup on unmount.
  //
  // LOCATION-LIFE A G2 — the location interval is deliberately NOT here
  // any more, and nothing may put it back. Clearing the heartbeat on
  // this page's unmount is precisely the defect: leaving the dashboard
  // is not going offline, and the motari's presence in discovery must
  // not depend on which screen he is looking at. Only the cue timer,
  // which is genuinely this page's, is cleared.
  useEffect(() => {
    return () => {
      if (cueTimerRef.current) {
        clearTimeout(cueTimerRef.current);
      }
    };
  }, []);

  const formatTimeAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return t('dashboard.justNow');
    if (diff < 3600) return t('dashboard.minutesAgo', { n: Math.floor(diff / 60) });
    return t('dashboard.hoursAgo', { n: Math.floor(diff / 3600) });
  };

  // DRIVER-ID v3 — REVOKED is terminal: a calm notice replaces the whole
  // driver dashboard (no online toggle, no bidding UI). Deliberately
  // neutral styling — this is an end-state statement, not a warning.
  if (user?.driverProfile?.verificationStatus === 'REVOKED') {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-10">
        <div
          data-testid="driver-revoked-notice"
          className="max-w-md mx-auto bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-700"
        >
          {t('driver.revokedNotice')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Status Toggle */}
      <div className={`px-4 py-5 text-center ${isOnline ? 'bg-[#27AE60]' : 'bg-gray-700'} transition-colors duration-300`}>
        <button
          onClick={handleToggleOnline}
          disabled={isTogglingStatus}
          className="min-h-[52px] px-8 py-3 rounded-full bg-white/20 text-white text-heading font-bold hover:bg-white/30 transition-colors disabled:opacity-50"
        >
          {isTogglingStatus ? (
            <Spinner size="sm" className="mx-auto" />
          ) : isOnline ? (
            t('dashboard.imOnline')
          ) : (
            t('dashboard.imOffline')
          )}
        </button>
        {isOnline && (
          <p className="text-white/80 text-caption mt-2">{t('dashboard.onlineSubtitle')}</p>
        )}
      </div>

      {/* BOOK-UNBLOCK G4 — location-sync trouble is visible and
          retryable, never a stale "I'm online". */}
      {syncIssue && (
        <div
          data-testid="location-sync-banner"
          data-issue={syncIssue}
          role="alert"
          className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#E74C3C]/30 bg-[#E74C3C]/10 px-4 py-3"
        >
          <span className="text-secondary font-medium text-[#E74C3C]">
            {t(SYNC_ISSUE_COPY[syncIssue])}
          </span>
          <button
            type="button"
            data-testid="location-sync-retry"
            onClick={handleSyncRetry}
            disabled={isTogglingStatus}
            className="min-h-[44px] px-3 flex-shrink-0 rounded-lg border border-[#E74C3C] text-secondary font-semibold text-[#E74C3C] hover:bg-[#E74C3C]/10 transition-colors disabled:opacity-50"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* WIRE-FIX G3 — resume-into-active-ride affordance: while this
          driver has a MATCHED/IN_PROGRESS journey, one tap returns to
          the approach/ride/goods screen for its state. */}
      <div className="px-4 mt-4">
        {/* FIELD-FIT G5 — the banner already resolves "is this motari
            mid-ride?"; reuse that answer rather than asking again, so
            the empty feed below can name its real reason. */}
        <ActiveJourneyBanner role="driver" onActiveChange={setHasActiveRide} />
      </div>

      {/* FIELD-FIT G3 — the way back to the documents screen.
          The team reported a motari has "no way of adding documents
          (licence, id, driving permit, insurance)", and they were right:
          /driver/verification was navigated to from exactly one place in
          the whole app — DriverScreenerPage, a one-shot onboarding
          screen. Leave it, back out of it, or reinstall, and the door
          was gone. This is the door, on the screen the motari actually
          lands on, for as long as he is not VERIFIED (PENDING and
          UNDER_REVIEW included — a pending driver still needs to add a
          document he forgot, and REJECTED needs it most of all). */}
      {user?.driverProfile &&
        user.driverProfile.verificationStatus !== 'VERIFIED' && (
          <button
            onClick={() => navigate('/driver/verification')}
            data-testid="dashboard-verification-banner"
            data-status={user.driverProfile.verificationStatus}
            className="mx-4 mt-4 w-[calc(100%-2rem)] block rounded-xl border border-[#1B4F72]/30 bg-[#1B4F72]/5 px-4 py-3 text-left"
          >
            <span className="block text-secondary font-semibold text-[#1B4F72]">
              {t('verification.dashboardBannerTitle')}
            </span>
            <span className="block text-caption text-gray-600 mt-0.5">
              {t('verification.dashboardBannerBody')}
            </span>
          </button>
        )}

      {/* R3-N-5 — Account status banner (only for SUSPENDED / FLAGGED). */}
      {accountStatus && accountStatus.status !== 'ACTIVE' && (
        <button
          onClick={() => navigate('/driver/account')}
          data-testid="dashboard-account-status-banner"
          data-status={accountStatus.status}
          className={`mx-4 mt-4 w-[calc(100%-2rem)] block rounded-xl border px-4 py-3 text-secondary font-semibold text-left ${
            accountStatus.status === 'FLAGGED'
              ? 'bg-[#E74C3C]/10 text-[#E74C3C] border-[#E74C3C]/30'
              : 'bg-yellow-50 text-yellow-700 border-yellow-300'
          }`}
        >
          {accountStatus.status === 'FLAGGED'
            ? t('account.statusFlagged')
            : t('account.statusSuspended', {
                until: accountStatus.suspendedUntil
                  ? new Date(accountStatus.suspendedUntil).toLocaleString()
                  : '',
              })}
        </button>
      )}

      {/* R3-N-5 — Always-visible link to the full account-status page. */}
      <div className="px-4 mt-4">
        <button
          onClick={() => navigate('/driver/account')}
          className="text-caption text-[#1B4F72] underline"
        >
          {t('account.viewAccount')}
        </button>
      </div>

      {/* Tier Status Card */}
      {tierStatus?.driverTier && (
        <div className="mx-4 mt-4 bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-secondary font-semibold text-gray-900">
              {t('transparency.yourTier', { tier: tierStatus.driverTier.currentTier, rate: (tierStatus.driverTier.commissionRate * 100).toFixed(1) })}
            </span>
            <span className="text-caption font-medium text-[#1B4F72]">
              {(tierStatus.driverTier.commissionRate * 100).toFixed(1)}%
            </span>
          </div>
          {/* Progress bar */}
          {tierStatus.driverTier.nextTier ? (
            <>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                <div
                  className="bg-[#1B4F72] h-2.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (tierStatus.driverTier.totalRides / (tierStatus.driverTier.totalRides + tierStatus.driverTier.ridesUntilNextTier)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-caption text-gray-500">
                {t('transparency.ridesUntilNextTier', {
                  count: tierStatus.driverTier.ridesUntilNextTier,
                  tier: tierStatus.driverTier.nextTier,
                  rate: tierStatus.driverTier.nextTierRate ? (tierStatus.driverTier.nextTierRate * 100).toFixed(1) : '',
                })}
              </p>
            </>
          ) : (
            <p className="text-caption text-green-700 font-medium">{t('transparency.atMaxTier')}</p>
          )}
          {tierStatus.driverTier.commissionRate < 0.03 && (
            <p className="text-caption text-green-700 mt-1">
              {t('transparency.tierSavingsPerRide', {
                rate: ((0.03 - tierStatus.driverTier.commissionRate) * 100).toFixed(1),
              })}
            </p>
          )}
        </div>
      )}

      {/* PAYOUT-C — today's balance + payout schedule + pay-me-now. */}
      <DriverEarningsCard />

      {/* R3-DRIVER-TIER-STATS — per-driver self-assessment widget. */}
      <DriverStatsCard />

      {/* Ride Requests */}
      <div className="px-4 py-4">
        {/* SOCKET-FIX G2 — subtle live-update cue: no modal, no sound. */}
        {isOnline && newRequestCue && (
          <div
            data-testid="new-request-cue"
            role="status"
            aria-live="polite"
            className="mb-3 rounded-lg bg-[#27AE60]/10 border border-[#27AE60]/30 px-3 py-2 text-secondary font-medium text-[#27AE60]"
          >
            {t('dashboard.newRequestNearby')}
          </div>
        )}
        {!isOnline ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-secondary">{t('dashboard.goOnline')}</p>
          </div>
        ) : isLoading && nearbyRequests.length === 0 ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : loadFailed && nearbyRequests.length === 0 ? (
          <ErrorState
            onRetry={() => {
              if (currentPosition) fetchNearbyRequests(currentPosition.lat, currentPosition.lng);
            }}
          />
        ) : nearbyRequests.length === 0 && hasActiveRide ? (
          // FIELD-FIT G5 — the server keeps an engaged motari off the
          // feed on purpose. Saying "no requests nearby" here would be a
          // lie about the market; say the true reason instead.
          <div className="text-center py-12" data-testid="feed-blocked-engaged">
            <p className="text-gray-700 text-secondary font-medium">
              {t('dashboard.finishCurrentRide')}
            </p>
            <p className="text-gray-500 text-caption mt-1">
              {t('dashboard.finishCurrentRideSubtitle')}
            </p>
          </div>
        ) : nearbyRequests.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-secondary">{t('dashboard.noRequests')}</p>
            <p className="text-gray-500 text-caption mt-1">{t('dashboard.noRequestsSubtitle')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-secondary font-medium text-gray-500 uppercase tracking-wide">
              {t('dashboard.nearbyRequests', { count: nearbyRequests.length })}
            </h2>
            {nearbyRequests.map((request: any) => (
              <button
                key={request.id}
                onClick={() => navigate(`/driver/bid/${request.id}`)}
                className="w-full bg-white rounded-xl shadow-sm p-4 text-left hover:shadow-md transition-shadow"
              >
                {/* R3-T — URGENT badge sits above the route line so
                    the driver spots urgent jobs at a glance.
                    R3-CHILD — child-passenger badge sits next to the
                    urgent one; both can apply on the same journey. */}
                {/* LIVE-WIRE G5 — the field's item 15, answered in words.
                    A request that returns to the feed after a match is
                    the deliberate unpaid-release (#155/#156): the
                    passenger's payment never completed, so the ride was
                    given back to everyone. Saying so turns "why is this
                    here again?" into a fact the motari can act on. */}
                {request.reopenedUnpaid && (
                  <p
                    data-testid="request-reopened-unpaid"
                    className="mb-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1"
                  >
                    {t('dashboard.reopenedUnpaid')}
                  </p>
                )}
                <div className="mb-2 flex flex-wrap gap-1">
                  {/* PARCEL-VISIBLE G4 — the field's report was "the driver
                      cannot tell a parcel from a passenger". UrgentBadge
                      cannot say it: its contract is null for anything that
                      is not one of the two messenger tiers, so a plain
                      GOODS parcel carried no marker at all. The two badges
                      compose — an urgent parcel is a parcel, in a hurry. */}
                  <ParcelBadge journeyType={request.type} size="sm" />
                  <UrgentBadge
                    journeyType={request.type}
                    size="sm"
                    matchedAt={(request as any).matchedAt ?? request.createdAt}
                  />
                  <ChildPassengerBadge
                    hasChildPassenger={(request as any).hasChildPassenger}
                    size="sm"
                  />
                  {/* SCHED-UI G4 — scheduled rides appear in the feed
                      once their bid window opens; flag the fixed pickup
                      time so drivers bid with the commitment in view. */}
                  {request.bookingMode === 'SCHEDULED' && request.scheduledFor && (
                    <span
                      data-testid="scheduled-feed-badge"
                      className="inline-flex items-center px-2 py-0.5 rounded text-caption font-medium bg-[#1B4F72]/10 text-[#1B4F72]"
                    >
                      {t('scheduled.badgePickup', {
                        time: formatScheduledDateTime(request.scheduledFor),
                      })}
                    </span>
                  )}
                </div>

                {/* Route */}
                <div className="flex items-center gap-2 text-secondary text-gray-600 mb-1">
                  <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">{request.pickupName}</span>
                </div>
                <div className="flex items-center gap-2 text-secondary text-gray-600 mb-3">
                  <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">{request.destinationName}</span>
                </div>

                {/* PARCEL-VISIBLE G4 — what prices a parcel run. Every one
                    of these fields has been on the wire since the parcel
                    form shipped and none of them reached this card. */}
                {/* PARCEL-CATEGORY — and what is IN the box, on the card
                    where he decides whether to open the request at all. */}
                <ParcelSummary
                  sizeCategory={request.goodsSizeCategory}
                  weightKg={request.goodsWeightKg}
                  fragile={request.goodsFragile}
                  description={request.goodsDescription}
                  category={request.parcelCategory}
                />

                {/* Details row */}
                <div className="flex items-center gap-3 text-caption text-gray-500 flex-wrap">
                  {/* PARCEL-VISIBLE G4 — these two chips were dead since
                      birth: `distance` and `vehicleType` are not fields on
                      Journey. The real names are `estimatedDistance` and
                      `vehiclePreference`, and estimatedDistance is already
                      in KILOMETRES (utils/geo.haversineDistance returns km),
                      so the old /1000 went with the old field name. */}
                  {typeof request.estimatedDistance === 'number' && (
                    <span
                      data-testid="request-distance"
                      className="bg-gray-100 px-2 py-1 rounded"
                    >
                      {request.estimatedDistance.toFixed(1)} km
                    </span>
                  )}
                  {/* A null preference is not "unknown": the server treats
                      it as any vehicle may take this (the feed's own
                      vehicle filter passes every driver on it), so the card
                      says so rather than hiding the chip. */}
                  <span
                    data-testid="request-vehicle"
                    className="bg-gray-100 px-2 py-1 rounded"
                  >
                    {/* PILOT-UX G4 — vehicleTypes.* never existed in any
                        locale; label via the shared compliance matrix. */}
                    {request.vehiclePreference
                      ? t(getVehicleCompliance(request.vehiclePreference).nameKey)
                      : t('journey.any_vehicle')}
                  </span>
                  {request.wishPrice && (
                    <ValuePulse
                      value={request.wishPrice}
                      className="bg-[#1B4F72]/10 text-[#1B4F72] px-2 py-1 rounded font-medium"
                    >
                      {request.wishPrice.toLocaleString()} RWF
                    </ValuePulse>
                  )}
                  {request.createdAt && (
                    <span className="ml-auto">{formatTimeAgo(request.createdAt)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
