jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import geocodeRoutes from '../routes/geocode.routes';
import { generateAccessToken } from '../utils/jwt';
import { config } from '../config';
import { _resetRateLimitForTests } from '../middleware/rate-limit';
import {
  _setFetchForTests,
  _resetGeocodeCacheForTests,
} from '../services/geocoding/locationiq';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/geocode', geocodeRoutes);

const cfg = config as { LOCATIONIQ_API_KEY: string };
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const PROVIDER_ITEM = {
  lat: '-1.9536',
  lon: '30.0606',
  display_name: 'Kimironko Market, Kigali, Rwanda',
};

let fetchMock: jest.Mock;

beforeEach(() => {
  cfg.LOCATIONIQ_API_KEY = 'test-key';
  fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, [PROVIDER_ITEM]));
  _setFetchForTests(fetchMock as unknown as typeof fetch);
  _resetGeocodeCacheForTests();
  _resetRateLimitForTests();
});

afterEach(() => {
  cfg.LOCATIONIQ_API_KEY = '';
  _setFetchForTests(null);
  _resetGeocodeCacheForTests();
  _resetRateLimitForTests();
});

describe('GET /api/geocode/search', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/geocode/search?q=Kimironko');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('400 when q is shorter than 3 characters', async () => {
    const res = await request(app)
      .get('/api/geocode/search?q=Ki')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GEOCODE_QUERY_TOO_SHORT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns mapped results on the happy path', async () => {
    const res = await request(app)
      .get('/api/geocode/search?q=Kimironko market')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: [{ lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali, Rwanda' }],
    });
  });

  test('503 GEOCODING_UNAVAILABLE when the key is not configured', async () => {
    cfg.LOCATIONIQ_API_KEY = '';
    const res = await request(app)
      .get('/api/geocode/search?q=Kimironko')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: 'GEOCODING_UNAVAILABLE',
      message: 'errors.geocodingUnavailable',
    });
  });

  test('504 when the provider times out', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abortErr);
    const res = await request(app)
      .get('/api/geocode/search?q=Kimironko')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('GEOCODING_TIMEOUT');
  });

  test('502 when the provider errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const res = await request(app)
      .get('/api/geocode/search?q=Kimironko')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GEOCODING_FAILED');
  });

  test('rate limit fires after 20 requests in the window', async () => {
    // The limiter is bypassed under NODE_ENV=test — flip it for this test.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .get(`/api/geocode/search?q=query-${i}`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(res.status).toBe(200);
      }
      const blocked = await request(app)
        .get('/api/geocode/search?q=query-21')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

describe('GET /api/geocode/reverse', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(200, PROVIDER_ITEM));
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/geocode/reverse?lat=-1.95&lng=30.06');
    expect(res.status).toBe(401);
  });

  test('400 on missing or non-numeric coordinates', async () => {
    for (const qs of ['', 'lat=-1.95', 'lat=abc&lng=30.06', 'lat=-1.95&lng=999']) {
      const res = await request(app)
        .get(`/api/geocode/reverse?${qs}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEOCODE_INVALID_COORDINATES');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns the mapped place on the happy path', async () => {
    const res = await request(app)
      .get('/api/geocode/reverse?lat=-1.95361&lng=30.06058')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali, Rwanda' },
    });
  });

  test('null result when the provider knows nothing there', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Unable to geocode' }));
    const res = await request(app)
      .get('/api/geocode/reverse?lat=0.0001&lng=0.0001')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: null });
  });

  test('503 GEOCODING_UNAVAILABLE when the key is not configured', async () => {
    cfg.LOCATIONIQ_API_KEY = '';
    const res = await request(app)
      .get('/api/geocode/reverse?lat=-1.95&lng=30.06')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GEOCODING_UNAVAILABLE');
  });
});

// MAP-CACHE G1 — LocationIQ directions proxy (OSRM-compatible shape).
describe('GET /api/geocode/directions', () => {
  const QS = 'fromLat=-1.9536&fromLng=30.0606&toLat=-1.9441&toLng=30.0619';
  const OSRM_ROUTE = {
    code: 'Ok',
    routes: [
      {
        geometry: {
          // GeoJSON [lng, lat] — the server flips to [lat, lng].
          coordinates: [
            [30.0606, -1.9536],
            [30.061, -1.95],
            [30.0619, -1.9441],
          ],
        },
        distance: 1234.5,
        duration: 320.7,
      },
    ],
  };

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(200, OSRM_ROUTE));
  });

  test('401 without a token', async () => {
    const res = await request(app).get(`/api/geocode/directions?${QS}`);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('400 on missing or out-of-range coordinates', async () => {
    for (const qs of [
      '',
      'fromLat=-1.95&fromLng=30.06&toLat=-1.94', // toLng missing
      'fromLat=abc&fromLng=30.06&toLat=-1.94&toLng=30.06',
      'fromLat=-1.95&fromLng=999&toLat=-1.94&toLng=30.06',
    ]) {
      const res = await request(app)
        .get(`/api/geocode/directions?${qs}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEOCODE_INVALID_COORDINATES');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns the [lat,lng] polyline with totals on the happy path', async () => {
    const res = await request(app)
      .get(`/api/geocode/directions?${QS}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      coordinates: [
        [-1.9536, 30.0606],
        [-1.95, 30.061],
        [-1.9441, 30.0619],
      ],
      distanceM: 1234.5,
      durationS: 320.7,
    });
    // Never expose the key to the client; it lives only in the provider URL.
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/directions/driving/');
    expect(JSON.stringify(res.body)).not.toContain('test-key');
  });

  test('404 ROUTE_NOT_FOUND when the provider knows no route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { code: 'NoRoute' }));
    const res = await request(app)
      .get(`/api/geocode/directions?${QS}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'ROUTE_NOT_FOUND',
      message: 'errors.routeNotFound',
    });
  });

  test('404 ROUTE_NOT_FOUND on an unusable provider shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 'Ok', routes: [{}] }));
    const res = await request(app)
      .get(`/api/geocode/directions?${QS}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('503 GEOCODING_UNAVAILABLE when the key is not configured', async () => {
    cfg.LOCATIONIQ_API_KEY = '';
    const res = await request(app)
      .get(`/api/geocode/directions?${QS}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: 'GEOCODING_UNAVAILABLE',
      message: 'errors.geocodingUnavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('504 when the provider times out', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abortErr);
    const res = await request(app)
      .get(`/api/geocode/directions?${QS}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('GEOCODING_TIMEOUT');
  });

  test('repeat pair lookups hit the cache (one provider call)', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // TRUE-ROUTES G2/G4 — opt-in alternatives; the default contract
  // above stays byte-identical.
  describe('alternatives', () => {
    const SECOND_ROUTE = {
      geometry: {
        coordinates: [
          [30.0606, -1.9536],
          [30.058, -1.951],
          [30.0619, -1.9441],
        ],
      },
      distance: 1600.0,
      duration: 400.0,
    };
    const OSRM_TWO_ROUTES = {
      code: 'Ok',
      routes: [OSRM_ROUTE.routes[0], SECOND_ROUTE],
    };

    test('contract: the default response carries no routes array', async () => {
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.routes).toBeUndefined();
      expect(Object.keys(res.body).sort()).toEqual([
        'coordinates',
        'distanceM',
        'durationS',
      ]);
    });

    test('alternatives=false behaves exactly like the default', async () => {
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=false`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.routes).toBeUndefined();
      expect(res.body.distanceM).toBe(1234.5);
    });

    test('alternatives=true returns the ranked routes array', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, OSRM_TWO_ROUTES));
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=true`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.routes).toHaveLength(2);
      expect(res.body.routes[0]).toEqual({
        coordinates: [
          [-1.9536, 30.0606],
          [-1.95, 30.061],
          [-1.9441, 30.0619],
        ],
        distanceM: 1234.5,
        durationS: 320.7,
      });
      expect(res.body.routes[1].distanceM).toBe(1600.0);
      // The provider was actually asked for alternatives.
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('alternatives=true');
    });

    test('a numeric count is passed through to the provider', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, OSRM_TWO_ROUTES));
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=3`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('alternatives=3');
    });

    test('graceful when the provider finds no alternative: routes array of length 1', async () => {
      // Per the provider docs alternatives are searched "if available" —
      // a single route is a legitimate answer to an alternatives request.
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=true`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.routes).toHaveLength(1);
      expect(res.body.routes[0].distanceM).toBe(1234.5);
    });

    test('400 GEOCODE_INVALID_ALTERNATIVES on out-of-range or junk values', async () => {
      for (const v of ['1', '6', '0', 'yes', '2.5', '-2']) {
        const res = await request(app)
          .get(`/api/geocode/directions?${QS}&alternatives=${v}`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('GEOCODE_INVALID_ALTERNATIVES');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('single-route and alternatives entries cache separately', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, OSRM_TWO_ROUTES));
      // Two distinct provider calls...
      await request(app)
        .get(`/api/geocode/directions?${QS}`)
        .set('Authorization', `Bearer ${customerToken}`);
      await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=true`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // ...then both shapes answer from their own cache entry.
      const single = await request(app)
        .get(`/api/geocode/directions?${QS}`)
        .set('Authorization', `Bearer ${customerToken}`);
      const alt = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=true`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(single.body.routes).toBeUndefined();
      expect(alt.body.routes).toHaveLength(2);
    });

    test('404 ROUTE_NOT_FOUND when no route parses from an alternatives answer', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { code: 'Ok', routes: [{}] }));
      const res = await request(app)
        .get(`/api/geocode/directions?${QS}&alternatives=true`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });
});
