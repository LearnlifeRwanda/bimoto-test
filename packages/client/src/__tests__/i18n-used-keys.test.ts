// PILOT-UX G4 — used-key completeness gate.
//
// The sibling parity test (i18n-parity.test.ts) keeps the three locale
// files in sync with EACH OTHER, but nothing verified that the keys the
// CODE uses actually exist in any locale — which is how 262 keys came
// to render as raw strings on the pilot phone (journey.findDrivers,
// profile.title, the whole driver ride flow…). This test extracts every
// translation key used in packages/client/src and fails when any is
// absent from en, fr, or rw, so a missing key is a CI failure, not a
// field discovery.
//
// Extraction covers:
//   1. literal t('…') / t("…") / t(`…`) calls (no interpolation);
//   2. literal values of *Key properties (labelKey, nameKey, …) in
//      client src AND @bimoto/shared src (compliance matrix, screener
//      catalogue) — these reach t() indirectly via t(x.labelKey);
//   3. full-literal dotted strings whose first segment is a known
//      locale namespace (catches key maps like the scheduled-error
//      code → key tables);
//   4. DYNAMIC_KEYS: template calls t(`…${…}`) enumerated explicitly
//      below from their real value domains;
//   5. TEMPLATE_ALLOWLIST: template call sites that cannot or need not
//      be enumerated, each with a justification. Any template t() call
//      matching neither 4 nor 5 fails the test, so new dynamic
//      patterns must be classified here on arrival.

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  VehicleType,
  JourneyStatus,
  EscrowStatus,
  CITY_BAND_KEYS,
  SCREENER_QUESTIONS,
  MAP_REGIONS,
  RATING_REASONS,
  RIDE_REPORT_REASONS,
} from '@bimoto/shared';

const CLIENT_ROOT = join(__dirname, '../..');
const SRC = join(CLIENT_ROOT, 'src');
const SHARED_SRC = join(CLIENT_ROOT, '../shared/src');
const LOCALES_DIR = join(CLIENT_ROOT, 'public/locales');

// ---------------------------------------------------------------- locales

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function loadLocale(locale: string): Set<string> {
  const raw = readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf8');
  return new Set(flattenKeys(JSON.parse(raw)));
}

const locales = {
  en: loadLocale('en'),
  fr: loadLocale('fr'),
  rw: loadLocale('rw'),
};
const namespaces = new Set([...locales.en].map((k) => k.split('.')[0]));

// ------------------------------------------------------------ file walking

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (['__tests__', 'node_modules', 'dist'].includes(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry) && entry !== 'setup.ts') {
      out.push(full);
    }
  }
  return out;
}

// ------------------------------------------------------- static extraction

