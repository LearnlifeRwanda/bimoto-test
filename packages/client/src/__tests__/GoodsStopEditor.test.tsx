import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { GoodsStopEditor } from '../components/journey/GoodsStopEditor';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      delivery: {
        stopTypeLabel: 'Stop type',
        stopTypeGoodsDropoff: 'Drop off a parcel',
        stopTypeGoodsPickup: 'Pick up a parcel',
        stopNameLabel: 'Address or landmark',
        stopNamePlaceholder: 'e.g., Post office',
        parcelSizeLabel: 'Parcel size',
        parcelSizeSmall: 'Small (≤ 5 kg)',
        parcelSizeMedium: 'Medium (5–15 kg)',
        parcelSizeLarge: 'Large (15–30 kg)',
        parcelCategoryLabel: 'Parcel contents',
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
        contactNameLabel: 'Recipient name (optional)',
        contactPhoneLabel: 'Recipient phone (optional)',
        saveStop: 'Save stop',
        cancelStop: 'Cancel',
        recipientLanguageLabel: "Recipient's preferred language (optional)",
        recipientLanguageAuto: 'Auto (use mine)',
        languageRw: 'Kinyarwanda',
        languageEn: 'English',
        languageFr: 'French',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('GoodsStopEditor — R3-DELIVERY', () => {
  test('renders all 3 parcel-size options + 2 stop types', () => {
    render(<GoodsStopEditor onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId('parcel-size-SMALL')).toBeInTheDocument();
    expect(screen.getByTestId('parcel-size-MEDIUM')).toBeInTheDocument();
    expect(screen.getByTestId('parcel-size-LARGE')).toBeInTheDocument();
    expect(screen.getByTestId('stop-type-GOODS_DROPOFF')).toBeInTheDocument();
    expect(screen.getByTestId('stop-type-GOODS_PICKUP')).toBeInTheDocument();
  });

  test('save is disabled until a name is entered', () => {
    render(<GoodsStopEditor onSave={() => {}} onCancel={() => {}} />);
    const save = screen.getByTestId('stop-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    expect(save.disabled).toBe(false);
  });

  test('onSave receives a fully assembled LegInput with parcelSize', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office near KCT' },
    });
    fireEvent.click(screen.getByTestId('parcel-size-LARGE'));
    fireEvent.click(screen.getByTestId('stop-type-GOODS_PICKUP'));
    fireEvent.click(screen.getByTestId('stop-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const leg = onSave.mock.calls[0][0];
    expect(leg.type).toBe('GOODS_PICKUP');
    expect(leg.parcelSize).toBe('LARGE');
    expect(leg.name).toBe('Post office near KCT');
    expect(typeof leg.lat).toBe('number');
    expect(typeof leg.lng).toBe('number');
  });

  test('cancel calls onCancel without saving', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('stop-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('contact name + phone are passed through when entered', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.change(screen.getByTestId('contact-name-input'), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByTestId('contact-phone-input'), {
      target: { value: '+250788000000' },
    });
    fireEvent.click(screen.getByTestId('stop-save'));
    const leg = onSave.mock.calls[0][0];
    expect(leg.contactName).toBe('Alice');
    expect(leg.contactPhone).toBe('+250788000000');
  });

  // R3-DELIVERY-V2 — parcel content category.
  test('renders all 5 parcel-category options', () => {
    render(<GoodsStopEditor onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId('parcel-category-FOOD')).toBeInTheDocument();
    expect(
      screen.getByTestId('parcel-category-ELECTRONICS'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('parcel-category-DOCUMENTS'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('parcel-category-FRAGILE')).toBeInTheDocument();
    expect(screen.getByTestId('parcel-category-OTHER')).toBeInTheDocument();
  });

  test('submits with parcelCategory FRAGILE when FRAGILE selected', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('parcel-category-FRAGILE'));
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(onSave.mock.calls[0][0].parcelCategory).toBe('FRAGILE');
  });

  test('defaults parcelCategory to OTHER when no category selected', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(onSave.mock.calls[0][0].parcelCategory).toBe('OTHER');
  });

  // R3-DELIVERY-NOTIFICATIONS-2 — per-recipient language hint.
  test('recipient-language selector hidden until contactPhone is entered', () => {
    render(<GoodsStopEditor onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByTestId('recipient-language-auto')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contact-phone-input'), {
      target: { value: '+250788000000' },
    });
    expect(screen.getByTestId('recipient-language-auto')).toBeInTheDocument();
    expect(screen.getByTestId('recipient-language-rw')).toBeInTheDocument();
    expect(screen.getByTestId('recipient-language-en')).toBeInTheDocument();
    expect(screen.getByTestId('recipient-language-fr')).toBeInTheDocument();
  });

  test('submits with recipientLanguage=rw when explicitly selected', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.change(screen.getByTestId('contact-phone-input'), {
      target: { value: '+250788000000' },
    });
    fireEvent.click(screen.getByTestId('recipient-language-rw'));
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(onSave.mock.calls[0][0].recipientLanguage).toBe('rw');
  });

  test('omits recipientLanguage from submission when Auto remains selected', () => {
    const onSave = vi.fn();
    render(<GoodsStopEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.change(screen.getByTestId('contact-phone-input'), {
      target: { value: '+250788000000' },
    });
    // Default selection is Auto (null) — no click needed.
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(onSave.mock.calls[0][0].recipientLanguage).toBeUndefined();
  });
});
