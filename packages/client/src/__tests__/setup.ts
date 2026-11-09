import '@testing-library/jest-dom/vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Minimal i18n bootstrap for component tests. We only register the keys
// the chat components actually look up via t(); the canned-message
// strings come from QUICK_MESSAGES in @bimoto/shared, not from these
// resources, so a minimal stub is sufficient.
const stub = {
  chat: {
    sentAt: 'Sent at {{time}}',
    quickMessages: 'Quick messages',
    inputPlaceholder: 'Type a message...',
    send: 'Send',
    title: 'Chat',
    fetchFailed: 'Failed to load messages',
    sendFailed: 'Failed to send',
    noMessages: 'No messages yet',
  },
  common: { back: 'Back' },
  vehicleTypeInfo: {
    bike: { label: 'Bicycle' },
    e_bike: { label: 'Electric bicycle' },
    moto: { label: 'Motorcycle' },
    e_moto: { label: 'Electric motorcycle' },
    speedHint: 'Typical speed: ~{{speed}} km/h',
    fareHint: {
      bike: 'Lower fare (~70% of motorcycle)',
      e_bike: 'Moderate fare (~85% of motorcycle)',
      moto: 'Standard fare',
      e_moto: 'Slightly above standard (~105%)',
    },
    helmetRequired: 'Helmet required',
    helmetNotRequired: 'No helmet needed',
    packageSize: {
      small: 'Small packages only (under 3 kg)',
      medium: 'Medium packages (up to 15 kg)',
    },
  },
};

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: stub },
      rw: { translation: stub },
      fr: { translation: stub },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

afterEach(() => {
  cleanup();
});

export { i18n };
