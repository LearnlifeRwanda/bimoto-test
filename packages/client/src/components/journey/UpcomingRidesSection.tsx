import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/ui.store';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatScheduledDateTime } from '../../lib/scheduled';
import { apiFetch } from '../../lib/api';

// CLEAN-SWEEP G5/§0.7 — THE TWO ENTRANCES TO ScheduledRidePage.
//
// A customer reaches the same screen from two surfaces, on two different
// queries, and neither knows about the other. This is documented rather
// than consolidated: "different surfaces, different queries, no
// duplicated component" is the accepted state, and the next
// scheduled-rides dispatch should know it before it starts rather than
// discover it halfway through.
//
//   1. THE HOME SHEET — components/journey/UpcomingRidesSection.tsx, on
//      GET /api/scheduled-rides/customer. A dedicated endpoint: the
//      server filters to future bookingMode=SCHEDULED rides and orders
//      them soonest-first, and the section renders nothing when empty.
//   2. THE RIDES LIST — pages/shared/HistoryPage.tsx ("My Journey"), on
//      GET /api/journeys?history=true. Still not a time filter: on the
//      CUSTOMER arm `history` is read and deliberately ignored, because
//      `customerId: userId` already IS her rides, so getJourneys returns
//      every journey of this customer and the screen PARTITIONS what it
//      already has (isUpcomingScheduledRide). This is the surface the
//      field reporter actually opened (team item lmHAk6VU-3).
//
//      RIDES-REACH G1 — `history` IS a declared key now
//      (journeyQuerySchema), and on the DRIVER arm it means "my rides".
//      This sheet is customer-only and unaffected; the sentence is
//      corrected here because it is the same claim, in a second file.
//
// Both navigate to /journey/:id/scheduled and share ScheduledRidePage
// itself — there is no duplicated component, only duplicated reach. The
// consequence that matters: a filtering change made on one entrance does
// NOT reach the other. CLEAN-SWEEP G2 widened the rides-list partition to
// survive the SCHEDULED -> REQUESTED window flip; the home sheet survives
// that flip for an unrelated reason — its server-side filter is already
// `status IN (SCHEDULED, REQUESTED, MATCHED) AND scheduledFor > now`
// (routes/scheduled-ride.routes.ts:113-122). Two mechanisms, one
// behaviour, and no test spans both.
//
// They are not the same set, either: the home sheet keeps a MATCHED ride
// (it is still upcoming), while the rides list deliberately hands a
// matched ride to the ordinary journey surfaces. Same screen, two
// reaches, two different answers to "which rides are upcoming" — which is
// the thing to decide deliberately before either is changed again.
// SCHED-UI G2 — "Upcoming rides" section for the customer home. Reads
// the dedicated GET /api/scheduled-rides/customer endpoint (future
// SCHEDULED/REQUESTED/MATCHED rides with bookingMode SCHEDULED, ordered
// soonest first by the server). Renders nothing while empty so the home
// surface stays uncluttered; fetch failures are silent for the same
// reason — the section is purely additive.
export const UpcomingRidesSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOnline = useUIStore((s) => s.isOnline);
  const { connected } = useNetworkStatus();
  const [rides, setRides] = useState<any[]>([]);

  useEffect(() => {
    // Offline: skip entirely — same posture as the geocode search.
    if (!isOnline || !connected) return;
    let cancelled = false;
    const fetchUpcoming = async () => {
      try {
        const res = await apiFetch(`/api/scheduled-rides/customer`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setRides(data);
      } catch {
        // Silent — the home page must render regardless.
      }
    };
    fetchUpcoming();
    return () => {
      cancelled = true;
    };
  }, [isOnline, connected]);

  if (rides.length === 0) return null;

  return (
    <div className="mb-4" data-testid="upcoming-rides-section">
      <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
        {t('scheduled.upcomingTitle')}
      </h2>
      <div className="space-y-2">
        {rides.map((ride) => (
          <button
            key={ride.id}
            type="button"
            onClick={() => navigate(`/journey/${ride.id}/scheduled`)}
            data-testid={`upcoming-ride-${ride.id}`}
            className="w-full text-left p-3 rounded-lg bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <p className="text-sm font-semibold text-[#1B4F72]">
              {ride.scheduledFor
                ? formatScheduledDateTime(ride.scheduledFor)
                : ''}
            </p>
            <p className="text-xs text-gray-600 truncate mt-0.5">
              {ride.pickupName ?? ''}
              {' → '}
              {ride.destinationName ?? ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
