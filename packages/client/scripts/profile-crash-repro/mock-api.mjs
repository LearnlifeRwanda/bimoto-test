// PROFILE-RESCUE G1 — mock Bimoto API on :3000.
// Serves exactly what App.tsx boot + the profile route touch, with the
// user JSON shaped the way the real server serializes it (Prisma:
// Decimal -> STRING, DateTime -> ISO string). Role selected via
// BIMOTO_MOCK_ROLE=DRIVER|CUSTOMER.
import http from 'node:http';

const ROLE = process.env.BIMOTO_MOCK_ROLE || 'DRIVER';
// §6 walk: an empty nickname exercises an artificial screen crash
// (ProfilePage renders nickname[0]) to prove in-app recovery.
const NICKNAME = process.env.BIMOTO_MOCK_NICKNAME;

// Prisma res.json(user) shape from user.service.ts getMe():
// full User row + driverProfile include, phone decrypted,
// emergencyContacts parsed.
function makeUser(role) {
  const base = {
    id: '4f9c6f1e-0000-4000-8000-000000000001',
    phone: '+250780000001',
    phoneHash: 'abc',
    nickname: NICKNAME !== undefined ? NICKNAME : role === 'DRIVER' ? 'Emmanuel' : 'Aline',
    role,
    language: 'rw',
    idVerified: true,
    licenseVerified: role === 'DRIVER',
    emergencyContacts: [],
    completedRides: 12,
    cancellationCount: 0,
    totalRequests: 15,
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-07-29T08:00:00.000Z',
    privacyConsentAt: '2026-05-01T08:00:00.000Z',
    privacyConsentVersion: '1.0',
    termsAcceptedAt: '2026-05-01T08:00:00.000Z',
    termsAcceptedVersion: '1.0',
    driverTermsAcceptedAt: role === 'DRIVER' ? '2026-05-01T08:00:00.000Z' : null,
    driverTermsVersion: role === 'DRIVER' ? '1.0' : null,
    accountDeletedAt: null,
    isDeleted: false,
    disputeCount: 0,
    disputeRate: 0,
    isFlagged: false,
    flagReason: null,
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 3,
    scheduledCancellationCount: 0,
  };
  if (role === 'DRIVER' || role === 'BOTH') {
    base.driverProfile = {
      id: '4f9c6f1e-0000-4000-8000-000000000002',
      userId: base.id,
      vehicleType: 'MOTO',
      registrationPlate: 'RE 123 A',
      vehicleDescription: 'Red TVS moto',
      // Prisma Decimal(3,2) serializes as a STRING via res.json().
      avgRating: '4.85',
      totalRides: 240,
      isOnline: false,
      lastLat: -1.9536,
      lastLng: 30.0605,
      lastLocationAt: '2026-07-29T08:00:00.000Z',
      drivingLicenseNumber: 'DL-1',
      ruraAuthorizationNumber: 'RURA-0042',
      cooperativeName: null,
      insuranceConfirmed: true,
      verificationStatus: 'VERIFIED',
      drivingLicensePhotoUrl: null,
      ruraAuthorizationPhotoUrl: null,
      insurancePhotoUrl: null,
      verifiedAt: '2026-05-02T08:00:00.000Z',
      rejectionReason: null,
      revokedAt: null,
      active: true,
      cooperativeId: null,
    };
  }
  return base;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost:3000');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/health') {
    return send(200, { status: 'ok', paymentsMode: 'simulated', smsMode: 'simulated' });
  }
  if (url.pathname === '/api/auth/refresh') {
    // Web cookie flow: pretend the cookie session is alive.
    return send(200, { accessToken: null });
  }
  if (url.pathname === '/api/users/me') {
    return send(200, makeUser(ROLE));
  }
  if (url.pathname === '/api/map/kigali.pmtiles') {
    // Verbatim server behaviour from routes/map.routes.ts when
    // MAP_PMTILES_PATH is unset (the pilot Mac).
    return send(404, { error: { code: 'MAP_NOT_AVAILABLE', message: 'errors.mapNotAvailable' } });
  }
  // Everything else (sync, socket.io polling, ...) — plain 404.
  send(404, { error: { code: 'NOT_FOUND', message: 'errors.notFound' } });
});

server.listen(3000, () => console.log(`[mock-api] :3000 role=${ROLE}`));
