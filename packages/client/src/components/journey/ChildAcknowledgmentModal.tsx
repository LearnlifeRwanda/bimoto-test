// COMPONENTS/JOURNEY/CHILD-ACKNOWLEDGMENT-MODAL.TSX
//
// R3-CHILD — modal opened on the driver's bid flow before the bid
// POST when the journey has hasChildPassenger=true. Lists the three
// safety expectations and requires the driver to confirm before the
// bid is submitted. Cancelling dismisses both the modal and the
// in-flight bid (driver returns to BidPage in non-bidding state).

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ChildAcknowledgmentModal: React.FC<Props> = ({
  open,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="child-ack-title"
      data-testid="child-acknowledgment-modal"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2
          id="child-ack-title"
          className="mb-3 text-base font-semibold text-amber-900"
        >
          {t('child.ackTitle')}
        </h2>
        <ul
          className="mb-5 space-y-2 text-sm text-gray-700"
          data-testid="child-ack-safety-list"
        >
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{t('child.ackSafety1')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{t('child.ackSafety2')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{t('child.ackSafety3')}</span>
          </li>
        </ul>
        <div className="flex gap-2">
          <Button
            onClick={onCancel}
            variant="secondary"
            data-testid="child-ack-cancel"
          >
            {t('child.ackCancel')}
          </Button>
          <Button
            onClick={onConfirm}
            data-testid="child-ack-confirm"
            fullWidth
          >
            {t('child.ackConfirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChildAcknowledgmentModal;
