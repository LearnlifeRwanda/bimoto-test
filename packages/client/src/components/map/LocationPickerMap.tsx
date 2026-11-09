// COMPONENTS/MAP/LOCATION-PICKER-MAP.TSX
//
// PILOT-UX-2 G2 — pick-on-map for pickup and destination. Renders the
// background MapCanvas plus the picking overlay: a small mode chip row
// (pickup first, then destination) showing which point a tap sets, a
// tentative draggable pin, and a confirm button. Confirm resolves a
// human-readable name via the server's reverse-geocode proxy when it
// answers, and falls back to a plain coordinates label when it 503s
// (LocationIQ may be unset) or the device is offline.
//
// Pick-on-map COMPLEMENTS the GPS + typed-search methods that live in
// the sheet — confirmed points flow up via onConfirm and render here
// as pins regardless of which method set them; when both points exist
// the route preview renders on the background map.
//
// MAP-CACHE G4 — the preview is the LIKELY ROAD ROUTE from the server's
// directions proxy (solid line + distance/minutes chip) whenever it
// answers; on any failure (offline, pre-bundle pilot server, key unset,
// no route) it falls back silently to the original straight dashed
// line. Routing never blocks the flow.

import React, { useEffect, useState } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { MapCanvas } from './MapCanvas';
import { Spinner } from '../ui/Spinner';
import { reverseGeocodeOnce } from '../../hooks/useGeocodeSearch';
import { useRouteDirections } from '../../hooks/useRouteDirections';
import { useUIStore } from '../../stores/ui.store';
import { GeocodingAttribution } from '../journey/GeocodingAttribution';
import {
  ROAD_ROUTE_STYLE,
  FALLBACK_LINE_STYLE,
  routeSummaryParts,
} from './route-style';
import { RouteFallbackNotice } from './RouteFallbackNotice';

// TRUE-ROUTES G1 — the summary formatter moved to the shared
// route-style module; re-exported so existing imports keep working.
export { routeSummaryParts };

export type PickTarget = 'pickup' | 'destination';

export interface PickedLocation {
  lat: number;
  lng: number;
  address: string;
}

/** BOOK-UNBLOCK G2 — an explicit "choose on map" request from the host
 * page's form: selects which point the next tap sets. `seq` increments
 * per request so pressing the same control twice re-applies the target
 * even if the user has switched chips in between. */
export interface PickOnMapRequest {
  target: PickTarget;
  seq: number;
}

export interface LocationPickerMapProps {
  pickup: PickedLocation | null;
  destination: PickedLocation | null;
  onConfirm: (target: PickTarget, location: PickedLocation) => void;
  /** Fired when the map can't work (offline / tiles failing) so the host page can expand the sheet. */
  onUnavailable?: () => void;
  /** Optional external target selection (BOOK-UNBLOCK G2). Picking behaviour is unchanged. */
  pickRequest?: PickOnMapRequest | null;
}

