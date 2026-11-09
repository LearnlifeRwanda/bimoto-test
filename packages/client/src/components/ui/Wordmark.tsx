// UI-POLISH G3 — the Bimoto wordmark. Text-based on purpose (no image
// asset): it renders in self-hosted Playfair Display 600 (`font-display`)
// and inherits the offline guarantees of the font pipeline. Playfair
// ships at weight 600 only, so the weight here must stay font-semibold —
// font-bold would make the WebView synthesize a faux-bold.
//
// `lg` is the hero lockup (welcome/login); `sm` is the compact lockup
// for header bars. Both fit a 320px viewport without wrapping
// (whitespace-nowrap guards the proper noun anyway).

import React from 'react';

export interface WordmarkProps {
  size?: 'lg' | 'sm';
  className?: string;
}

export const Wordmark: React.FC<WordmarkProps> = ({ size = 'lg', className = '' }) => (
  <span
    data-testid="wordmark"
    className={`font-display font-semibold text-primary whitespace-nowrap ${
      size === 'lg' ? 'text-3xl' : 'text-title'
    } ${className}`.trim()}
  >
    Bimoto
  </span>
);
