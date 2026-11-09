import React, { useId } from 'react';
import type { WelcomeIllustrationProps } from './WelcomeIllustration1';

/**
 * Slide 2 — "Powered by cooperatives".
 *
 * Three user figures in an upward triangle, connected by lines to read as a
 * network/community. The leader (top) is filled navy; the two drivers (bottom)
 * are outlined navy. A small cooperative-crest shield sits at the centroid.
 *
 * Brand palette only: #1B4F72 navy, #F39C12 orange, #F8F9FA surface, #212529 text.
 */
const WelcomeIllustration2: React.FC<WelcomeIllustrationProps> = (props) => {
  const titleId = useId();
  const label = props['aria-label'] ?? 'Powered by cooperatives';
  return (
    <svg
      width={160}
      height={160}
      viewBox="0 0 160 160"
      role="img"
      aria-labelledby={titleId}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{label}</title>

      {/* Surface background circle — shared visual language with slide 1 */}
      <circle cx="80" cy="80" r="70" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />

      {/* Network connectors (behind the figures) */}
      <line x1="80" y1="52" x2="50" y2="106" stroke="#F39C12" strokeWidth={3} strokeLinecap="round" />
      <line x1="80" y1="52" x2="110" y2="106" stroke="#F39C12" strokeWidth={3} strokeLinecap="round" />
      <line x1="50" y1="106" x2="110" y2="106" stroke="#F39C12" strokeWidth={3} strokeLinecap="round" />

      {/* Centre cooperative crest — shield */}
      <path
        d="M80 74 L88 77 V85 C88 91 80 96 80 96 C80 96 72 91 72 85 V77 Z"
        fill="#1B4F72"
      />
      <circle cx="80" cy="84" r="2.5" fill="#F39C12" />

      {/* Top user — leader, filled navy */}
      <circle cx="80" cy="44" r="8" fill="#1B4F72" />
      <path d="M67 74 a13 15 0 0 1 26 0 Z" fill="#1B4F72" />

      {/* Bottom-left user — driver, outlined navy */}
      <circle cx="50" cy="98" r="8" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />
      <path d="M37 126 a13 15 0 0 1 26 0 Z" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />

      {/* Bottom-right user — driver, outlined navy */}
      <circle cx="110" cy="98" r="8" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />
      <path d="M97 126 a13 15 0 0 1 26 0 Z" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />
    </svg>
  );
};

export default WelcomeIllustration2;