export function coordinatesLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function pinIcon(background: string, glyph: string): L.DivIcon {
  return L.divIcon({
    className: 'picker-pin',
    html: `<div style="background:${background};color:#fff;width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${glyph}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  pickup,
  destination,
  onConfirm,
  onUnavailable,
  pickRequest,
}) => {
  const { t } = useTranslation();
  const isOnline = useUIStore((s) => s.isOnline);
  const route = useRouteDirections(pickup, destination);

  // Pickup first, then destination; arriving with a pickup already set
  // (GPS/search) starts on destination.
  const [activeTarget, setActiveTarget] = useState<PickTarget>(
    pickup ? 'destination' : 'pickup',
  );
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // BOOK-UNBLOCK G2 — the sheet's "choose on map" controls select the
  // target the same way tapping a mode chip does.
  useEffect(() => {
    if (pickRequest) setActiveTarget(pickRequest.target);
  }, [pickRequest]);

  const handleMapClick = (lat: number, lng: number) => {
    setPending({ lat, lng });
  };

  const handleConfirm = async () => {
    if (!pending || isResolving) return;
    setIsResolving(true);
    try {
      const place = isOnline
        ? await reverseGeocodeOnce(pending.lat, pending.lng)
        : null;
      onConfirm(activeTarget, {
        lat: pending.lat,
        lng: pending.lng,
        address: place?.label ?? coordinatesLabel(pending.lat, pending.lng),
      });
      setPending(null);
      if (activeTarget === 'pickup') setActiveTarget('destination');
    } finally {
      setIsResolving(false);
    }
  };

  const chip = (target: PickTarget, label: string) => (
    <button
      key={target}
      type="button"
      role="radio"
      aria-checked={activeTarget === target}
      data-testid={`picker-mode-${target}`}
      onClick={() => setActiveTarget(target)}
      className={`min-h-[44px] px-3 py-1.5 rounded-full text-xs font-semibold shadow transition-colors ${
        activeTarget === target
          ? target === 'pickup'
            ? 'bg-[#1B4F72] text-white'
            : 'bg-[#E74C3C] text-white'
          : 'bg-white text-gray-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <MapCanvas
        centerOnUser={!pickup}
        onMapClick={handleMapClick}
        onUnavailable={onUnavailable}
      >
        {pickup && (
          <Marker
            position={[pickup.lat, pickup.lng]}
            icon={pinIcon('#1B4F72', 'A')}
          />
        )}
        {destination && (
          <Marker
            position={[destination.lat, destination.lng]}
            icon={pinIcon('#E74C3C', 'B')}
          />
        )}
        {pickup && destination && (
          route ? (
            // Likely road route — solid line along the returned polyline.
            <Polyline
              positions={route.coordinates}
              pathOptions={ROAD_ROUTE_STYLE}
            />
          ) : (
            // TRUE-ROUTES G1 — shared visibly-not-a-route fallback.
            <Polyline
              positions={[
                [pickup.lat, pickup.lng],
                [destination.lat, destination.lng],
              ]}
              pathOptions={FALLBACK_LINE_STYLE}
            />
          )
        )}
        {pending && (
          <Marker
            position={[pending.lat, pending.lng]}
            draggable={true}
            eventHandlers={{
              dragend: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
                const p = e.target.getLatLng();
                setPending({ lat: p.lat, lng: p.lng });
              },
            }}
            icon={pinIcon(
              activeTarget === 'pickup' ? '#1B4F72' : '#E74C3C',
              '+',
            )}
          />
        )}
      </MapCanvas>

      {/* Picking overlay — above the map (z-0), below the sheet (z-30).
          CHROME-C G2 — cleared out from under the header. At `top-3`
          these chips (y 12-56) painted over the shell's header band
          (y 0-49 plus the notch inset) on all four picker screens;
          AppShell's own note recorded it as KNOWN, MEASURED and called
          a top offset the tidy fix, out of scope at the time. It is in
          scope now that the header carries the connection status: a
          chrome whose rule is "nothing covers anything" cannot have map
          chips sitting on the status word. 3.5rem (56 px) clears the
          49 px header — h-12 plus its border — and the inset is added
          rather than guessed at, so this tracks the notch. */}
      <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 flex flex-col items-center gap-2 pointer-events-none">
        <div
          className="flex gap-2 pointer-events-auto"
          role="radiogroup"
          aria-label={t('picker.modeLabel')}
          data-testid="picker-mode-chips"
        >
          {chip('pickup', t('picker.pickup'))}
          {chip('destination', t('picker.destination'))}
        </div>
        {route && (
          <span
            className="px-3 py-1 rounded-full bg-white/90 text-[11px] font-semibold text-gray-700 shadow"
            data-testid="picker-route-summary"
          >
            {t('picker.routeSummary', routeSummaryParts(route.distanceM, route.durationS))}
          </span>
        )}
        {pickup && destination && !route && <RouteFallbackNotice />}
        {pending ? (
          <button
            type="button"
            data-testid="picker-confirm"
            onClick={handleConfirm}
            disabled={isResolving}
            className="pointer-events-auto min-h-[44px] px-5 py-2 rounded-full bg-[#1B4F72] text-white text-sm font-semibold shadow-lg flex items-center gap-2"
          >
            {isResolving && <Spinner size="sm" />}
            {activeTarget === 'pickup'
              ? t('picker.confirmPickup')
              : t('picker.confirmDestination')}
          </button>
        ) : (
          <span
            className="px-3 py-1 rounded-full bg-white/90 text-[11px] text-gray-600 shadow"
            data-testid="picker-tap-hint"
          >
            {t('picker.tapHint')}
          </span>
        )}
        {/* PILOT-READY G3 — confirmed pins resolve their names through
            the LocationIQ reverse-geocode proxy; credit required. */}
        <GeocodingAttribution className="pointer-events-auto px-2 py-0.5 rounded-full bg-white/90 shadow" />
      </div>
    </>
  );
};

export default LocationPickerMap;
