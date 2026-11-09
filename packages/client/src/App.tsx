import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useAuthStore, isRegistrationPending } from './stores/auth.store';
import { useUIStore } from './stores/ui.store';
import { useSimulationStore } from './stores/simulation.store';
import { useConnectionState } from './hooks/useConnectionState';
import {
  ensureDriverLivenessRunning,
  setDriverLivenessOnline,
} from './services/driver-liveness';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';
import { syncManager } from './sync/SyncManager';
import { outboxReplay } from './sync/OutboxReplay';
import { restoreSessionAtBoot } from './lib/auth-refresh';
import { installSoundUnlock } from './lib/notification-sound';
import { apiFetch, isConnectivityError } from './lib/api';
import { readSessionSnapshot } from './lib/session-snapshot';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@bimoto/shared';
import { AppShell } from './components/layout/AppShell';
import { AppLockGate } from './components/lock/AppLockGate';
import { ScreenErrorBoundary } from './components/ScreenErrorBoundary';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import WelcomePage from './pages/onboarding/WelcomePage';
import CheckDriverPage from './pages/public/CheckDriverPage';
import ConsentPage from './pages/onboarding/ConsentPage';
import DriverVerificationPage from './pages/onboarding/DriverVerificationPage';
import DriverScreenerPage from './pages/onboarding/DriverScreenerPage';
import CustomerHomePage from './pages/customer/CustomerHomePage';
import NewJourneyPage from './pages/customer/NewJourneyPage';
import BidListPage from './pages/customer/BidListPage';
import MatchedPage from './pages/customer/MatchedPage';
import InProgressPage from './pages/customer/InProgressPage';
import GoodsRequestPage from './pages/customer/GoodsRequestPage';
import ScheduledRidePage from './pages/customer/ScheduledRidePage';
import PaymentsPage from './pages/customer/PaymentsPage';
import UrgentMessengerPage from './pages/customer/UrgentMessengerPage';
import DashboardPage from './pages/driver/DashboardPage';
import BidPage from './pages/driver/BidPage';
import ApproachPage from './pages/driver/ApproachPage';
import ActiveRidePage from './pages/driver/ActiveRidePage';
import GoodsPickupPage from './pages/driver/GoodsPickupPage';
import NoShowDisputesPage from './pages/driver/NoShowDisputesPage';
import ScheduledRidesPage from './pages/driver/ScheduledRidesPage';
import AccountPage from './pages/driver/AccountPage';
import AutoBidRulesPage from './pages/driver/AutoBidRulesPage';
import ProfilePage from './pages/shared/ProfilePage';
import RideReceiptPage from './pages/shared/RideReceiptPage';
import UserGuidePage from './pages/shared/UserGuidePage';
import SettingsPage from './pages/shared/SettingsPage';
import DeleteAccountPage from './pages/shared/DeleteAccountPage';
import MapsSettingsPage from './pages/shared/MapsSettingsPage';
import DiagnosticsPage from './pages/shared/DiagnosticsPage';
import ChatPage from './pages/shared/ChatPage';
import HistoryPage from './pages/shared/HistoryPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminVerifications from './pages/admin/AdminVerifications';
import AdminDisputes from './pages/admin/AdminDisputes';
import AdminFlaggedUsers from './pages/admin/AdminFlaggedUsers';
import AdminDeletionRequests from './pages/admin/AdminDeletionRequests';
import AdminConflicts from './pages/admin/AdminConflicts';
import AdminFunnel from './pages/admin/AdminFunnel';
import AdminConflictsList from './pages/admin/AdminConflictsList';
import AdminConflictDetail from './pages/admin/AdminConflictDetail';
import AdminConflictAudit from './pages/admin/AdminConflictAudit';
import AdminPayouts from './pages/admin/AdminPayouts';
import AdminPayoutDriver from './pages/admin/AdminPayoutDriver';
import AdminErrorReports from './pages/admin/AdminErrorReports';
import AdminEmergency from './pages/admin/AdminEmergency';
import IntelPage from './pages/intel/IntelPage';
import { AdminEmergencyAlerts } from './components/admin/AdminEmergencyAlerts';
import NotFoundPage from './pages/NotFoundPage';
import { Toast } from './components/ui/Toast';
import { AccountFrozenNotice } from './components/ui/AccountFrozenNotice';
import { SimulationBanner } from './components/ui/SimulationBanner';
import { DeletionBanner } from './components/ui/DeletionBanner';
import { prefs, PREF_KEYS } from './hooks/usePreferences';

