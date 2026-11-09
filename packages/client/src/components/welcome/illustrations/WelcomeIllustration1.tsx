import React, { useId } from 'react';

export interface WelcomeIllustrationProps {
  'aria-label'?: string;
}

/**
 * Slide 1 — "Welcome to Bimoto" → rides across Rwanda.
 *
 * A stylised motorcycle (the most common Kigali ride) centred on a soft
 * surface circle, with a smaller bicycle to the lower-right suggesting the
 * multi-vehicle marketplace, and faint location pins evoking "across Rwanda".
 *
 * Brand palette only: #1B4F72 navy, #F39C12 orange, #F8F9FA surface, #212529 text.
 */
const WelcomeIllustration1: React.FC<WelcomeIllustrationProps> = (props) => {
  const titleId = useId();
  const label = props['aria-label'] ?? 'Welcome to Bimoto';
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

      {/* Surface background circle */}
      <circle cx="80" cy="80" r="70" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={2} />

      {/* Faint location pins — "across Rwanda" */}
      <path
        d="M28 132 c -3 0 -5 2 -5 5 c 0 3 5 9 5 9 c 0 0 5 -6 5 -9 c 0 -3 -2 -5 -5 -5 z"
        fill="#212529"
        opacity="0.4"
      />
      <path
        d="M138 126 c -3 0 -5 2 -5 5 c 0 3 5 9 5 9 c 0 0 5 -6 5 -9 c 0 -3 -2 -5 -5 -5 z"
        fill="#212529"
        opacity="0.4"
      />

      {/* Motorcycle — navy silhouette */}
      <circle cx="54" cy="110" r="15" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={3} />
      <circle cx="114" cy="110" r="15" fill="#F8F9FA" stroke="#1B4F72" strokeWidth={3} />
      <path d="M58 110 L80 110 L88 92 L66 92 Z" fill="#1B4F72" />
      <path d="M60 88 L86 88 L84 94 L62 94 Z" fill="#1B4F72" />
      <line x1="80" y1="110" x2="114" y2="110" stroke="#1B4F72" strokeWidth={3} strokeLinecap="round" />
      <line x1="114" y1="110" x2="100" y2="90" stroke="#1B4F72" strokeWidth={3} strokeLinecap="round" />
      <line x1="100" y1="90" x2="108" y2="80" stroke="#1B4F72" strokeWidth={3} strokeLinecap="round" />
      <line x1="103" y1="82" x2="115" y2="80" stroke="#1B4F72" strokeWidth={3} strokeLinecap="round" />
      <circle cx="108" cy="80" r="3" fill="#F39C12" />

      {/* Bicycle — orange, lower-right, partially overlapping the rim */}
      <circle cx="108" cy="132" r="9" fill="none" stroke="#F39C12" strokeWidth={2} />
      <circle cx="132" cy="132" r="9" fill="none" stroke="#F39C12" strokeWidth={2} />
      <path
        d="M108 132 L118 132 L124 120 L114 120 Z"
        fill="none"
        stroke="#F39C12"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <line x1="124" y1="120" x2="132" y2="132" stroke="#F39C12" strokeWidth={2} strokeLinecap="round" />
      <line x1="114" y1="120" x2="112" y2="115" stroke="#F39C12" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
};

export default WelcomeIllustration1;
