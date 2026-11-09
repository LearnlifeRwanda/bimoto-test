import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface WelcomeScreen {
  heading: string;
  body: string;
  Illustration?: React.ComponentType<{ 'aria-label'?: string }>;
}

export interface WelcomeCarouselProps {
  screens: WelcomeScreen[];
  onScreenChange?: (index: number) => void;
}

const SWIPE_THRESHOLD_PX = 40;

export const WelcomeCarousel: React.FC<WelcomeCarouselProps> = ({ screens, onScreenChange }) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(screens.length - 1, next));
    if (clamped === current) return;
    setCurrent(clamped);
    onScreenChange?.(clamped);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    go(current + (delta < 0 ? 1 : -1));
  };

  const screen = screens[current];

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-6">
      <div
        className="w-full text-center px-2 select-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        role="region"
        aria-roledescription="carousel"
        aria-label={t('welcome.carouselLabel', { defaultValue: 'Welcome to Bimoto' })}
      >
        {screen?.Illustration && (
          <div className="flex justify-center mb-4">
            <screen.Illustration
              aria-label={t(`welcome.screen${current + 1}.illustrationAlt`)}
            />
          </div>
        )}
        {/* UI-POLISH G3 — the welcome headline is one of the two places
            Playfair Display is allowed (founder decision); weight must
            stay 600 (the only weight shipped). */}
        <h1 className="font-display text-title font-semibold text-[#1B4F72] mb-4">{screen?.heading}</h1>
        <p className="text-base text-gray-700 leading-relaxed">{screen?.body}</p>
      </div>
      <div
        className="flex flex-row"
        role="tablist"
        aria-label={t('welcome.dotsLabel', { defaultValue: 'Carousel position' })}
      >
        {screens.map((_, idx) => {
          const active = idx === current;
          return (
            /* PILOT-READY G1 — 44px hit area around the unchanged 12px
               visual dot; inactive dots darkened to gray-500 (3:1+). */
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? 'true' : undefined}
              aria-label={t('welcome.dotAria', { defaultValue: 'Screen {{n}}', n: idx + 1 })}
              onClick={() => go(idx)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              data-dot-index={idx}
            >
              <span
                className={`w-3 h-3 rounded-full transition-colors duration-150 ${
                  active ? 'bg-[#1B4F72]' : 'bg-gray-500 hover:bg-gray-600'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
