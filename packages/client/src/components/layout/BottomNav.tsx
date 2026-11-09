import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';

interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ReactNode;
}

const HomeIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
  </svg>
);

const SearchIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
  </svg>
);

const ListIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);

const PersonIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

// SCHED-UI G4 — calendar icon for the driver's scheduled-rides tab.
const CalendarIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

// PILOT-UX-2 G1 — every target below MUST exist in the App route table:
// the customer home is '/' and the driver home is '/driver' (the old
// '/home' and '/requests' targets 404'd on the pilot phone). The
// nav-route-integrity test imports NAV_TABS_BY_ROLE and fails CI when
// any target stops matching a declared route.
const customerTabs: NavItem[] = [
  { path: '/', labelKey: 'nav.home', icon: HomeIcon },
  { path: '/rides', labelKey: 'nav.myRides', icon: ListIcon },
  { path: '/profile', labelKey: 'nav.profile', icon: PersonIcon },
];

// FIELD-FIT G4 — the motari's tabs used to open on "Requests" with a
// magnifying glass, and the team noticed there was no Home. His home is
// '/driver' (roleHomePath agrees, and it is where login lands him): the
// dashboard carries the online toggle, his tier, his money banner AND
// the nearby-request feed. So the first tab is named and drawn as Home
// rather than as a search — one screen, called what it is.
//
// '/' is deliberately NOT a driver tab: that route renders the
// passenger's ride/parcel fork, which is not this person's home. Where
// somebody is landed by role is Trello item 2 and stays untouched.
//
// Note this was invisible in the field until the role flip was fixed
// (G3): createDriverProfile made almost every motari BOTH, and bothTabs
// does start with Home. Real DRIVER accounts now exist, and they need
// this.
const driverTabs: NavItem[] = [
  { path: '/driver', labelKey: 'nav.home', icon: HomeIcon },
  { path: '/driver/scheduled', labelKey: 'nav.scheduled', icon: CalendarIcon },
  { path: '/rides', labelKey: 'nav.myRides', icon: ListIcon },
  { path: '/profile', labelKey: 'nav.profile', icon: PersonIcon },
];

const bothTabs: NavItem[] = [
  { path: '/', labelKey: 'nav.home', icon: HomeIcon },
  { path: '/driver', labelKey: 'nav.requests', icon: SearchIcon },
  { path: '/driver/scheduled', labelKey: 'nav.scheduled', icon: CalendarIcon },
  { path: '/rides', labelKey: 'nav.myRides', icon: ListIcon },
  { path: '/profile', labelKey: 'nav.profile', icon: PersonIcon },
];

export const NAV_TABS_BY_ROLE = {
  CUSTOMER: customerTabs,
  DRIVER: driverTabs,
  BOTH: bothTabs,
} as const;

export const BottomNav: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  const role = user?.role || 'CUSTOMER';
  let tabs: NavItem[];
  if (role === 'BOTH') {
    tabs = bothTabs;
  } else if (role === 'DRIVER') {
    tabs = driverTabs;
  } else {
    tabs = customerTabs;
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 h-16 pb-[env(safe-area-inset-bottom)]"
      role="tablist"
      aria-label={t('nav.main')}
    >
      <div className="flex items-center justify-around h-full max-w-lg mx-auto">
        {tabs.map((tab) => {
          // Longest-prefix match so '/driver' and '/driver/scheduled'
          // never highlight together ('/' only matches exactly — every
          // pathname trivially starts with '/').
          const matches = (p: string) =>
            location.pathname === p || (p !== '/' && location.pathname.startsWith(p + '/'));
          const bestMatch = tabs
            .filter((tb) => matches(tb.path))
            .sort((a, b) => b.path.length - a.path.length)[0];
          const isActive = bestMatch?.path === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              role="tab"
              aria-selected={isActive}
              className={`
                flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-2 py-1
                transition-colors duration-150
                ${isActive ? 'text-[#1B4F72]' : 'text-gray-600 hover:text-gray-700'}
              `}
            >
              {tab.icon}
              <span className="text-xs mt-0.5 font-medium">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
