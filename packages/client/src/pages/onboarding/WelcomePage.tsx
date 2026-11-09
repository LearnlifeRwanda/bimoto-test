import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { Wordmark } from '../../components/ui/Wordmark';
import { WelcomeCarousel } from '../../components/welcome/WelcomeCarousel';
import {
  WelcomeIllustration1,
  WelcomeIllustration2,
  WelcomeIllustration3,
} from '../../components/welcome/illustrations';
import { useHasSeenWelcome } from '../../hooks/usePreferences';

export const WelcomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { markSeen } = useHasSeenWelcome();

  const handleContinue = async () => {
    await markSeen();
    navigate('/login', { replace: true });
  };

  const screens = [
    {
      heading: t('welcome.screen1.heading'),
      body: t('welcome.screen1.body'),
      Illustration: WelcomeIllustration1,
    },
    {
      heading: t('welcome.screen2.heading'),
      body: t('welcome.screen2.body'),
      Illustration: WelcomeIllustration2,
    },
    {
      heading: t('welcome.screen3.heading'),
      body: t('welcome.screen3.body'),
      Illustration: WelcomeIllustration3,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="px-4 pt-6 pb-2 flex items-center justify-between">
        <Wordmark size="sm" />
        <LanguageSwitcher variant="welcome" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <WelcomeCarousel screens={screens} />
      </main>
      <footer className="px-6 pb-8 flex flex-col gap-3 max-w-md w-full mx-auto">
        <Button fullWidth size="lg" variant="primary" onClick={handleContinue}>
          {t('welcome.continue')}
        </Button>
        <button
          type="button"
          onClick={handleContinue}
          className="text-sm text-gray-500 underline min-h-[44px]"
        >
          {t('welcome.skip')}
        </button>
        {/* DRIVER-ID v3 — public entry point to the live driver-number
            check (no login required). */}
        <button
          type="button"
          onClick={() => navigate('/check-driver')}
          className="text-sm text-gray-500 underline min-h-[44px]"
        >
          {t('checkDriver.title')}
        </button>
        {/* FIELD-CLOSE G3 — the guide is public, so it is readable
            before login too.
            TRUE-WORDS — the 13-Aug review gives this link its own
            Kinyarwanda wording ("Amabwiriza"), shorter than the profile
            entry's ("Imfashanyigisho y'ukoresha ino service"), so the two
            surfaces carry separate keys. */}
        <button
          type="button"
          onClick={() => navigate('/guide')}
          data-testid="welcome-guide-link"
          className="text-sm text-gray-500 underline min-h-[44px]"
        >
          {t('guide.welcomeLink')}
        </button>
      </footer>
    </div>
  );
};

export default WelcomePage;
