// COMPONENTS/LAYOUT/STATUS-DETAIL-SHEET.TSX
//
// CHROME-C G2 — the one surface allowed to cover content, because the
// user asked for it.
//
// Everything the four strips used to push into every screen lives here
// and opens only on a tap of the header status: the connection's full
// sentence with its countdown and "Try now", the held bookings with
// their Cancel, the refusals with their Retry and Discard, and the
// offer to view a booking that has just gone out.
//
// WHY Modal AND NOT BottomSheet (CHROME-C G1 §7.2a): the content being
// relocated already lives in a Modal inside both banners, so reusing
// rather than rewriting points here. BottomSheet is the wrong shape —
// it is `fixed inset-x-0 bottom-16 z-30 h-[calc(100dvh-9rem)]` with
// drag handles and two snap states, built to sit over a full-bleed map
// on the picker screens, and it has no dismissed state at all: it is
// always either collapsed or expanded. A status surface has to open
// from nothing on every screen and close back to nothing.
//
// The panels are the banners' own bodies, moved intact — not rewritten.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { ConnectionPanel } from './ConnectionPanel';
import { RejectedItemsPanel } from '../sync/RejectedItemsPanel';
import { OutboxPanel } from '../sync/OutboxPanel';

export interface StatusDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StatusDetailSheet: React.FC<StatusDetailSheetProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('connection.detailTitle')}>
      <div className="space-y-5" data-testid="status-detail-sheet">
        <ConnectionPanel />
        {/* Each panel renders nothing when its queue is empty, so a
            healthy phone opens onto the connection line alone. */}
        <OutboxPanel onNavigate={onClose} />
        <RejectedItemsPanel />
      </div>
    </Modal>
  );
};
