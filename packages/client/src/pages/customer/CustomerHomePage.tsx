// PAGES/CUSTOMER/CUSTOMER-HOME-PAGE.TSX
//
// PILOT-UX-2 G3 — the customer home at '/'. The map is the background
// of the whole customer experience (founder direction); the sheet over
// it presents the ride/parcel fork:
//
//   "Request a ride"  → /journey/new   (passenger flow, type PASSENGER)
//   "Send a parcel"   → /journey/goods (goods flow — urgency tiers live
//                                       INSIDE that flow, not here)
//
// Urgency tiers are parcel/messenger concepts, so the old
// priority/urgent home tiles moved behind the parcel fork. Upcoming
// scheduled rides (SCHED-UI) render in the sheet, same surface the
// customer always saw them on ('/').

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MapCanvas } from '../../components/map/MapCanvas';
import { BottomSheet, type SheetState } from '../../components/map/BottomSheet';
import { UpcomingRidesSection } from '../../components/journey/UpcomingRidesSection';
import { ActiveJourneyBanner } from '../../components/journey/ActiveJourneyBanner';

const RideIcon = (
  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const ParcelIcon = (
  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

export const CustomerHomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Map dominant on home: the sheet peeks with the fork visible and
  // expands on demand (or automatically when the map can't load).
  const [sheetState, setSheetState] = useState<SheetState>('collapsed');

  return (
    <>
      <MapCanvas centerOnUser onUnavailable={() => setSheetState('expanded')} />
      <BottomSheet
        state={sheetState}
        onStateChange={setSheetState}
        collapsedHeight={260}
      >
        <div className="w-full max-w-sm mx-auto px-4 pb-6">
          {/* WIRE-FIX G3 — resume-into-active-ride affordance, above the
              fork so it is visible even in the collapsed sheet. */}
          <ActiveJourneyBanner role="customer" />
          <h1 className="text-title font-bold text-[#1B4F72] mb-3">
            {t('home.title')}
          </h1>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={() => navigate('/journey/new')}
              data-testid="home-fork-ride"
              className="flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 bg-white hover:border-[#1B4F72] hover:bg-blue-50/40 transition-colors text-left min-h-[44px]"
            >
              <span className="text-[#1B4F72]">{RideIcon}</span>
              <span className="text-secondary font-semibold text-gray-900">
                {t('home.requestRide')}
              </span>
              <span className="text-caption text-gray-500">
                {t('home.requestRideHint')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/journey/goods')}
              data-testid="home-fork-parcel"
              className="flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 bg-white hover:border-[#1B4F72] hover:bg-blue-50/40 transition-colors text-left min-h-[44px]"
            >
              <span className="text-[#1B4F72]">{ParcelIcon}</span>
              <span className="text-secondary font-semibold text-gray-900">
                {t('home.sendParcel')}
              </span>
              <span className="text-caption text-gray-500">
                {t('home.sendParcelHint')}
              </span>
            </button>
          </div>

          {/* SCHED-UI G2 — upcoming scheduled rides (renders nothing
              while the customer has none). Lives on the same '/'
              surface it always did. */}
          <UpcomingRidesSection />
        </div>
      </BottomSheet>
    </>
  );
};

export default CustomerHomePage;
