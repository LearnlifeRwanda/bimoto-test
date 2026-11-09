// FIELD-FIT G4 — the app looks like the service it is.
//
// The team reported twice that the app does not look like motorcycles.
// The reproduction found the cause was not car imagery (none survives
// anywhere) but absence: VehicleSelector held the glyphs and was
// imported by nothing, and every picker a person actually touches
// rendered text-only buttons.
//
// These tests pin the two halves of that fix: the glyph set exists and
// distinguishes the four vehicle types, and it reaches the screens.

import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { vehicleIcon, anyVehicleIcon } from '../components/journey/vehicle-icons';

const SRC = join(__dirname, '..');
const VEHICLE_TYPES = ['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE'] as const;

function markup(node: React.ReactNode): string {
  const { container } = render(<>{node}</>);
  return container.innerHTML;
}

describe('the vehicle glyph set', () => {
  test('every vehicle type renders an svg', () => {
    for (const vt of VEHICLE_TYPES) {
      expect(markup(vehicleIcon(vt))).toContain('<svg');
    }
    expect(markup(anyVehicleIcon())).toContain('<svg');
  });

  test('the four types are visually distinct from one another', () => {
    const drawn = VEHICLE_TYPES.map((vt) => markup(vehicleIcon(vt)));
    expect(new Set(drawn).size).toBe(VEHICLE_TYPES.length);
  });

  test('a moto is drawn as a motorcycle, not as the old lightning bolt', () => {
    // The bolt path VehicleSelector used to ship as its MOTO glyph.
    const BOLT = 'M13 10V3L4 14h7v7l9-11h-7z';
    expect(markup(vehicleIcon('MOTO'))).not.toContain(BOLT);
    expect(markup(vehicleIcon('E_MOTO'))).not.toContain(BOLT);
    // Two wheels is what makes it read as a machine you ride.
    expect(markup(vehicleIcon('MOTO')).match(/<circle/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('the electric variants are their base vehicle plus a mark', () => {
    // E_MOTO differs from MOTO, E_BIKE from BIKE, but a moto never
    // becomes a bicycle by being electric.
    expect(markup(vehicleIcon('E_MOTO'))).not.toBe(markup(vehicleIcon('MOTO')));
    expect(markup(vehicleIcon('E_BIKE'))).not.toBe(markup(vehicleIcon('BIKE')));
    const motoBody = markup(vehicleIcon('MOTO')).replace(/<\/svg>$/, '');
    expect(markup(vehicleIcon('E_MOTO')).startsWith(motoBody.slice(0, 80))).toBe(true);
  });

  test('an unknown vehicle type still draws something rather than nothing', () => {
    expect(markup(vehicleIcon('SOMETHING_NEW'))).toContain('<svg');
  });
});

describe('the glyphs reach the screens that ask people to choose', () => {
  // Source-level, so this cannot pass because a test rendered the icon
  // itself: the three real pickers must import the shared glyph module.
  // (VehicleSelector.tsx used to be a fourth entry here. DEADWOOD G2
  // retired it — no screen ever imported it — so the list is now
  // exactly the pickers a person can actually reach.)
  const PICKERS = [
    'pages/customer/NewJourneyPage.tsx',
    'pages/auth/RegisterPage.tsx',
    'pages/shared/SettingsPage.tsx',
  ];

  for (const rel of PICKERS) {
    test(`${rel} uses the shared glyphs`, () => {
      const source = readFileSync(join(SRC, rel), 'utf8');
      expect(source).toMatch(/from ['"].*vehicle-icons['"]/);
      expect(source).toMatch(/vehicleIcon\(|anyVehicleIcon\(/);
    });
  }

  test('no picker draws its own private vehicle glyph any more', () => {
    // The bolt path must not survive anywhere outside the glyph module.
    const BOLT = 'M13 10V3L4 14h7v7l9-11h-7z';
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (readFileSync(p, 'utf8').includes(BOLT)) offenders.push(p.replace(SRC, ''));
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
