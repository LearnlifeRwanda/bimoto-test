// AUTH-UX G1 — where each role lands after login/registration. Matches
// the BottomNav home tabs ('/' for CUSTOMER, '/driver' for DRIVER and
// BOTH) and the AdminGuard'ed dashboard for ADMIN.
export function roleHomePath(role: string | undefined | null): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    // INTEL-DECK G4 — an analyst has no ride to take and no dashboard to
    // run. The reading room is the whole product for them, so it is also
    // where login lands.
    case 'ANALYST':
      return '/intel';
    case 'DRIVER':
    // LOCATION-LIFE A G5 — FIELD-TRIAGE C1 #7: a BOTH user landed on the
    // passenger home, and BOTH is the shape onboarding produces for a
    // motari (createDriverProfile made almost every driver BOTH). So the
    // people the pilot is actually for opened the app on a screen that
    // books rides rather than the one that takes them — with the online
    // toggle, the tier, the money banner and the request feed all one
    // tap away and none of it visible.
    //
    // The passenger home stays fully reachable: it is still the first
    // BottomNav tab for BOTH (components/layout/BottomNav.tsx), which is
    // the difference between where somebody LANDS and what they can
    // reach. Only the landing moves.
    case 'BOTH':
      return '/driver';
    default:
      return '/';
  }
}
