// LANDMARKS G2 — what a landmark is.
//
// Split out of constants/locations.ts so the catalog can live in one file
// per category. Landmark and its category union are re-exported from
// locations.ts, which is still the path everything imports from.

import { GeoPoint } from '../../types/location.js';

export type LandmarkCategory =
  | 'orientation'
  | 'transport'
  | 'market'
  | 'business'
  | 'neighborhood'
  | 'hospital'
  | 'hotel'
  | 'recreation'
  | 'memorial'
  | 'government'
  | 'education'
  | 'worship'
  | 'industrial'
  | 'venue';

/**
 * A place with a verified point. `aliases` are the other names people say
 * for it, `areaHint` is the part of the city it is in — both are what the
 * search box matches on, alongside the name.
 */
export interface Landmark {
  name: string;
  nameRw?: string;
  nameFr?: string;
  aliases?: string[];
  areaHint?: string;
  point: GeoPoint;
  category: LandmarkCategory;
}

/**
 * A place the team named that no service could place. It has no `point`,
 * and the type says so, so nothing can read a coordinate off one of these
 * by accident. Selecting one asks the passenger to drop a pin.
 */
export type UnverifiedLandmark = Omit<Landmark, 'point'>;
