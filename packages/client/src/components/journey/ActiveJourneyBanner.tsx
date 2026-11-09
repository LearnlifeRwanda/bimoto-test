import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useJourneyStore } from '../../stores/journey.store';
import { useAuthStore } from '../../stores/auth.store';
import { JourneyStatus, JourneyType } from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

// WIRE-FIX G3 — the no-push way back into an active ride
// (wiring-report §1.2). Push deep links remain the fast path; this
// banner is the fallback for a user who missed or disabled push: it
// sits on the home screens ('/' and '/driver') and, while the user has
// a journey in an active state, offers one tap back to the correct
// screen for role and state:
//
//   customer  MATCHED      → /journey/:id/matched
//   customer  IN_PROGRESS  → /journey/:id/progress
//   driver    MATCHED      → /driver/approach/:id
//   driver    IN_PROGRESS  → /driver/ride/:id   (PASSENGER)
//                          → /driver/goods/:id  (parcel types)
//
// AWAITING_CONFIRMATION was deliberately NOT a banner state, because
// "the customer confirm flow is an open founder decision (report §1.3)
// and this dispatch must not wire it".
//
// TEAM-ANSWERS G5 — that decision is now made. OPEN DECISIONS item 16b
// (Kigali team, 18 August): both the driver and the passenger confirm
// the ride is done. The driver's half is the End tap he already has;
// the passenger's half is the confirm endpoint that has been sitting
// orphaned since ConfirmPage was deleted (#163). So the status joins
// the customer list, and the fall-through below routes it to
// /journey/:id/progress, where the confirm affordance now lives — the
// screen the passenger is already on when the driver taps End.
//
// State sourcing reuses what already exists — no new data paths:
// the journey store's activeJourney (in-session), and to survive an
// app restart, the same wired endpoints the screens themselves use:
// the customer home refetches GET /api/journeys (the caller's own
// journeys, as HistoryPage does); the driver home finds its latest
// ACCEPTED bid via GET /api/bids/my-history and reads that journey
// from GET /api/journeys/:id (every in-ride screen's loader).
// GET /api/journeys did not used to be able to serve the driver side:
// its driver branch was the discovery feed and nothing else (no
// driverId filter, location required).
//
// RIDES-REACH G1 — that is no longer true. The arm forks now, and
// `?history=true` (or any non-discovery status) answers with
// `where: { driverId }` and needs no coordinate, so this restore COULD
// be one call instead of two. It is deliberately left alone: the
// bids→journey path is wired, tested and correct, and rewriting a
// working restore is not what this read-scope dispatch is for. Noted
// here so the next banner dispatch knows the option exists.

// LIVE-WIRE G5 — REQUESTED joins the customer's list.
//
// The field's item 31: a passenger who leaves the waiting-for-driver
// page is stranded. That was literally true — CustomerHomePage
// navigates only to /journey/new and /journey/goods, HistoryPage links
// out only for COMPLETED journeys, and this banner started at MATCHED.
// Nothing anywhere routed back to /journey/:id/bids, so an open request
// became unreachable the moment its screen was left.
//
// REQUESTED is a customer-only banner state: on the driver side the
// same status means "somebody else's open request", which is the feed,
// not a ride to resume (and the driver branch resolves through his own
// ACCEPTED bid anyway, so it could never surface one).
const ACTIVE_STATUSES: string[] = [
  JourneyStatus.MATCHED,
  JourneyStatus.IN_PROGRESS,
];

const CUSTOMER_ACTIVE_STATUSES: string[] = [
  JourneyStatus.REQUESTED,
  ...ACTIVE_STATUSES,
  // TEAM-ANSWERS G5 — customer-only, and rightly so: on the driver's
  // side the ride is over the moment he taps End, and the 2-hour
  // auto-confirm needs nothing from him.
  JourneyStatus.AWAITING_CONFIRMATION,
];

interface ActiveJourneyBannerProps {
  role: 'customer' | 'driver';
  /**
   * FIELD-FIT G5 — told whenever this component's answer to "is this
   * person mid-ride?" changes. The driver dashboard uses it to say
   * "finish your current ride first" instead of "no requests nearby"
   * when the server has (correctly) sent an empty feed. Reusing the
   * banner's own resolution keeps one source of that truth on the
   * client; optional, so every existing caller is unchanged.
   */
  onActiveChange?: (isActive: boolean) => void;
}

