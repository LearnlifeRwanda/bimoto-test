import React, { useEffect, useRef, useState } from 'react';

// SOCKET-FIX G3 — brief visual pulse when a live-updated value changes.
// Renders a span carrying the caller's classes; when `value` differs
// from the previous render a short animate-pulse cue plays, so a wish
// price raised over the socket is noticeable without being blocking.
// The initial value never pulses — only changes do.

interface ValuePulseProps {
  value: unknown;
  className?: string;
  children: React.ReactNode;
}

export const ValuePulse: React.FC<ValuePulseProps> = ({ value, className = '', children }) => {
  const [pulsing, setPulsing] = useState(false);
  const prevRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Object.is(prevRef.current, value)) return;
    prevRef.current = value;
    setPulsing(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPulsing(false), 1500);
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <span
      data-pulsing={pulsing || undefined}
      className={pulsing ? `${className} animate-pulse`.trim() : className}
    >
      {children}
    </span>
  );
};
