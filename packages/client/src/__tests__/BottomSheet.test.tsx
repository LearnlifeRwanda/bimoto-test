// __TESTS__/BOTTOM-SHEET.TEST.TSX
//
// PILOT-UX-2 G5 — the sliding sheet's two snap states: handle tap
// toggles, a drag past the threshold snaps to the other state, a short
// drag snaps back, and content stays rendered in both states.

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BottomSheet } from '../components/map/BottomSheet';

function drag(handle: HTMLElement, fromY: number, toY: number) {
  fireEvent.touchStart(handle, { touches: [{ clientY: fromY }] });
  fireEvent.touchMove(handle, { touches: [{ clientY: toY }] });
  fireEvent.touchEnd(handle);
}

describe('BottomSheet — PILOT-UX-2 G2', () => {
  test('renders its content and reflects the current state', () => {
    render(
      <BottomSheet state="collapsed" onStateChange={vi.fn()}>
        <p>sheet content</p>
      </BottomSheet>,
    );
    expect(screen.getByText('sheet content')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-sheet').dataset.sheetState).toBe('collapsed');
  });

  test('tapping the handle toggles collapsed → expanded and back', () => {
    const onStateChange = vi.fn();
    const { rerender } = render(
      <BottomSheet state="collapsed" onStateChange={onStateChange}>
        <p>c</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-handle'));
    expect(onStateChange).toHaveBeenLastCalledWith('expanded');

    rerender(
      <BottomSheet state="expanded" onStateChange={onStateChange}>
        <p>c</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-handle'));
    expect(onStateChange).toHaveBeenLastCalledWith('collapsed');
  });

  test('dragging up past the threshold expands a collapsed sheet', () => {
    const onStateChange = vi.fn();
    render(
      <BottomSheet state="collapsed" onStateChange={onStateChange}>
        <p>c</p>
      </BottomSheet>,
    );
    drag(screen.getByTestId('sheet-handle'), 500, 380);
    expect(onStateChange).toHaveBeenCalledWith('expanded');
  });

  test('dragging down past the threshold collapses an expanded sheet', () => {
    const onStateChange = vi.fn();
    render(
      <BottomSheet state="expanded" onStateChange={onStateChange}>
        <p>c</p>
      </BottomSheet>,
    );
    drag(screen.getByTestId('sheet-handle'), 200, 320);
    expect(onStateChange).toHaveBeenCalledWith('collapsed');
  });

  test('a short drag snaps back without a state change', () => {
    const onStateChange = vi.fn();
    render(
      <BottomSheet state="collapsed" onStateChange={onStateChange}>
        <p>c</p>
      </BottomSheet>,
    );
    drag(screen.getByTestId('sheet-handle'), 500, 480);
    expect(onStateChange).not.toHaveBeenCalled();
  });
});
