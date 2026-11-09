// CONSTANTS/MAP-REGIONS.TS
//
// MAP-RWANDA G4 — the region registry. Names and order, and nothing else.
//
// Rwanda has five provinces, and everyone here knows the country by
// them. So the offline map is offered the same way: all of Rwanda in one
// download, or a province at a time — by its own name, in the user's own
// language.
//
// WHAT THIS FILE IS FOR, AND WHAT IT IS NOT FOR
//
// It decides two things: which regions this app can NAME, and what ORDER
// they are shown in. It decides nothing about what exists. Availability
// and size come from GET /api/map/regions, which reads them off the
// filesystem, so an archive dropped on the server appears to every user
// without anybody editing this file — that is the whole point of the
// design, and hardcoding a size here would quietly undo it.
//
// The names themselves are NOT here. Every other user-facing string in
// this app lives in the locale files, where the parity test, the
// used-key gate and `pnpm i18n:review` can all see it; a second copy of
// "Amajyaruguru" in TypeScript would be one more place for the truth to
// drift and one place the translation pipeline cannot reach. Each region
// carries the i18n key instead, and map-regions-locales.test.ts asserts
// every key resolves in English, French AND Kinyarwanda — so a region
// added here without its three names is a failing test, not a raw
// `map.regions.north` on a rider's screen.
//
// The old card carried KIGALI_MAP_ESTIMATED_MB = 40 next to an archive
// that turned out to be about 6 MB. There is deliberately no such number
// anywhere any more.
//
// A region the server offers but this registry does not know is simply
// not rendered: there would be no name to show it under, in any of the
// three languages, and a row labelled with a raw key like `nyagatare`
// would be worse than no row. Adding a smaller pack later is therefore
// two things — build the archive, add three names here — and the tier
// structure below already has room for it.

/** The regions this app can name. Keys match the archive filenames
 *  (data/<key>.pmtiles) and the server's allowlist pattern
 *  ^[a-z]+(-[a-z]+)*$. */
export type MapRegionKey = 'rwanda' | 'kigali' | 'north' | 'south' | 'east' | 'west';

/**
 * How big a thing this is, largest first. The offline-map screen groups
 * rows by tier so the choice reads as "the whole country, or the part of
 * it I live in" rather than as six equivalent options.
 *
 * `district` has no members yet. It is here because the structure has to
 * accept smaller packs by provisioning alone — that is the point of
 * deriving availability from the filesystem — and a tier invented later
 * would mean touching the card again.
 */
export type MapRegionTier = 'country' | 'province' | 'district';

export interface MapRegion {
  key: MapRegionKey;
  tier: MapRegionTier;
  /**
   * MAP-REACH G4 — is this region OFFERED for download?
   *
   * Offering and existence are different questions, and this field is
   * the seam between them. `rwanda` is `offered: false`: the archive is
   * still on the server, the route still serves it, a phone that already
   * holds it still renders from it and still sees its row — it is simply
   * no longer proposed to anyone who has not got it.
   *
   * The ruling is Faustin's, on the card, 24 August: "Let have single
   * provinces only." Six rows where five would do made the choice read
   * as six equivalent options, and the whole-country bundle is the
   * redundancy — every square metre in it is in one of the five
   * provinces. A rider choosing their own province downloads a fraction
   * of the bytes for the map they actually ride on.
   *
   * This is deliberately NOT a deletion from the registry. Removing
   * `rwanda` here would strip its NAME, and a phone that already holds
   * the archive would show a row labelled with the raw key — the exact
   * failure the header warns about. Naming survives; offering stops.
   */
  offered: boolean;
  /** The i18n key that names it — `map.regions.<key>`, the same string
   *  the server returns as `nameKey`, derived the same way so the two
   *  cannot drift. The English, French and Kinyarwanda live in
   *  packages/client/public/locales. */
  nameKey: string;
}

/**
 * Display order: the country, then the provinces.
 *
 * Kigali leads the provinces because it is the capital and the one
 * archive that already shipped — a pilot phone that holds it should find
 * it where it expects to. The other four follow the compass order the
 * provinces are conventionally listed in.
 */
// The Kinyarwanda in the comments is the name a motari would actually
// say, and is what the locale files carry — it is here purely so this
// table reads as the country rather than as six slugs.
export const MAP_REGIONS: readonly MapRegion[] = [
  // U Rwanda rwose — named, servable, NOT offered (see `offered`).
  { key: 'rwanda', tier: 'country', nameKey: 'map.regions.rwanda', offered: false },
  // Umujyi wa Kigali
  { key: 'kigali', tier: 'province', nameKey: 'map.regions.kigali', offered: true },
  // Amajyaruguru
  { key: 'north', tier: 'province', nameKey: 'map.regions.north', offered: true },
  // Amajyepfo
  { key: 'south', tier: 'province', nameKey: 'map.regions.south', offered: true },
  // Iburasirazuba
  { key: 'east', tier: 'province', nameKey: 'map.regions.east', offered: true },
  // Iburengerazuba
  { key: 'west', tier: 'province', nameKey: 'map.regions.west', offered: true },
] as const;

/** The region the whole feature used to be, and the only key an already
 *  installed app knows how to ask for. Its Dexie entry and its route
 *  must keep working untouched. */
export const LEGACY_MAP_REGION: MapRegionKey = 'kigali';

const BY_KEY = new Map(MAP_REGIONS.map((r) => [r.key as string, r]));

export function isMapRegionKey(key: string): key is MapRegionKey {
  return BY_KEY.has(key);
}

/** Regions of one tier, in display order. Every region this app can
 *  name, offered or not — the card uses this to keep showing a region a
 *  phone already holds. */
export function mapRegionsInTier(tier: MapRegionTier): readonly MapRegion[] {
  return MAP_REGIONS.filter((r) => r.tier === tier);
}

/**
 * MAP-REACH G4 — the regions a rider is OFFERED, in display order.
 *
 * The five single provinces, and nothing else. This is the list the
 * offline-map card proposes and the only list the map chip draws from.
 * A region that is merely servable does not appear here; see
 * `offered` above for why the distinction is kept rather than
 * collapsed into a shorter registry.
 */
export const OFFERED_MAP_REGIONS: readonly MapRegion[] = MAP_REGIONS.filter(
  (r) => r.offered,
);

/** Offered regions of one tier, in display order. */
export function offeredMapRegionsInTier(
  tier: MapRegionTier,
): readonly MapRegion[] {
  return OFFERED_MAP_REGIONS.filter((r) => r.tier === tier);
}

/** Is this region proposed for download? False for a region that is
 *  named and servable but no longer offered. */
export function isOfferedMapRegion(key: string): boolean {
  return BY_KEY.get(key)?.offered === true;
}