const T_CALL = /\bt\(\s*(['"`])([^'"`$]+?)\1/g;
const KEY_PROP = /\b\w*Key\s*:\s*(['"])([a-zA-Z0-9_.]+)\1/g;
const FULL_DOTTED = /(['"])([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)\1/g;
// Template t() calls with interpolation — each must be enumerated in
// DYNAMIC_KEYS or listed in TEMPLATE_ALLOWLIST.
const TEMPLATE_CALL = /\bt\(\s*`([^`]*\$\{[^`]*)`/g;

interface Extraction {
  used: Map<string, string>; // key -> first "file:line"
  templates: Map<string, string>; // raw template source -> "file:line"
}

function extract(): Extraction {
  const used = new Map<string, string>();
  const templates = new Map<string, string>();
  const scan = (files: string[], rules: Array<'t' | 'prop' | 'dotted' | 'template'>) => {
    for (const file of files) {
      const rel = file.replace(`${CLIENT_ROOT}/`, '');
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const where = `${rel}:${i + 1}`;
        if (rules.includes('t')) {
          for (const m of line.matchAll(T_CALL)) {
            if (m[2].includes('.')) used.set(m[2], used.get(m[2]) ?? where);
          }
        }
        if (rules.includes('prop')) {
          for (const m of line.matchAll(KEY_PROP)) {
            if (m[2].includes('.')) used.set(m[2], used.get(m[2]) ?? where);
          }
        }
        if (rules.includes('dotted')) {
          for (const m of line.matchAll(FULL_DOTTED)) {
            if (namespaces.has(m[2].split('.')[0])) used.set(m[2], used.get(m[2]) ?? where);
          }
        }
        if (rules.includes('template')) {
          for (const m of line.matchAll(TEMPLATE_CALL)) {
            templates.set(m[1], templates.get(m[1]) ?? where);
          }
        }
      });
    }
  };
  scan(sourceFiles(SRC), ['t', 'prop', 'dotted', 'template']);
  // Shared carries key-bearing catalogues (vehicle compliance matrix,
  // screener questions) whose *Key properties reach t() in the client.
  scan(sourceFiles(SHARED_SRC), ['prop']);
  return { used, templates };
}

// ------------------------------------------------- dynamic-key enumeration

const lower = (s: string) => s.toLowerCase();

const DYNAMIC_KEYS: string[] = [
  // t(`vehicle.${vehicleType.toLowerCase()}`) — CheckDriverPage.
  // Domain: the VehicleType enum, lowercased.
  ...Object.values(VehicleType).map((v) => `vehicle.${lower(v)}`),
  // t(`vehicleTypeInfo.fareHint.${fareKey}`) + packageSize — the
  // VEHICLE_DETAILS map in VehicleTypeInfoCard.
  ...['bike', 'e_bike', 'moto', 'e_moto'].map((v) => `vehicleTypeInfo.fareHint.${v}`),
  ...['small', 'medium'].map((v) => `vehicleTypeInfo.packageSize.${v}`),
  // t(`matched.approach.${status}`) — ApproachStatus union in shared.
  ...['silent', 'approaching', 'arrived', 'lost'].map((s) => `matched.approach.${s}`),
  // t(`status.${journey.status}`) — HistoryPage badge, raw enum values.
  ...Object.values(JourneyStatus).map((s) => `status.${s}`),
  // t(`vehicleTypeInfo.${journey.vehiclePreference.toLowerCase()}.label`)
  // — RideReceiptPage vehicle line. Domain: VehicleType, lowercased.
  ...Object.values(VehicleType).map((v) => `vehicleTypeInfo.${lower(v)}.label`),
  // t(`payments.status.${escrow.status}`) — RideReceiptPage /
  // PaymentsPage escrow-state labels, raw EscrowStatus values.
  ...Object.values(EscrowStatus).map((s) => `payments.status.${s}`),
  // t(`journey.status.${ride.status.toLowerCase()}`) — ScheduledRidesPage.
  ...Object.values(JourneyStatus).map((s) => `journey.status.${lower(s)}`),
  // t(`welcome.screen${n}.…`) — WelcomePage/WelcomeCarousel, 3 screens.
  ...[1, 2, 3].flatMap((n) =>
    ['heading', 'body', 'illustrationAlt'].map((f) => `welcome.screen${n}.${f}`),
  ),
  // TEAM-ANSWERS G2/G3 — t(`rating.reason.${key}`) in RateRideCard and
  // t(`report.reason.${key}`) in ReportRideCard. Both domains are closed
  // enums in shared, so they are enumerated from the source of truth
  // rather than allowlisted: adding a reason key without its three
  // labels fails here, which is exactly the gate those starter sets
  // need while the Kigali team is still editing them.
  ...RATING_REASONS.map((r) => `rating.reason.${r}`),
  ...RIDE_REPORT_REASONS.map((r) => `report.reason.${r}`),
  // t(`admin.funnel.cityBands.${b}`) — AdminFunnel, CITY_BAND_KEYS.
  ...CITY_BAND_KEYS.map((b) => `admin.funnel.cityBands.${b}`),
  // t(`goods.size_${size}`) — GoodsRequestPage / UrgentMessengerPage,
  // SIZE_OPTIONS = small | medium | large.
  ...['small', 'medium', 'large'].map((s) => `goods.size_${s}`),
  // t(`${question.i18nOptionKeyPrefix}.${opt}`) — DriverScreenerPage,
  // enumerated from the shared screener catalogue.
  ...SCREENER_QUESTIONS.flatMap((q) =>
    'options' in q && 'i18nOptionKeyPrefix' in q
      ? (q.options as readonly string[]).map((opt) => `${q.i18nOptionKeyPrefix}.${opt}`)
      : [],
  ),
  // MAP-RWANDA G4 — t(`map.regions.${region.key}`), OfflineMapCard and
  // OfflineMapRegionRow. Domain: the shared region registry, which is
  // the only place a region is named. A region added there without its
  // three translations fails here rather than on a rider's screen.
  ...MAP_REGIONS.map((r) => `map.regions.${r.key}`),
];

// Template call sites that are exempt from enumeration. Matched by
// substring against the template source. Every entry needs a reason.
const TEMPLATE_ALLOWLIST: Array<{ pattern: string; reason: string }> = [
  { pattern: 'vehicle.${', reason: 'enumerated in DYNAMIC_KEYS from VehicleType' },
  { pattern: 'map.regions.${', reason: 'enumerated in DYNAMIC_KEYS from MAP_REGIONS' },
  { pattern: 'vehicleTypeInfo.fareHint.${', reason: 'enumerated in DYNAMIC_KEYS' },
  { pattern: 'vehicleTypeInfo.packageSize.${', reason: 'enumerated in DYNAMIC_KEYS' },
  { pattern: 'matched.approach.${', reason: 'enumerated in DYNAMIC_KEYS' },
  { pattern: 'status.${journey.status}', reason: 'enumerated in DYNAMIC_KEYS from JourneyStatus' },
  {
    pattern: 'vehicleTypeInfo.${journey.vehiclePreference',
    reason: 'enumerated in DYNAMIC_KEYS from VehicleType',
  },
  { pattern: 'payments.status.${', reason: 'enumerated in DYNAMIC_KEYS from EscrowStatus' },
  { pattern: 'journey.status.${', reason: 'enumerated in DYNAMIC_KEYS from JourneyStatus' },
  { pattern: 'welcome.screen${', reason: 'enumerated in DYNAMIC_KEYS (3 screens)' },
  { pattern: 'admin.funnel.cityBands.${', reason: 'enumerated in DYNAMIC_KEYS from CITY_BAND_KEYS' },
  {
    pattern: 'goods.size_${',
    reason:
      'small/medium/large enumerated in DYNAMIC_KEYS; the GoodsPickupPage variant reads the ' +
      'legacy journey.goodsSize field, which the server no longer populates (guarded by &&)',
  },
  {
    pattern: 'rating.reason.${key}',
    reason:
      'TEAM-ANSWERS G2 — the low-star reason dropdown; enumerated in DYNAMIC_KEYS from ' +
      'RATING_REASONS, so a new reason key without its three labels fails the completeness test',
  },
  {
    pattern: 'report.reason.${key}',
    reason:
      'TEAM-ANSWERS G3 — the driver-report reason dropdown; enumerated in DYNAMIC_KEYS from ' +
      'RIDE_REPORT_REASONS on the same terms',
  },
  {
    pattern: 'rating.reason.${submittedReason}',
    reason:
      'TEAM-ANSWERS G2 read-back — enumerated in DYNAMIC_KEYS from RATING_REASONS, and ' +
      'carries a defaultValue so a row stored under a since-migrated key renders that key ' +
      'rather than a raw dotted path',
  },
  {
    pattern: 'sync.rejection.${',
    reason: 'carries a defaultValue fallback — an unknown code renders the server message, not a raw key',
  },
  {
    pattern: '${question.i18nOptionKeyPrefix}',
    reason: 'enumerated in DYNAMIC_KEYS from SCREENER_QUESTIONS',
  },
  {
    pattern: '${question.optionDescriptionKeyPrefix}',
    reason: "carries defaultValue: '' — a missing description renders nothing, not a raw key",
  },
  {
    pattern: '${question.i18nKey',
    reason: 'screener prompt keys: literal i18nKey/helpKey props on SCREENER_QUESTIONS are caught by the *Key property extraction',
  },
];

// ------------------------------------------------------------------ tests

const { used, templates } = extract();
const allKeys = [...new Set([...used.keys(), ...DYNAMIC_KEYS])].sort();

describe('i18n used-key completeness (extractor gate)', () => {
  test('extractor sanity: it still sees the app at all', () => {
    // If a refactor broke the walker/regexes this would silently pass
    // with an empty set — pin a floor well below the real count (~700).
    expect(used.size).toBeGreaterThan(300);
  });

  for (const locale of ['en', 'fr', 'rw'] as const) {
    test(`every used key exists in ${locale}`, () => {
      const missing = allKeys
        .filter((k) => !locales[locale].has(k))
        .map((k) => `${k} (${used.get(k) ?? 'dynamic enumeration'})`);
      expect(missing).toEqual([]);
    });
  }

  test('every template t() call is enumerated or allowlisted', () => {
    const unclassified = [...templates.entries()]
      .filter(([tpl]) => !TEMPLATE_ALLOWLIST.some((a) => tpl.includes(a.pattern)))
      .map(([tpl, where]) => `t(\`${tpl}\`) at ${where}`);
    expect(unclassified).toEqual([]);
  });
});