function needsConsent(user: any): boolean {
  if (!user) return false;
  if (!user.privacyConsentAt || user.privacyConsentVersion !== CURRENT_PRIVACY_VERSION) return true;
  if (!user.termsAcceptedAt || user.termsAcceptedVersion !== CURRENT_TERMS_VERSION) return true;
  return false;
}

export function ProtectedRoute({
  children,
  allowAnalyst = false,
}: {
  children: React.ReactNode;
  // INTEL-DECK G4 — an ANALYST's world is /intel plus the shared basics
  // (settings, guide, diagnostics). Every other protected route sends
  // them back to the reading room rather than rendering a booking flow
  // for somebody who can never book. Opt-in rather than opt-out on
  // purpose: a route added tomorrow is closed to the analyst until
  // somebody decides otherwise.
  allowAnalyst?: boolean;
}) {
  const state = useAuthStore();
  const { isAuthenticated, isLoading, user, offlineSession } = state;
  if (isLoading) return null;
  // OUTBOX G4 — a signed-in motari who reopens the app in a dead zone
  // gets his own screens, not the login form. The boot could not REACH
  // the server to confirm the session, which is not the same thing as
  // the server denying it, and the old code treated the two identically.
  //
  // The registration and consent gates are skipped here on purpose:
  // both are answered by fields on the server's user object, which is
  // exactly what is missing. A returning user has already passed them
  // (that is what makes them a returning user), and re-asking somebody
  // to consent while offline — with no way to submit it — would be a
  // wall, not a gate. The moment the network returns, the real
  // bootstrap re-runs and both gates apply again for real.
  if (!isAuthenticated && offlineSession) return <>{children}</>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // AUTH-UX G1 — a first-time user (verify-otp said isNewUser) cannot
  // reach the app shell until RegisterPage completes: every protected
  // route — deep links and back navigation included — lands back on
  // /register while the flag is up. Registration runs BEFORE consent so
  // the chosen role drives ConsentPage's driver-onboarding redirect.
  if (isRegistrationPending(state)) return <Navigate to="/register" replace />;
  if (needsConsent(user)) return <Navigate to="/consent" replace />;
  const role = user?.role ?? offlineSession?.role;
  if (role === 'ANALYST' && !allowAnalyst) return <Navigate to="/intel" replace />;
  return <>{children}</>;
}

/**
 * INTEL-DECK G4 — the reading room's door. ADMIN and ANALYST only;
 * everybody else goes home. Mirrors AdminGuard's shape, minus the
 * emergency-alert surface, which is an operational concern an analyst
 * has no business seeing.
 */
