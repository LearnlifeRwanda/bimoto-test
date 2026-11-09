import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/ui.store';

// Kinyarwanda is listed first so the pilot population's default
// language is the leftmost choice — the first thing a first-launch
// user sees in the WelcomePage header. Flag emoji per the founder's
// ask for a visible flag-style switcher (no icon dependency).
const LANGUAGES = [
  { code: 'rw', flag: '🇷🇼', shortLabel: 'RW', fullLabelKey: 'welcome.languageRw', fallbackFullLabel: 'Kinyarwanda' },
  { code: 'en', flag: '🇬🇧', shortLabel: 'EN', fullLabelKey: 'welcome.languageEn', fallbackFullLabel: 'English' },
  { code: 'fr', flag: '🇫🇷', shortLabel: 'FR', fullLabelKey: 'welcome.languageFr', fallbackFullLabel: 'Français' },
] as const;

export interface LanguageSwitcherProps {
  /**
   * 'compact' — original two-letter chips used in headers/settings.
   * 'welcome' — larger pills with full language names, used above
   *             the fold on the first-launch WelcomePage so a user who
   *             cannot read the default locale can switch immediately.
   */
  variant?: 'compact' | 'welcome';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'compact' }) => {
  const { t, i18n } = useTranslation();
  const setLanguage = useUIStore((s) => s.setLanguage);
  const currentLang = useUIStore((s) => s.language);

  const handleSwitch = (code: string) => {
    i18n.changeLanguage(code);
    setLanguage(code);
  };

  const isWelcome = variant === 'welcome';
  const groupClasses = isWelcome ? 'flex flex-row gap-2 w-full justify-center' : 'flex flex-row gap-1';
  const groupLabel = isWelcome
    ? t('welcome.languageLabel', { defaultValue: 'Choose language' })
    : t('settings.language');

  return (
    <div className={groupClasses} role="group" aria-label={groupLabel}>
      {LANGUAGES.map((lang) => {
        const selected = currentLang === lang.code;
        const displayLabel = isWelcome
          ? t(lang.fullLabelKey, { defaultValue: lang.fallbackFullLabel })
          : lang.shortLabel;
        const sizeClasses = isWelcome
          ? 'flex-1 min-h-[52px] px-4 py-3 rounded-xl text-base'
          : 'min-w-[44px] min-h-[44px] px-3 py-2 rounded-lg text-sm';
        return (
          <button
            key={lang.code}
            onClick={() => handleSwitch(lang.code)}
            className={`
              ${sizeClasses}
              font-semibold transition-colors duration-150
              ${
                selected
                  ? 'bg-[#1B4F72] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300'
              }
            `}
            aria-pressed={selected}
            aria-label={displayLabel}
            data-lang={lang.code}
          >
            <span aria-hidden="true">{lang.flag}</span> {displayLabel}
          </button>
        );
      })}
    </div>
  );
};
