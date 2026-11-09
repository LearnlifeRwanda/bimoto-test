import React from 'react';
import { useTranslation } from 'react-i18next';
import { VehicleType } from '@bimoto/shared';

interface Props {
  vehicleType: VehicleType | null | undefined;
  /**
   * ANY-VEHICLE G1 — render the any-vehicle variant when the customer
   * chose "Any vehicle".
   *
   * A separate prop rather than overloading `vehicleType: null`,
   * because null already means something else at three of this
   * component's call sites: "we do not know yet / nothing to say", for
   * which rendering nothing is right. Only the booking picker can tell
   * the two apart, so only it opts in.
   */
  anyVehicle?: boolean;
}

interface Details {
  speedKmh: number;
  helmetRequired: boolean;
  fareKey: 'bike' | 'e_bike' | 'moto' | 'e_moto';
  packageSize: 'small' | 'medium';
  labelKey: string;
}

const VEHICLE_DETAILS: Record<VehicleType, Details> = {
  [VehicleType.BIKE]: {
    speedKmh: 12,
    helmetRequired: false,
    fareKey: 'bike',
    packageSize: 'small',
    labelKey: 'vehicleTypeInfo.bike.label',
  },
  [VehicleType.E_BIKE]: {
    speedKmh: 18,
    helmetRequired: false,
    fareKey: 'e_bike',
    packageSize: 'small',
    labelKey: 'vehicleTypeInfo.e_bike.label',
  },
  [VehicleType.MOTO]: {
    speedKmh: 25,
    helmetRequired: true,
    fareKey: 'moto',
    packageSize: 'medium',
    labelKey: 'vehicleTypeInfo.moto.label',
  },
  [VehicleType.E_MOTO]: {
    speedKmh: 28,
    helmetRequired: true,
    fareKey: 'e_moto',
    packageSize: 'medium',
    labelKey: 'vehicleTypeInfo.e_moto.label',
  },
};

export const VehicleTypeInfoCard: React.FC<Props> = ({ vehicleType, anyVehicle }) => {
  const { t } = useTranslation();

  // ANY-VEHICLE G1 — the any variant. It deliberately makes no speed,
  // fare or package-size claim: those differ per vehicle kind, and the
  // whole point of choosing Any is that the customer decides from the
  // real offers rather than from an average of four machines. What it
  // does say is who may answer, and who picks.
  if (anyVehicle) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
        data-testid="vehicle-type-info-card-any"
      >
        <h3 className="mb-2 text-sm font-medium text-gray-700">
          {t('vehicleTypeInfo.any.label')}
        </h3>
        <ul className="space-y-1 text-xs text-gray-600">
          <li>{t('vehicleTypeInfo.any.whoCanOffer')}</li>
          <li>{t('vehicleTypeInfo.any.youChoose')}</li>
        </ul>
      </div>
    );
  }

  if (!vehicleType) return null;
  const details = VEHICLE_DETAILS[vehicleType];
  if (!details) return null;

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
      data-testid="vehicle-type-info-card"
    >
      <h3 className="mb-2 text-sm font-medium text-gray-700">
        {t(details.labelKey)}
      </h3>
      <ul className="space-y-1 text-xs text-gray-600">
        <li>{t('vehicleTypeInfo.speedHint', { speed: details.speedKmh })}</li>
        <li>{t(`vehicleTypeInfo.fareHint.${details.fareKey}`)}</li>
        <li>
          {details.helmetRequired
            ? t('vehicleTypeInfo.helmetRequired')
            : t('vehicleTypeInfo.helmetNotRequired')}
        </li>
        <li>{t(`vehicleTypeInfo.packageSize.${details.packageSize}`)}</li>
      </ul>
    </div>
  );
};

export default VehicleTypeInfoCard;