export function IntelGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role ?? s.offlineSession?.role);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return null;
  if (role !== 'ANALYST' && role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * LIVE-WIRE G5 — the driver side is for drivers.
 *
 * The field flagged passenger phones being answered 403 on
 * `PUT /api/users/me/location`. The guard is right: the route is
 * `driverOnly` (middleware/auth.ts), which admits DRIVER and BOTH and
 * refuses CUSTOMER. The client was wrong — `/driver` sat behind
 * ProtectedRoute with no role check at all, so a CUSTOMER reaching it
 * (a stale deep link, a shared phone, a typed URL) rendered the driver
 * dashboard complete with a "Go online" button whose only possible
 * outcome was that 403.
 *
 * The fix is to stop asking, not to open the endpoint: a customer is
 * sent to their own home. BOTH keeps full access — the role exists
 * precisely so one person can do both jobs — and ADMIN is not detoured,
 * since admin tooling reaches driver screens deliberately.
 */
export function DriverRoute({ children }: { children: React.ReactNode }) {
  // OUTBOX G4 — the remembered role stands in while offline, so a
  // motari's own dashboard is reachable on a cold boot with no network.
  // The role check itself is unchanged: a CUSTOMER is still sent home.
  const role = useAuthStore((s) => s.user?.role ?? s.offlineSession?.role);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return null;
  if (role === 'CUSTOMER') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, offlineSession } = useAuthStore();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;
  // OUTBOX G4 — and a remembered user is not a visitor either: they go
  // to their own home rather than the login form or the carousel.
  if (offlineSession) return <Navigate to="/" replace />;
  // First-launch hand-off: if the welcome carousel has never been
  // dismissed on this device, route the user there before showing the
  // login form. Sync read is safe — prefs.hydrate() at boot copies the
  // native durable value into localStorage before React renders.
  if (prefs.getSync(PREF_KEYS.hasSeenWelcome) !== 'true') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

// AUTH-UX G1 — the register step's own guard. The old route wrapped
// RegisterPage in AuthRoute, whose "authenticated → /" bounce made the
// page unreachable: verify-otp calls setUser() BEFORE navigating to
// /register, so every brand-new (now authenticated) user was ejected
// straight into the app shell without ever choosing a role. Register is
// a POST-auth step: require a session, show the page only while
// registration is actually pending, and bounce returning users to home.
export function RegisterRoute({ children }: { children: React.ReactNode }) {
  const state = useAuthStore();
  if (state.isLoading) return null;
  if (!state.isAuthenticated) return <Navigate to="/login" replace />;
  if (!isRegistrationPending(state)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  // SOS-WIRE G3 — every admin route carries the emergency alert
  // surface (socket listener + persistent stacking banner).
  return (
    <>
      <AdminEmergencyAlerts />
      {children}
    </>
  );
}

function ConsentRoute({ children }: { children: React.ReactNode }) {
  const state = useAuthStore();
  const { isAuthenticated, isLoading, user } = state;
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Registration precedes consent — a deep link to /consent must not
  // let a first-time user skip the role/nickname step (G1 guard).
  if (isRegistrationPending(state)) return <Navigate to="/register" replace />;
  if (!needsConsent(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PushBridge() {
  const { user } = useAuthStore();
  usePushNotifications(user?.id ?? null);
  return null;
}

// PROFILE-RESCUE G4 — Android hardware Back: navigate router history;
// background the app at the root. Native-only (no-op on web/PWA).
function BackButtonBridge() {
  useAndroidBackButton();
  return null;
}

export default function App() {
  const { setUser, setLoading } = useAuthStore();
  // OUTBOX G4 — the remembered identity, and the handle the reconnect
  // effect uses to re-run the real bootstrap once the API answers again.
  const setOfflineSession = useAuthStore((s) => s.setOfflineSession);
  const offlineSession = useAuthStore((s) => s.offlineSession);
  const bootstrapRef = useRef<(() => Promise<void>) | null>(null);
  const setOnline = useUIStore((s) => s.setOnline);
  const setModes = useSimulationStore((s) => s.setModes);
  // COUNTER-READY G3 — the dormant switch, off the same probe.
  const setCounterBidEnabled = useSimulationStore((s) => s.setCounterBidEnabled);
  // NET-UX G1 — unified connection state (device network + API
  // reachability from sync/connectivity.ts).
  const connection = useConnectionState();

  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

    // PREPROTO-SIM G4 — learn the server's run modes so the SIMULATION
    // banner and the simulated payment path can react. Non-blocking and
    // fail-safe: on any failure the store keeps its 'live' defaults.
    const fetchModes = async () => {
      try {
        const res = await fetch(`${API_URL}/api/health`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.paymentsMode === 'simulated' || data.paymentsMode === 'live') {
          setModes(data.paymentsMode, data.smsMode === 'simulated' ? 'simulated' : 'live');
        }
        // COUNTER-READY G3 — the one-counter-per-bid experiment.
        //
        // `=== true` and nothing looser: a server too old to know the
        // field sends undefined, a degraded one may send anything, and
        // both must leave the feature asleep. Set inside the same
        // try/catch, so an unreachable health endpoint leaves the store
        // default (false) exactly as it leaves the modes at 'live' —
        // the same fail-safe rule, pointed the other way, because a
        // guess must never enable a dormant feature.
        setCounterBidEnabled(data.counterBidEnabled === true);
      } catch {
        // Offline start — modes stay 'live'; the banner only ever shows
        // on positive confirmation from the server.
      }
    };
    void fetchModes();

    const bootstrap = async () => {
      // PREPROTO-AUTH G6 / AUTH-REFRESH G1 — native session restore:
      // the Capacitor app is cross-origin to the API, so no cookie
      // survives an app restart. Exchange the securely-stored refresh
      // token for a fresh in-memory access token (rotating the refresh
      // token in the process) via the shared lib/auth-refresh.ts
      // implementation — the same exchange apiFetch uses on a 401. On
      // the web the stored token is always null, the exchange is
      // skipped, and the cookie flow below is unchanged.
      await restoreSessionAtBoot();

      try {
        const res = await apiFetch('/api/users/me');
        if (!res.ok) throw new Error('Not authenticated');
        const data = await res.json();
        setUser((data as any)?.user ?? data);
        syncManager.startMonitoring();
        // OUTBOX G3 — start draining held bookings only once a real
        // session is established. The engine re-checks the signed-in
        // user before every send, but starting it here means it never
        // even looks at the queue without one.
        outboxReplay.start();
      } catch (err) {
        // OUTBOX G4 — two failures used to look identical here, and one
        // of them was being answered wrongly:
        //
        //   the server said no  → sign out. Correct, and unchanged.
        //   we could not ASK    → sign out. Wrong, and the reason a
        //                         motari opening the app in a dead zone
        //                         met the welcome carousel.
        //
        // Only the second case restores the remembered identity, and
        // only when there is one. It grants no access — there is no
        // token — it just lets the app draw this person's own screens
        // with their API-backed panels in their offline states, instead
        // of pretending nobody has ever used this phone.
        const snapshot = isConnectivityError(err) ? readSessionSnapshot() : null;
        if (snapshot) {
          setOfflineSession(snapshot);
        } else {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
    bootstrapRef.current = bootstrap;
  }, [setUser, setLoading, setModes, setCounterBidEnabled, setOfflineSession]);

  // OUTBOX G4 — the hand-back. While a remembered identity is standing
  // in, the first moment the API is reachable again the REAL bootstrap
  // runs and the server decides: a live session replaces the stand-in
  // (setUser clears it), and a dead one takes the normal logout path
  // through apiFetch's 401 handling, which erases the snapshot too.
  // The remembered identity never outranks a server verdict; it only
  // covers the gap where there is no verdict to be had.
  useEffect(() => {
    if (connection !== 'online') return;
    if (!offlineSession) return;
    void bootstrapRef.current?.();
  }, [connection, offlineSession]);

  // Mirror the unified connection state into the UI store so existing
  // isOnline consumers (sync, GPS, journey hooks) keep working on both
  // web and native. 'unreachable' counts as not-online: when the API is
  // down the offline-first paths (cache reads, event queueing) are the
  // honest behavior, even though the device network is up.
  useEffect(() => {
    setOnline(connection === 'online');
  }, [connection, setOnline]);

  // LOCATION-LIFE A G2 — the driver heartbeat is held HERE, once, above
  // the router, and not by any page.
  //
  // FIELD-TRIAGE C1 #1/#2 — "driver goes online but gets no requests;
  // takes ~15 minutes or an app restart" — was this: the only thing
  // refreshing `driverProfile.lastLocationAt` outside a ride was a 15 s
  // interval created inside DashboardPage's go-online handler and
  // cleared by its unmount effect. Opening a bid, a chat or the account
  // screen stopped it, and 300 s later the motari had stopped existing
  // for all seven consumers of that stamp — the supply count, the
  // cascade ring, both broadcasters, the auto-bid evaluator and the
  // request feed itself — while his own screen still said "I'm online".
  //
  // App does not unmount, so liveness now outlives every navigation.
  // The runner is state-driven, never mount-driven: it follows `active`
  // (see services/driver-liveness.ts), and nothing stops it on a
  // teardown. Logging out clears `active` through session-reset.
  useEffect(() => {
    ensureDriverLivenessRunning();
  }, []);

  // The auth store's copy of the server's own `driverProfile.isOnline`
  // column is the truth the heartbeat follows: whatever the last
  // deliberate toggle (or the mount-time restore of one) wrote. A
  // customer, an analyst or a logged-out phone never matches, so the
  // module stays inert and transmits nothing.
  useEffect(() => {
    const sync = (state: { user?: { role?: string; driverProfile?: { isOnline?: boolean } } | null }) => {
      const role = state.user?.role;
      const isDriver = role === 'DRIVER' || role === 'BOTH';
      const online = state.user?.driverProfile?.isOnline === true;
      setDriverLivenessOnline(isDriver && online);
    };
    // Once for the state already in hand (a restored session can land
    // before this effect runs), then on every change.
    sync(useAuthStore.getState());
    return useAuthStore.subscribe(sync);
  }, []);

  // NOTIFY G4 — arm the Bimoto sound on the first tap.
  //
  // Every WebView creates its AudioContext suspended and will only
  // resume it inside a user gesture. A notification is never a gesture,
  // so without this the FIRST sound — and on a strict WebView every
  // sound — is silently swallowed. One listener, removed as soon as it
  // fires; failures inside are swallowed by the module.
  useEffect(() => {
    installSoundUnlock();
  }, []);

  return (
    <BrowserRouter>
      <SimulationBanner />
      {/* ACCOUNT-RIGHTS-SURFACE G2 — the deletion countdown, mounted here
          for the same reason SimulationBanner is: it must be on EVERY
          routed screen. The entry to deletion is deliberately buried; the
          way back out of it is deliberately not, and a cancel button that
          follows the person everywhere is what makes that true. Renders
          from store state only — no poll, no socket. */}
      <DeletionBanner />
      <Toast />
      {/* SOCKET-FIX G4 — blocking freeze notice; renders above all
          routes so a mid-ride freeze is seen wherever the user is. */}
      <AccountFrozenNotice />
      <PushBridge />
      <BackButtonBridge />
      {/* PROFILE-RESCUE G3 — containment for the shell-less screens
          (login, onboarding, admin): in-app recovery inside the router
          context, so the root boundary (main.tsx) stays the outer net
          only. Shell screens get the closer boundary inside AppShell. */}
      <ScreenErrorBoundary>
      {/* APP-LOCK G4 — wraps the whole route table. When the app is
          locked this renders the LockScreen INSTEAD of <Routes>, so no
          route is mounted at all: deep links and notification taps set
          the URL but nothing behind the lock renders or fetches. A route
          added tomorrow is covered by construction, because coverage is
          not a list. */}
      <AppLockGate>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        {/* DRIVER-ID v3 — public live-validity check, no guard by design
            (anyone must be able to verify a jacket number in seconds). */}
        <Route path="/check-driver" element={<CheckDriverPage />} />
        {/* FIELD-CLOSE G3 — user guide. Public like /check-driver so a
            first-time user can read it from the welcome screen before
            having an account; also linked from Profile. */}
        <Route path="/guide" element={<UserGuidePage />} />
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
        <Route path="/register" element={<RegisterRoute><RegisterPage /></RegisterRoute>} />
        <Route path="/consent" element={<ConsentRoute><ConsentPage /></ConsentRoute>} />
        {/* R3-DRIVER-SCREENER — 8-question eligibility screener.
            Sits between consent and driver verification in the driver
            onboarding flow. Reachable directly; ConsentPage redirects
            DRIVER/BOTH roles here after consent acceptance. */}
        <Route path="/driver/screener" element={<ProtectedRoute><DriverScreenerPage /></ProtectedRoute>} />
        <Route path="/driver/verification" element={<ProtectedRoute><DriverVerificationPage /></ProtectedRoute>} />
        {/* PILOT-UX-2 G3 — the customer home is the ride/parcel fork
            over the background map; the ride form itself lives at
            /journey/new. */}
        <Route path="/" element={<ProtectedRoute><AppShell><CustomerHomePage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/new" element={<ProtectedRoute><AppShell><NewJourneyPage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/goods" element={<ProtectedRoute><AppShell><GoodsRequestPage /></AppShell></ProtectedRoute>} />
        <Route path="/customer/urgent" element={<ProtectedRoute><AppShell><UrgentMessengerPage /></AppShell></ProtectedRoute>} />
        {/* R3-PRIORITY — alias route for the intermediate-urgency tier.
            Mounts the same component; UrgentMessengerPage reads the URL
            (path or ?tier= query) to decide which tier to default to. */}
        <Route path="/customer/priority" element={<ProtectedRoute><AppShell><UrgentMessengerPage /></AppShell></ProtectedRoute>} />
        {/* SCHED-UI G2 — waiting screen for a SCHEDULED journey before
            its bid window opens. */}
        <Route path="/journey/:id/scheduled" element={<ProtectedRoute><AppShell><ScheduledRidePage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/:id/bids" element={<ProtectedRoute><AppShell><BidListPage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/:id/matched" element={<ProtectedRoute><AppShell><MatchedPage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/:id/progress" element={<ProtectedRoute><AppShell><InProgressPage /></AppShell></ProtectedRoute>} />
        <Route path="/journey/:id/chat" element={<ProtectedRoute><AppShell><ChatPage /></AppShell></ProtectedRoute>} />
        {/* MONEY-UX G1 — per-ride receipt, reached from History and the
            ride-completion screen. */}
        <Route path="/journey/:id/receipt" element={<ProtectedRoute><AppShell><RideReceiptPage /></AppShell></ProtectedRoute>} />
        <Route path="/driver" element={<ProtectedRoute><DriverRoute><AppShell><DashboardPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/bid/:id" element={<ProtectedRoute><DriverRoute><AppShell><BidPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/approach/:id" element={<ProtectedRoute><DriverRoute><AppShell><ApproachPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/ride/:id" element={<ProtectedRoute><DriverRoute><AppShell><ActiveRidePage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/goods/:id" element={<ProtectedRoute><DriverRoute><AppShell><GoodsPickupPage /></AppShell></DriverRoute></ProtectedRoute>} />
        {/* SCHED-UI G4 — driver's committed future scheduled rides. */}
        <Route path="/driver/scheduled" element={<ProtectedRoute><DriverRoute><AppShell><ScheduledRidesPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/no-show-disputes" element={<ProtectedRoute><DriverRoute><AppShell><NoShowDisputesPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/driver/account" element={<ProtectedRoute><DriverRoute><AppShell><AccountPage /></AppShell></DriverRoute></ProtectedRoute>} />
        {/* TEAM-SAID G4 — reached from the driver Account screen. Not
            added to BottomNav: auto-bid is off for the pilot, and a
            permanent tab for a dark feature would be the opposite of
            what the team asked for. */}
        <Route path="/driver/auto-bid" element={<ProtectedRoute><DriverRoute><AppShell><AutoBidRulesPage /></AppShell></DriverRoute></ProtectedRoute>} />
        <Route path="/rides" element={<ProtectedRoute><AppShell><HistoryPage /></AppShell></ProtectedRoute>} />
        {/* MONEY-UX G2 — customer payment home (receipts, active ride
            payment state, how payment works). Entry from Profile. */}
        <Route path="/payments" element={<ProtectedRoute><AppShell><PaymentsPage /></AppShell></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><AppShell><ProfilePage /></AppShell></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute allowAnalyst><AppShell><SettingsPage /></AppShell></ProtectedRoute>} />
        {/* ACCOUNT-RIGHTS-SURFACE G2 — reachable ONLY from the last row of
            Settings. No nav entry, no home link, no analyst opt-in: this
            is a real user exercising a right over their own account. */}
        <Route path="/settings/delete-account" element={<ProtectedRoute><AppShell><DeleteAccountPage /></AppShell></ProtectedRoute>} />
        {/* MAP-REACH G4 — the offline-map manager's second door. Same
            OfflineMapCard the Profile screen mounts; two doors, one card. */}
        <Route path="/settings/maps" element={<ProtectedRoute allowAnalyst><AppShell><MapsSettingsPage /></AppShell></ProtectedRoute>} />
        {/* MATCH-CLOSE G4 — two taps from anywhere: Profile → Diagnostics. */}
        <Route path="/diagnostics" element={<ProtectedRoute allowAnalyst><AppShell><DiagnosticsPage /></AppShell></ProtectedRoute>} />
        {/* INTEL-DECK G5 — the reading room. ANALYST and ADMIN; the
            ProtectedRoute opts the analyst in explicitly, since every
            other protected route fences them back here. */}
        <Route path="/intel" element={<ProtectedRoute allowAnalyst><IntelGuard><AppShell><IntelPage /></AppShell></IntelGuard></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminGuard><AdminDashboard /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/verifications" element={<ProtectedRoute><AdminGuard><AdminVerifications /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/disputes" element={<ProtectedRoute><AdminGuard><AdminDisputes /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/flagged" element={<ProtectedRoute><AdminGuard><AdminFlaggedUsers /></AdminGuard></ProtectedRoute>} />
        {/* ACCOUNT-RIGHTS-SURFACE G6 — the deletion queue and, above all,
            why a due one has not run. Admin routes carry the emergency
            alert surface automatically. */}
        <Route path="/admin/deletions" element={<ProtectedRoute><AdminGuard><AdminDeletionRequests /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/conflicts" element={<ProtectedRoute><AdminGuard><AdminConflicts /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/funnel" element={<ProtectedRoute><AdminGuard><AdminFunnel /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/payouts" element={<ProtectedRoute><AdminGuard><AdminPayouts /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/payouts/driver/:driverId" element={<ProtectedRoute><AdminGuard><AdminPayoutDriver /></AdminGuard></ProtectedRoute>} />
        {/* BLACKBOX G4 — read-and-forward surface for user-sent error
            reports. Linked from the admin dashboard. */}
        <Route path="/admin/error-reports" element={<ProtectedRoute><AdminGuard><AdminErrorReports /></AdminGuard></ProtectedRoute>} />
        {/* SOS-FOLLOW G5 — where an emergency is worked: the live list
            ops follows, and the history of every one that ended. The
            banner above every admin route links here. */}
        <Route path="/admin/emergency" element={<ProtectedRoute><AdminGuard><AdminEmergency /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/conflicts/audit" element={<ProtectedRoute><AdminGuard><AdminConflictAudit /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/conflicts/:type" element={<ProtectedRoute><AdminGuard><AdminConflictsList /></AdminGuard></ProtectedRoute>} />
        <Route path="/admin/conflicts/:type/:id" element={<ProtectedRoute><AdminGuard><AdminConflictDetail /></AdminGuard></ProtectedRoute>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </AppLockGate>
      </ScreenErrorBoundary>
    </BrowserRouter>
  );
}
