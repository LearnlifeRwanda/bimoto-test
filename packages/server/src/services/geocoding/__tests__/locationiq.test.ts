import { config } from '../../../config';
import {
  searchAddresses,
  reverseGeocode,
  GeocodingError,
  _setFetchForTests,
  _resetGeocodeCacheForTests,
} from '../locationiq';

const cfg = config as { LOCATIONIQ_API_KEY: string };

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const PROVIDER_ITEM = {
  place_id: '12345',
  lat: '-1.9536',
  lon: '30.0606',
  display_name: 'Kimironko Market, Kigali, Rwanda',
  display_place: 'Kimironko Market',
};

describe('locationiq geocoding service', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    cfg.LOCATIONIQ_API_KEY = 'test-key';
    fetchMock = jest.fn();
    _setFetchForTests(fetchMock as unknown as typeof fetch);
    _resetGeocodeCacheForTests();
  });

  afterEach(() => {
    cfg.LOCATIONIQ_API_KEY = '';
    _setFetchForTests(null);
    _resetGeocodeCacheForTests();
  });

  describe('searchAddresses', () => {
    test('maps provider items and sends rw bias params', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, [PROVIDER_ITEM]));

      const results = await searchAddresses('Kimironko market');

      expect(results).toEqual([
        { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali, Rwanda' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://api.locationiq.com/v1/autocomplete');
      expect(url.searchParams.get('key')).toBe('test-key');
      expect(url.searchParams.get('q')).toBe('Kimironko market');
      expect(url.searchParams.get('countrycodes')).toBe('rw');
      expect(url.searchParams.get('limit')).toBe('20');
    });

    test('FIELD-UX G1: Kigali viewbox is a soft bias — viewbox set, bounded absent', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, [PROVIDER_ITEM]));

      await searchAddresses('Nyabugogo');

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      // Bias present: greater-Kigali viewbox, lon1,lat1,lon2,lat2.
      expect(url.searchParams.get('viewbox')).toBe('29.95,-1.85,30.22,-2.10');
      // Never a filter: bounded must NOT be sent — the rest of Rwanda
      // stays findable, results near Kigali merely rank first.
      expect(url.searchParams.get('bounded')).toBeNull();
      // Country restriction unchanged.
      expect(url.searchParams.get('countrycodes')).toBe('rw');
    });

    test('caches repeated queries — fetch called once', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, [PROVIDER_ITEM]));

      const first = await searchAddresses('Kimironko');
      // Same query modulo case/whitespace must hit the cache.
      const second = await searchAddresses('  kimironko ');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    test('FIELD-UX G1: cached result matches what the biased request returned — shape unchanged', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, [PROVIDER_ITEM]));

      const first = await searchAddresses('Kimironko');
      const second = await searchAddresses('Kimironko');

      // One network call; the cache key carries the bias parameters, so
      // a hit can only come from an identically-parameterized request.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second).toEqual([
        { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali, Rwanda' },
      ]);
      expect(second).toEqual(first);
    });

    test('drops malformed provider items instead of failing', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, [
          PROVIDER_ITEM,
          { lat: 'not-a-number', lon: '30.1', display_name: 'Broken' },
          { lat: '-1.95', lon: '30.05' }, // no label
          null,
        ]),
      );

      const results = await searchAddresses('Kigali');
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Kimironko Market, Kigali, Rwanda');
    });

    test('provider 404 ("Unable to geocode") is an empty result, not an error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Unable to geocode' }));

      await expect(searchAddresses('zzzzzz')).resolves.toEqual([]);
    });

    test('throws GEOCODING_UNAVAILABLE without touching the network when the key is unset', async () => {
      cfg.LOCATIONIQ_API_KEY = '';

      await expect(searchAddresses('Kigali')).rejects.toMatchObject({
        code: 'GEOCODING_UNAVAILABLE',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('maps an aborted request to GEOCODING_TIMEOUT', async () => {
      const abortErr = new Error('The operation was aborted due to timeout');
      abortErr.name = 'TimeoutError';
      fetchMock.mockRejectedValue(abortErr);

      await expect(searchAddresses('Kigali')).rejects.toMatchObject({
        code: 'GEOCODING_TIMEOUT',
      });
    });

    test('maps provider 5xx to GEOCODING_FAILED', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

      await expect(searchAddresses('Kigali')).rejects.toMatchObject({
        code: 'GEOCODING_FAILED',
        httpStatus: 500,
      });
    });
  });

  describe('reverseGeocode', () => {
    test('returns the mapped place and requests json format', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, PROVIDER_ITEM));

      const result = await reverseGeocode(-1.95361, 30.06058);

      expect(result).toEqual({
        lat: -1.9536,
        lng: 30.0606,
        label: 'Kimironko Market, Kigali, Rwanda',
      });
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://api.locationiq.com/v1/reverse');
      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('lat')).toBe('-1.9536');
      expect(url.searchParams.get('lon')).toBe('30.0606');
    });

    test('rounds to 4 decimals for caching — GPS jitter collapses onto one entry', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, PROVIDER_ITEM));

      await reverseGeocode(-1.953611, 30.060577);
      await reverseGeocode(-1.953649, 30.060601); // same 4-decimal cell

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('provider 404 means "nothing known here" — returns null and caches it', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Unable to geocode' }));

      await expect(reverseGeocode(0.0001, 0.0001)).resolves.toBeNull();
      await expect(reverseGeocode(0.0001, 0.0001)).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('throws GEOCODING_UNAVAILABLE when the key is unset', async () => {
      cfg.LOCATIONIQ_API_KEY = '';

      await expect(reverseGeocode(-1.95, 30.06)).rejects.toBeInstanceOf(GeocodingError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
