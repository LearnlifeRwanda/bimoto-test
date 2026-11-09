import React from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BaseTileLayer } from '../map/BaseTileLayer';
import type { EmergencyFollowPosition } from '../../stores/emergency-alert.store';

// SOS-FOLLOW G5 — where the people on one emergency last were.
//
// No new map technology: MapContainer + the shared BaseTileLayer, which
// is the same offline-capable base every other surface uses (cached
// Kigali extract first, OSM raster as the documented fallback). An ops
// panel on a bad connection shows the same map the phones do.
//
// TWO THINGS ARE DELIBERATE ABOUT WHAT IT DRAWS.
//
// First, one marker per PERSON, not one per alert. Both participants
// stream, and on the ride that matters most the two dots are in
// different places — which is exactly the information an operator
// needs. Merging them would show whichever phone reported last.
//
// Second, the press position is drawn differently from the live ones: a
// hollow ring rather than a pin. It is where the button was pressed and
// it never moves, and a screen that drew it identically to a live
// position would let an operator mistake the beginning of an emergency
// for its current state.
//
// No route line is drawn between positions. Two dots and a line looks
// like a path travelled; what we have is two samples, possibly minutes
// apart, possibly from a phone that has since gone quiet. The ages
// beside the list say what is actually known.

export interface EmergencyFollowMapProps {
  positions: EmergencyFollowPosition[];
  pressLat: number | null;
  pressLng: number | null;
}

const dot = (role: 'CUSTOMER' | 'DRIVER') =>
  L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html:
      `<div style="width:18px;height:18px;border-radius:9999px;border:3px solid #fff;` +
      `box-shadow:0 1px 4px rgba(0,0,0,.4);background:${role === 'DRIVER' ? '#2563eb' : '#E74C3C'}"></div>`,
  });

export const EmergencyFollowMap: React.FC<EmergencyFollowMapProps> = ({
  positions,
  pressLat,
  pressLng,
}) => {
  const { t } = useTranslation();

  const anchor =
    positions[0] ??
    (pressLat !== null && pressLng !== null ? { lat: pressLat, lng: pressLng } : null);

  // Nothing to draw is said, not drawn as an empty map centred on
  // nowhere. An operator reading "no position yet" knows to use the
  // phone numbers; an operator reading a blank map does not.
  if (!anchor) {
    return (
      <div
        className="h-40 rounded-lg bg-gray-100 flex items-center justify-center text-sm text-gray-600 px-3 text-center"
        data-testid="emergency-follow-map-empty"
      >
        {t('emergency.opsNoPosition')}
      </div>
    );
  }

  return (
    <div className="h-40 rounded-lg overflow-hidden" data-testid="emergency-follow-map">
      <MapContainer
        center={[anchor.lat, anchor.lng]}
        zoom={15}
        scrollWheelZoom={false}
        className="w-full h-full"
        attributionControl={true}
      >
        <BaseTileLayer />

        {pressLat !== null && pressLng !== null && (
          <CircleMarker
            center={[pressLat, pressLng]}
            radius={10}
            pathOptions={{ color: '#E74C3C', weight: 2, fillOpacity: 0 }}
          />
        )}

        {positions.map((p) => (
          <Marker key={p.userId} position={[p.lat, p.lng]} icon={dot(p.role)} />
        ))}
      </MapContainer>
    </div>
  );
};
