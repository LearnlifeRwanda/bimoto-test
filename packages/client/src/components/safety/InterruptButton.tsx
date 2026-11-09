import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface InterruptButtonProps {
  onInterruptJourney: () => void;
}

export const InterruptButton: React.FC<InterruptButtonProps> = ({
  onInterruptJourney,
}) => {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleConfirm = () => {
    setShowConfirm(false);
    onInterruptJourney();
  };

  return (
    <>
      {/* SOS-WIRE G2 — sits directly above EmergencyButton's slot
          (fixed bottom-24, 60px tall → clears at 156px + gap). */}
      <button
        onClick={() => setShowConfirm(true)}
        className="fixed bottom-[168px] right-4 z-50 text-[#E74C3C] text-xs font-medium underline min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={t('interrupt.button')}
      >
        {t('interrupt.label')}
      </button>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={t('interrupt.confirmTitle')}
      >
        <p className="text-sm text-gray-600 mb-4">
          {t('interrupt.confirmMessage')}
        </p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => setShowConfirm(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={handleConfirm}
          >
            {t('interrupt.confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
};
