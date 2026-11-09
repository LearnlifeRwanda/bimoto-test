// DOC-GUARD G2 — who may read a document.
//
// There is no document table. The mapping from a URL to the thing it
// belongs to already exists in the columns that hold the URL:
//
//   DriverProfile.drivingLicensePhotoUrl     -> that driver
//   DriverProfile.ruraAuthorizationPhotoUrl  -> that driver
//   DriverProfile.insurancePhotoUrl          -> that driver
//   Journey.pickupPhotoUrl                   -> that journey
//   Journey.deliveryPhotoUrl                 -> that journey
//
// So entitlement is answered by asking the database which row claims
// this URL, and a URL no row claims is not a document at all. That is
// also what makes the compatibility read safe: a legacy
// `/uploads/verification/<id>/driving-license.jpg` and a new
// `/api/documents/<uuid>` are resolved by the same equality lookup, and
// the path in the legacy URL is never trusted to say who owns the file.

import prisma from '../prisma';

export type DocumentClass = 'VERIFICATION' | 'JOURNEY_PHOTO';

export interface DocumentGrant {
  storedUrl: string;
  documentClass: DocumentClass;
  /** Everyone who may read it, admins aside. */
  allowedUserIds: string[];
}

/**
 * Find the row that claims this URL. Returns null when no row does —
 * which the route renders as 404, the same answer a stranger gets for a
 * document that exists.
 */
export async function resolveDocumentGrant(
  storedUrl: string,
): Promise<DocumentGrant | null> {
  const profile = await prisma.driverProfile.findFirst({
    where: {
      OR: [
        { drivingLicensePhotoUrl: storedUrl },
        { ruraAuthorizationPhotoUrl: storedUrl },
        { insurancePhotoUrl: storedUrl },
      ],
    },
    select: { userId: true },
  });
  if (profile) {
    return {
      storedUrl,
      documentClass: 'VERIFICATION',
      // His identity documents are his and the admin's. Nobody else —
      // not the customer he is carrying, not another driver.
      allowedUserIds: [profile.userId],
    };
  }

  const journey = await prisma.journey.findFirst({
    where: {
      OR: [{ pickupPhotoUrl: storedUrl }, { deliveryPhotoUrl: storedUrl }],
    },
    select: { customerId: true, driverId: true },
  });
  if (journey) {
    return {
      storedUrl,
      documentClass: 'JOURNEY_PHOTO',
      // The two parties to the journey the parcel was carried on.
      allowedUserIds: [journey.customerId, journey.driverId].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    };
  }

  return null;
}

/**
 * Admins may read any document — that is the verification review
 * surface, and the conflict resolver's photo comparison. Everyone else
 * must be named on the grant.
 */
export function isEntitled(
  grant: DocumentGrant,
  user: { userId: string; role: string },
): boolean {
  if (user.role === 'ADMIN') return true;
  return grant.allowedUserIds.includes(user.userId);
}
