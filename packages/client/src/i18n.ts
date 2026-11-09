// NOTE: Kinyarwanda translations (rw) remain AI-generated pending
// professional native-speaker review. Translator packet:
// docs/i18n-translator-brief.md, docs/i18n-glossary.md,
// docs/i18n-rw-review.md. Budget: ~$400, Timeline: 1-2 weeks.
//
// Canned chat messages (QUICK_MESSAGES in @bimoto/shared) are now
// cross-language: each device renders the receiver's locale via
// ChatBubble's quickMessageId lookup. Free-text chat passes verbatim
// (cross-language free text is on the Year 2 roadmap).

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../public/locales/en/translation.json';
import fr from '../public/locales/fr/translation.json';
import rw from '../public/locales/rw/translation.json';
import { prefs } from './hooks/usePreferences';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    rw: { translation: rw },
  },
  lng: prefs.getSync('bimoto-lang') || 'rw',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Dev/test handle for Playwright: lets the e2e suite trigger
// changeLanguage() without finding the user-facing language switcher.
// Stripped from production builds.
if (typeof window !== 'undefined' && (import.meta.env.MODE !== 'production' || import.meta.env.VITE_E2E_TESTING === 'true')) {
  (window as unknown as { __BIMOTO_I18N__?: typeof i18n }).__BIMOTO_I18N__ = i18n;
}

export default i18n;
