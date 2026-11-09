// FIELD-BATCH G1 — registration role glyphs.
//
// Barack's field report of 1 August: the driver option showed a car on a
// moto-taxi service. The swap ran deeper — the customer option was
// carrying the motorcycle. These tests pin the pairing to the option
// VALUE (not to render order), so the two can never silently invert
// again, and assert the car is gone from the screen entirely.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import './setup';
import { RegisterPage, ROLE_ICONS } from '../pages/auth/RegisterPage';
import { useAuthStore } from '../stores/auth.store';

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
    registrationPendingUserId: null,
  });
});

describe('registration role icons (FIELD-BATCH G1)', () => {
  test('the motari option carries the motorcycle', () => {
    expect(ROLE_ICONS.DRIVER).toBe('🏍️');
  });

  test('the customer option carries a person, not a vehicle', () => {
    expect(ROLE_ICONS.CUSTOMER).toBe('🙋');
  });

  test('BOTH stays the two-way arrow', () => {
    expect(ROLE_ICONS.BOTH).toBe('↔️');
  });

  test('no car glyph survives anywhere in the role set', () => {
    expect(Object.values(ROLE_ICONS)).not.toContain('🚗');
  });

  test('every role glyph is distinct', () => {
    const glyphs = Object.values(ROLE_ICONS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  test('each rendered option shows the glyph bound to its own value', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    for (const value of ['CUSTOMER', 'DRIVER', 'BOTH'] as const) {
      const button = screen.getByTestId(`register-role-${value}`);
      expect(button).toHaveTextContent(ROLE_ICONS[value]);
    }
  });

  test('the rendered screen shows no car', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('register-role-DRIVER').textContent).not.toContain('🚗');
    expect(screen.getByTestId('register-role-CUSTOMER').textContent).not.toContain('🏍️');
  });
});
