// R3-SCREENER-HELP-LAYER — first inline-help primitive in the codebase.
// Info-icon trigger button + collapsible body. Single-purpose, single-style
// (no variant/theme props) — designed to be reused later by WelcomePage and
// AdminFunnel. Accessible: aria-expanded, aria-controls, aria-label, and a
// role="region" body. Inline-hex styling matches the brand palette used by
// Button.tsx (#1B4F72 primary, #F8F9FA surface, #212529 text).

import React, { useState } from 'react';

export interface HelpDisclosureProps {
  /** Unique id for ARIA wiring (the body region uses `${id}-body`). */
  id: string;
  /** The translated help body text. */
  children: React.ReactNode;
  /** The label the screen reader announces for the trigger button. */
  triggerLabel: string;
}

// 16×16 info-circle, inline SVG (same approach as the other UI primitives —
// the codebase has no icon library dependency).
const InfoIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const HelpDisclosure: React.FC<HelpDisclosureProps> = ({
  id,
  children,
  triggerLabel,
}) => {
  const [expanded, setExpanded] = useState(false);
  const bodyId = `${id}-body`;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={triggerLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          minHeight: 44,
          background: 'transparent',
          border: 'none',
          color: '#1B4F72',
          fontSize: 12,
          fontWeight: 500,
          padding: '4px 0',
          cursor: 'pointer',
        }}
      >
        <InfoIcon />
        {triggerLabel}
      </button>
      {expanded && (
        <div
          id={bodyId}
          role="region"
          style={{
            marginTop: 6,
            padding: '10px 12px',
            background: '#F8F9FA',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: '#212529',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default HelpDisclosure;
