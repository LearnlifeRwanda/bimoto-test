// LIVE-WIRE G5 — the parcel speed surface ends at exactly two options,
// plus the optional window Jean asked for.
//
// The field saw three ("Normal, Standard, Express"). G1 established why:
// #160 shipped the two-option DeliverySpeed picker but LEFT the older
// urgency-tier group (Normal / Priority / Urgent) directly above it,
// labelled — in en — "Delivery speed". Read top to bottom that is one
// list of three. The tier group is a routing control into the
// priority/urgent flows and cannot be removed without changing
// navigation, so it is relabelled for what it is; this suite pins both
// halves of that so they cannot drift back together.

import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeliverySpeed } from '@bimoto/shared';
import { DeliverySpeedTag } from '../components/journey/DeliverySpeedTag';
import en from '../../public/locales/en/translation.json';
import fr from '../../public/locales/fr/translation.json';
import rw from '../../public/locales/rw/translation.json';

describe('the speed enum itself', () => {
  test('is exactly two values', () => {
    expect(Object.values(DeliverySpeed).sort()).toEqual(['EXPRESS', 'STANDARD']);
  });
});

describe('the two adjacent groups no longer read as one list', () => {
  const locales = { en, fr, rw } as Record<string, any>;

  test.each(['en', 'fr', 'rw'])(
    '%s: the urgency-tier group and the speed group have distinct labels',
    (lang) => {
      const l = locales[lang];
      expect(l.goods.tierLabel).toBeTruthy();
      expect(l.delivery.speedLabel).toBeTruthy();
      expect(l.goods.tierLabel).not.toBe(l.delivery.speedLabel);
    },
  );

  test('en: the urgency group is no longer labelled "Delivery speed"', () => {
    // The precise regression: two groups, both called the speed of
    // delivery, stacked. Only the two-option one may carry that name.
    expect(en.goods.tierLabel).not.toMatch(/delivery speed/i);
    expect(en.delivery.speedLabel).toMatch(/delivery speed/i);
  });
});

describe('the optional 1/2/3-hour window', () => {
  test('every locale carries the window copy', () => {
    for (const l of [en, fr, rw] as any[]) {
      expect(l.delivery.standardHoursLabel).toBeTruthy();
      expect(l.delivery.standardHoursAny).toBeTruthy();
      expect(l.delivery.standardHoursN).toContain('{{count}}');
      expect(l.delivery.standardHoursWithin).toContain('{{count}}');
      expect(l.delivery.standardHoursNote).toBeTruthy();
    }
  });

  test('the note tells the sender it changes no price', () => {
    // The invariant this dispatch carries, said out loud on the screen
    // that could most easily imply otherwise.
    expect(en.delivery.standardHoursNote).toMatch(/does not change the price/i);
  });

  test('the motari sees the window on a STANDARD parcel', () => {
    render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.STANDARD} standardDeliveryHours={2} />);
    expect(screen.getByTestId('delivery-speed-window')).toBeInTheDocument();
  });

  test('an EXPRESS parcel never shows a window, even if one is somehow set', () => {
    // Express means now. The server drops hours on a non-STANDARD
    // create; this is the second line of that defence, on the screen.
    render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.EXPRESS} standardDeliveryHours={3} />);
    expect(screen.queryByTestId('delivery-speed-window')).not.toBeInTheDocument();
  });

  test('a STANDARD parcel with no window shows the tier alone', () => {
    render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.STANDARD} />);
    expect(screen.getByTestId('delivery-speed-tag')).toBeInTheDocument();
    expect(screen.queryByTestId('delivery-speed-window')).not.toBeInTheDocument();
  });

  test('a parcel booked before speeds existed renders nothing at all', () => {
    const { container } = render(<DeliverySpeedTag deliverySpeed={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
