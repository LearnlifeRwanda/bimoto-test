import React, { useId } from 'react';
import type { WelcomeIllustrationProps } from './WelcomeIllustration1';

/**
 * Slide 3 — "Fixed-price bidding".
 *
 * A large price tag carrying a checkmark (the binding price) with three small
 * bid-card silhouettes converging on it from below (the drivers' offers).
 * Conveys "every price is a binding offer; you choose".
 *
 * Brand palette only: #1B4F72 navy, #F39C12 orange, #F8F9FA surface, #212529 text.
 */
const WelcomeIllustration3: React.FC<WelcomeIllustrationProps> = (props) => {
  const titleId = useId();
  const label = props['aria-label'] ?? 'Fixed-price bidding';
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

      {/* Surface background circle — shared visual language with slides 1 & 2 */}
      <circle cx="80" cy="80" r="70" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />

      {/* Bid offers converging up at the tag */}
      <line x1="55" y1="116" x2="66" y2="98" stroke="#1B4F72" strokeWidth={1.5} strokeLinecap="round" />
      <line x1="80" y1="122" x2="80" y2="98" stroke="#1B4F72" strokeWidth={1.5} strokeLinecap="round" />
      <line x1="105" y1="116" x2="96" y2="98" stroke="#1B4F72" strokeWidth={1.5} strokeLinecap="round" />

      {/* Price tag — navy */}
      <path
        d="M64 54 H104 a6 6 0 0 1 6 6 V92 a6 6 0 0 1 -6 6 H64 L50 76 Z"
        fill="#1B4F72"
      />
      {/* Tag hole */}
      <circle cx="62" cy="76" r="4" fill="#F8F9FA" />
      {/* Currency label */}
      <text
        x="86"
        y="68"
        fontFamily="Arial, sans-serif"
        fontSize="11"
        fill="#212529"
        textAnchor="middle"
      >
        RWF
      </text>
      {/* Binding-price checkmark */}
      <path
        d="M74 82 l7 7 l15 -16"
        fill="none"
        stroke="#F8F9FA"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Three bid cards — orange */}
      <rect x="48" y="116" width="14" height="18" rx="2" fill="#F39C12" />
      <rect x="73" y="122" width="14" height="18" rx="2" fill="#F39C12" />
      <rect x="98" y="116" width="14" height="18" rx="2" fill="#F39C12" />
    </svg>
  );
};

export default WelcomeIllustration3;
