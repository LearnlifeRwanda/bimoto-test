// FIELD-FIT G4 — one set of vehicle glyphs, for every screen that asks
// a person to choose a vehicle.
//
// The team reported twice that the app does not look like the service it
// is. Reproducing it (docs/field-fit-reproduction.md, row 4a) found the
// opposite of what was assumed: no car imagery survived anywhere, but
// the icons that were supposed to carry the moto identity were not on
// screen at all. VehicleSelector.tsx held them and was imported by
// nothing; the three pickers people actually use — the passenger's ride
// form, the motari's registration, and Settings — rendered plain text
// buttons. So the glyphs move here, and the pickers use them.
//
// Deliberate deviation from the dispatch, which said to reuse
// VehicleSelector's icons as-is: its MOTO and E_MOTO glyph was a
// lightning bolt, not a motorcycle. Shipping a bolt as the moto icon
// would miss the point of the report, so MOTO is drawn as a motorcycle
// here. The bicycle glyph was always a bicycle and is unchanged, and
// the bolt survives in the role it was actually doing — marking the
// electric variants. (vehicle-icons.test.tsx pins the old bolt path out
// of the whole source tree, so it cannot creep back.)
//
// No icon library: these are the same inline 24x24 stroke SVGs the rest
// of the app uses, so nothing is added to the bundle.
import React from 'react';
import { VehicleType } from '@bimoto/shared';

const ElectricSpark = (
  <path
    d="M20.5 2.5l-2.2 3h2.2l-2.2 3"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

const Bicycle = (
  <>
    <circle cx="5" cy="17" r="3" />
    <circle cx="19" cy="17" r="3" />
    <path d="M5 17l4-7h3l2.5 4.5H19" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 10h4" strokeLinecap="round" />
  </>
);

const Motorcycle = (
  <>
    <circle cx="5" cy="17" r="3" />
    <circle cx="19" cy="17" r="3" />
    {/* frame: rear wheel → engine → front fork */}
    <path d="M5 17h3.5l3.5-5.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
    {/* seat and tank */}
    <path d="M6 11.5h5l1.5 2" strokeLinecap="round" strokeLinejoin="round" />
    {/* fork down to the front wheel, and the handlebar */}
    <path d="M16.5 11.5L19 17" strokeLinecap="round" />
    <path d="M14.5 8.5h3.5" strokeLinecap="round" />
    <path d="M16 8.5l0.5 3" strokeLinecap="round" />
  </>
);

function glyph(body: React.ReactNode, electric: boolean, className: string) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      {body}
      {electric && ElectricSpark}
    </svg>
  );
}

/**
 * The glyph for a vehicle type. `className` defaults to the 24px size
 * every existing caller uses.
 */
export function vehicleIcon(
  vehicleType: string,
  className = 'w-6 h-6',
): React.ReactNode {
  switch (vehicleType) {
    case VehicleType.BIKE:
      return glyph(Bicycle, false, className);
    case VehicleType.E_BIKE:
      return glyph(Bicycle, true, className);
    case VehicleType.E_MOTO:
      return glyph(Motorcycle, true, className);
    case VehicleType.MOTO:
    default:
      return glyph(Motorcycle, false, className);
  }
}

/** "No preference" — used only by the passenger-side VehicleSelector. */
export function anyVehicleIcon(className = 'w-6 h-6'): React.ReactNode {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