export const ActiveJourneyBanner: React.FC<ActiveJourneyBannerProps> = ({
  role,
  onActiveChange,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const storeJourney = useJourneyStore((s) => s.activeJourney);
  const userId = useAuthStore((s) => s.user?.id);
  const [fetchedJourney, setFetchedJourney] = useState<any | null>(null);

  // A BOTH-role user can hold a journey on either side; the banner on
  // each home must only surface the journey that belongs to that
  // home's role, and must never send a customer into the driver
  // screens (or back).
  const belongsToRole = (j: any): boolean =>
    role === 'customer' ? j?.customerId === userId : j?.driverId === userId;

  // G5 — the customer's list additionally carries REQUESTED (see above).
  const activeStatuses = role === 'customer' ? CUSTOMER_ACTIVE_STATUSES : ACTIVE_STATUSES;

  // Restore after an app restart, when the store is empty. Additive
  // and best-effort like UpcomingRidesSection — but a failure at least
  // debug-logs (the WIRE-FIX G2 posture).
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        if (role === 'customer') {
          const res = await apiFetch(`/api/journeys`, { credentials: 'include' });
          if (!res.ok) {
            console.debug('active-journey restore failed:', res.status);
            return;
          }
          const journeys = await res.json();
          if (cancelled || !Array.isArray(journeys)) return;
          const active = journeys.find((j: any) => activeStatuses.includes(j?.status));
          if (active) setFetchedJourney(active);
          return;
        }
        const bidsRes = await apiFetch(`/api/bids/my-history`, { credentials: 'include' });
        if (!bidsRes.ok) {
          console.debug('active-journey restore failed:', bidsRes.status);
          return;
        }
        const bids = await bidsRes.json();
        if (cancelled || !Array.isArray(bids)) return;
        const accepted = bids.find((b: any) => b?.status === 'ACCEPTED');
        if (!accepted?.journeyId) return;
        const journeyRes = await apiFetch(`/api/journeys/${accepted.journeyId}`, {
          credentials: 'include',
        });
        if (!journeyRes.ok) {
          console.debug('active-journey restore failed:', journeyRes.status);
          return;
        }
        const journey = await journeyRes.json();
        if (cancelled) return;
        if (activeStatuses.includes(journey?.status)) setFetchedJourney(journey);
      } catch (err) {
        console.debug('active-journey restore failed:', err);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [role]);

  // The store wins while it holds a journey (it is live-updated by the
  // socket layer); the fetched copy covers the fresh-boot case.
  const journey =
    storeJourney && activeStatuses.includes(storeJourney.status) && belongsToRole(storeJourney)
      ? storeJourney
      : fetchedJourney &&
          activeStatuses.includes(fetchedJourney.status) &&
          belongsToRole(fetchedJourney)
        ? fetchedJourney
        : null;

  const isActive = journey !== null;
  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  if (!journey) return null;

  const isPassenger = journey.type === JourneyType.PASSENGER;
  const isMatched = journey.status === JourneyStatus.MATCHED;
  const isRequested = journey.status === JourneyStatus.REQUESTED;

  const openJourney = () => {
    if (role === 'customer') {
      // G5 — the way back to an open request's offers.
      if (isRequested) {
        navigate(`/journey/${journey.id}/bids`);
        return;
      }
      if (isMatched) {
        navigate(`/journey/${journey.id}/matched`);
      } else {
        navigate(`/journey/${journey.id}/progress`);
      }
      return;
    }
    if (isMatched) {
      navigate(`/driver/approach/${journey.id}`);
    } else if (isPassenger) {
      navigate(`/driver/ride/${journey.id}`);
    } else {
      navigate(`/driver/goods/${journey.id}`);
    }
  };

  const stateLabel = isRequested
    ? t('activeJourney.waitingForOffers')
    : isMatched
    ? role === 'customer'
      ? t('activeJourney.matchedCustomer')
      : t('activeJourney.matchedDriver')
    : isPassenger
      ? t('activeJourney.inProgressRide')
      : t('activeJourney.inProgressDelivery');

  return (
    <button
      type="button"
      onClick={openJourney}
      data-testid="active-journey-banner"
      data-journey-status={journey.status}
      className="w-full flex items-center justify-between gap-3 rounded-xl bg-[#1B4F72] px-4 py-3 text-left shadow-md hover:bg-[#163f5c] transition-colors min-h-[44px] mb-4"
    >
      <span className="flex flex-col min-w-0">
        <span className="text-secondary font-bold text-white">
          {isPassenger ? t('activeJourney.titleRide') : t('activeJourney.titleDelivery')}
        </span>
        <span className="text-caption text-white/80 truncate">{stateLabel}</span>
      </span>
      <span className="flex items-center gap-1 flex-shrink-0 text-caption font-semibold text-white">
        {t('activeJourney.resume')}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </button>
  );
};
