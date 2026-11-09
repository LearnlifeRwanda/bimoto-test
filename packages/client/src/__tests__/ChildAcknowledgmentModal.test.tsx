import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { ChildAcknowledgmentModal } from '../components/journey/ChildAcknowledgmentModal';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      child: {
        ackTitle: 'This trip carries a child passenger',
        ackSafety1: 'I will drive slower than for adult passengers',
        ackSafety2: 'I will refuse the trip if I do not have a child-appropriate helmet',
        ackSafety3: 'I will not exceed urban speed limits',
        ackConfirm: 'I understand',
        ackCancel: 'Cancel',
      },
      common: { loading: 'Loading' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('ChildAcknowledgmentModal — R3-CHILD', () => {
  test('renders nothing when open=false', () => {
    const { container } = render(
      <ChildAcknowledgmentModal open={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders title and 3 safety lines when open=true', () => {
    render(
      <ChildAcknowledgmentModal open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText('This trip carries a child passenger')).toBeInTheDocument();
    const list = screen.getByTestId('child-ack-safety-list');
    expect(list.children).toHaveLength(3);
  });

  test('confirm button invokes onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ChildAcknowledgmentModal open={true} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('child-ack-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('cancel button invokes onCancel and not onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ChildAcknowledgmentModal open={true} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('child-ack-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('has proper a11y attributes (role=dialog, aria-modal, aria-labelledby)', () => {
    render(
      <ChildAcknowledgmentModal open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const modal = screen.getByTestId('child-acknowledgment-modal');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(modal).toHaveAttribute('aria-labelledby', 'child-ack-title');
  });
});
