// Tests for the welcome carousel illustration layer
// (Dispatch R3-WELCOME-VISUAL-LAYER). First coverage for the carousel.
import { describe, test, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from '../../../__tests__/setup';

import { WelcomeCarousel } from '../WelcomeCarousel';
import type { WelcomeScreen } from '../WelcomeCarousel';
import {
  WelcomeIllustration1,
  WelcomeIllustration2,
  WelcomeIllustration3,
} from '../illustrations';

// The shared test i18n stub doesn't carry the welcome.* keys, so register the
// alt-text the carousel looks up via t(`welcome.screen${n}.illustrationAlt`).
const ALT = {
  screen1: 'Motorcycle and bicycle illustration',
  screen2: 'Cooperative network illustration',
  screen3: 'Fixed-price bidding illustration',
};

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      welcome: {
        screen1: { illustrationAlt: ALT.screen1 },
        screen2: { illustrationAlt: ALT.screen2 },
        screen3: { illustrationAlt: ALT.screen3 },
      },
    },
    true,
    true,
  );
});

const screens: WelcomeScreen[] = [
  { heading: 'One', body: 'Body one', Illustration: WelcomeIllustration1 },
  { heading: 'Two', body: 'Body two', Illustration: WelcomeIllustration2 },
  { heading: 'Three', body: 'Body three', Illustration: WelcomeIllustration3 },
];

const ALLOWED_PALETTE = ['#1b4f72', '#f39c12', '#f8f9fa', '#212529', 'none'];

describe('WelcomeCarousel illustrations', () => {
  test('renders WelcomeIllustration1 on slide 1', () => {
    render(<WelcomeCarousel screens={screens} />);
    expect(screen.getByRole('img', { name: ALT.screen1 })).toBeInTheDocument();
  });

  test('renders WelcomeIllustration2 on slide 2', () => {
    render(<WelcomeCarousel screens={screens} />);
    // The 3-dot pager exposes one tab per screen; click the second.
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('img', { name: ALT.screen2 })).toBeInTheDocument();
  });

  test('renders WelcomeIllustration3 on slide 3', () => {
    render(<WelcomeCarousel screens={screens} />);
    fireEvent.click(screen.getAllByRole('tab')[2]);
    expect(screen.getByRole('img', { name: ALT.screen3 })).toBeInTheDocument();
  });
});

describe('illustration brand-palette compliance', () => {
  const cases: Array<[string, React.ComponentType<{ 'aria-label'?: string }>]> = [
    ['WelcomeIllustration1', WelcomeIllustration1],
    ['WelcomeIllustration2', WelcomeIllustration2],
    ['WelcomeIllustration3', WelcomeIllustration3],
  ];

  test.each(cases)('%s uses only brand-palette hex values', (_name, Illustration) => {
    const { container } = render(<Illustration aria-label="test" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    svg!.querySelectorAll('*').forEach((el) => {
      (['fill', 'stroke'] as const).forEach((attr) => {
        const value = el.getAttribute(attr);
        if (value !== null) {
          expect(ALLOWED_PALETTE).toContain(value.toLowerCase());
        }
      });
    });
  });

  test.each(cases)('%s has viewBox="0 0 160 160"', (_name, Illustration) => {
    const { container } = render(<Illustration aria-label="test" />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 160 160');
  });

  test.each(cases)('%s has a <title> referenced by aria-labelledby', (_name, Illustration) => {
    const { container } = render(<Illustration aria-label="My alt text" />);
    const svg = container.querySelector('svg')!;
    const labelledby = svg.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    const title = svg.querySelector('title');
    expect(title).not.toBeNull();
    expect(title!.id).toBe(labelledby);
    expect(title!.textContent).toBe('My alt text');
  });
});
