// COMPONENTS/LAYOUT/CONNECTION-STATUS.TSX
//
// CHROME-C G2 — the connection, in the header, in two words.
//
// This replaces SyncIndicator and ConnectionBanner. Between them they
// occupied 24-48 px across the top of every screen and moved the whole
// page whenever the network so much as flickered; the "Back online"
// flash moved it twice, unprompted, 2.5 s apart. The information they
// carried was never the problem. Where they put it was.
//
// So: a pill in the header, with a leading dot and one short word,
// swapping in place. Nothing displaces, nothing covers, and every
// screen keeps the 24 px the green strip used to hold.
//
// THE LADDER (founder decision, R3 "severity ladder" + W1 honey): the
// visual intensity encodes severity, and only the top of the ladder is
// allowed to raise its voice.
//
//   Connected / Syncing / Back online → soft tint pill. Ambient.
//   Offline                           → solid honey chip. Deliberately
//                                       calm-but-solid: being offline
//                                       is normal in Kigali and the app
//                                       works offline by design.
//   No server                         → solid red chip AND a wash over
//                                       the whole header. Reserved for
//                                       this state alone — nothing else
//                                       may tint the header.
//
// ONE PILL, ONE TRUTH. SyncIndicator used to return null while
// unreachable (its own `:41`) precisely because ConnectionBanner was
// simultaneously speaking, and two widgets narrating one moment could
// only contradict each other. With a single pill that problem is gone,
// and the ladder decides: a server we cannot reach outranks a sync we
// are attempting. "Syncing" shows whenever the connection itself has
// nothing worse to report.
//
// The counterpart of saying it short is that the long form has to live
// somewhere: tapping the pill opens StatusDetailSheet, which holds the
// full sentence, the retry countdown, "Try now", and every held or
// refused booking with its actions. User-invoked, so it is the one
// thing on this screen allowed to cover content.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionState } from '../../hooks/useConnectionState';
import { useUIStore } from '../../stores/ui.store';
import { useOutboxStore } from '../../stores/outbox.store';
import { useRejectedItems } from '../sync/RejectedItemsPanel';
import { usePendingOutbox } from '../sync/OutboxPanel';
import { Spinner } from '../ui/Spinner';

const BACK_ONLINE_FLASH_MS = 2500;

export type HeaderStatusKind =
  | 'connected'
  | 'syncing'
  | 'backOnline'
  | 'offline'
  | 'noServer';

/**
 * The header's status, and whether it is severe enough to wash the
 * header. Exported so AppHeader can paint itself without duplicating
 * the ladder.
 */
export function useHeaderStatus(): HeaderStatusKind {
  const state = useConnectionState();
  const isSyncing = useUIStore((s) => s.isSyncing);
  const [showBackOnline, setShowBackOnline] = useState(false);
  const wasDisconnected = useRef(false);

  // Recovery flash: only after a real disconnected → online transition.
  useEffect(() => {
    if (state !== 'online') {
      wasDisconnected.current = true;
      setShowBackOnline(false);
      return;
    }
    if (!wasDisconnected.current) return;
    wasDisconnected.current = false;
    setShowBackOnline(true);
    const timer = setTimeout(() => setShowBackOnline(false), BACK_ONLINE_FLASH_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'unreachable') return 'noServer';
  if (state === 'offline') return 'offline';
  if (isSyncing) return 'syncing';
  if (showBackOnline) return 'backOnline';
  return 'connected';
}

/** True only for the one state allowed to tint the header. */
export function statusWashesHeader(kind: HeaderStatusKind): boolean {
  return kind === 'noServer';
}

/** How many things are waiting for the user, across both queues. */
export function useAttentionCount(): number {
  const { count: rejectedCount } = useRejectedItems();
  const { rows: pending } = usePendingOutbox();
  const lastSent = useOutboxStore((s) => s.lastSent);
  // The sent offer counts until it is viewed or dismissed. The green
  // strip used to hold that job and vanished when either happened; a
  // 3 s toast would vanish on its own, which is why the badge keeps it.
  return rejectedCount + pending.length + (lastSent ? 1 : 0);
}

// The §0 colour table, as literal values. Deliberately not Tailwind
// palette names: these are a designed ladder, and a later theme tweak
// must not silently re-tune severity.
const PILL_STYLES: Record<HeaderStatusKind, string> = {
  connected: 'bg-[#EAF3DE] text-[#27500A]',
  syncing: 'bg-[#EAF3DE] text-[#27500A]',
  backOnline: 'bg-[#EAF3DE] text-[#27500A]',
  offline: 'bg-[#C9821E] text-white',
  noServer: 'bg-[#A32D2D] text-white',
};

const STATUS_KEYS: Record<HeaderStatusKind, string> = {
  connected: 'sync.connected',
  syncing: 'sync.syncing',
  backOnline: 'connection.backOnline',
  offline: 'connection.shortOffline',
  noServer: 'connection.shortNoServer',
};

export interface ConnectionStatusProps {
  onOpenDetail: () => void;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ onOpenDetail }) => {
  const { t } = useTranslation();
  const kind = useHeaderStatus();
  const attention = useAttentionCount();

  const word = t(STATUS_KEYS[kind]);

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      data-testid="connection-status"
      data-status={kind}
      // The whole pill is the target, at the 44 px floor every other
      // tappable thing in this app respects.
      className={`relative min-h-[44px] flex items-center gap-1.5 pl-2 pr-2.5 rounded-full text-xs font-semibold ${PILL_STYLES[kind]}`}
      aria-label={`${word} — ${t('connection.openDetail')}`}
    >
      {kind === 'syncing' ? (
        <Spinner size="sm" />
      ) : (
        <span
          data-testid="connection-status-dot"
          className={
            kind === 'connected' || kind === 'backOnline'
              ? 'w-2 h-2 rounded-full bg-[#639922]'
              : 'w-2 h-2 rounded-full bg-white'
          }
        />
      )}
      {/* CHROME-C G1 §7.3 — the long-word fallback. Loose for en/fr;
          clips only rw's 23-character back-online flash. The full state
          is on the aria-label above either way, and the sheet is one
          tap from here. */}
      <span className="truncate max-w-[8.5rem]">{word}</span>

      {attention > 0 && (
        <span
          data-testid="connection-status-badge"
          className="min-w-[18px] h-[18px] px-1 ml-0.5 rounded-full bg-[#E24B4A] text-white text-[10px] font-bold flex items-center justify-center"
        >
          {attention}
        </span>
      )}
    </button>
  );
};
