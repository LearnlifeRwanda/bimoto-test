// R3-DELIVERY-NOTIFICATIONS — recipient-side SMS pipeline.
//
// The parcel recipient (the person whose phone is in Leg.contactPhone)
// is NOT a Bimoto user — no app, no push subscription. Their only
// signal today is the customer manually phoning them. This service
// closes that gap with two locale-aware SMS events:
//
//   • driver-en-route — fired when the customer accepts a bid on a
//     journey that has a goods leg with contactPhone set.
//   • parcel-delivered — fired when the driver marks a GOODS_DROPOFF
//     leg complete.
//
// Both helpers are fire-and-forget: the calling flow (acceptBid /
// markLegCompleted) MUST NOT block on SMS delivery, and an SMS
// failure MUST NOT roll back the main transaction.
//
// This is a separate file from notification.service.ts because that
// file is push-only (uses ./push) and targets Bimoto users; recipients
// have no push channel. Keeping the two delivery surfaces apart avoids
// conflating them.

import * as Sentry from '@sentry/node';
import type { Language } from '@prisma/client';
import { sendSms } from './sms.service';

interface DriverEnRouteParams {
  customerName: string;
  estimatedMinutes: number;
}

interface ParcelDeliveredParams {
  customerName: string;
  customerPhone: string;
}

export function composeDriverEnRouteMessage(
  language: Language,
  { customerName, estimatedMinutes }: DriverEnRouteParams,
): string {
  const eta = Math.max(1, Math.round(estimatedMinutes));
  switch (language) {
    case 'fr':
      return `Bimoto: un moto-taxi vient livrer un colis de ${customerName}. Arrivee estimee: ~${eta} min.`;
    case 'en':
      return `Bimoto: a moto-taxi is delivering a parcel from ${customerName} to you. ETA: ~${eta} min.`;
    case 'rw':
    default:
      return `Bimoto: moto-taxi iraje kuguha ipake ya ${customerName}. Igihe: ~${eta} min.`;
  }
}

export function composeParcelDeliveredMessage(
  language: Language,
  { customerName, customerPhone }: ParcelDeliveredParams,
): string {
  switch (language) {
    case 'fr':
      return `Bimoto: votre colis de ${customerName} a ete livre. Si vous ne l'avez pas recu, contactez ${customerName} au ${customerPhone}.`;
    case 'en':
      return `Bimoto: your parcel from ${customerName} has been delivered. If not received, contact ${customerName} at ${customerPhone}.`;
    case 'rw':
    default:
      return `Bimoto: ipake ya ${customerName} yamaze gutangwa. Niba utayakiriye, hamagara ${customerName} kuri ${customerPhone}.`;
  }
}

export function notifyRecipientDriverEnRoute(args: {
  recipientPhone: string | null | undefined;
  language: Language;
  customerName: string;
  estimatedMinutes: number;
}): void {
  const { recipientPhone, language, customerName, estimatedMinutes } = args;
  if (!recipientPhone || recipientPhone.trim() === '') return;
  const body = composeDriverEnRouteMessage(language, { customerName, estimatedMinutes });
  void sendSms(recipientPhone, body).catch((err) => {
    console.error('[recipient-sms] notifyRecipientDriverEnRoute failed', err);
    Sentry.captureException(err, { tags: { event: 'recipient_sms_en_route' } });
  });
}

export function notifyRecipientParcelDelivered(args: {
  recipientPhone: string | null | undefined;
  language: Language;
  customerName: string;
  customerPhone: string;
}): void {
  const { recipientPhone, language, customerName, customerPhone } = args;
  if (!recipientPhone || recipientPhone.trim() === '') return;
  const body = composeParcelDeliveredMessage(language, { customerName, customerPhone });
  void sendSms(recipientPhone, body).catch((err) => {
    console.error('[recipient-sms] notifyRecipientParcelDelivered failed', err);
    Sentry.captureException(err, { tags: { event: 'recipient_sms_delivered' } });
  });
}

// R3-DELIVERY-NOTIFICATIONS-2 — driver-arrived-at-pickup event. Unlike
// the two recipient-side helpers above, the addressee here is the
// JOURNEY CUSTOMER (the sender). The customer wants to know that the
// driver has reached the pickup location to collect their parcel,
// closing the silent gap between the en-route SMS (fired at bid
// acceptance) and the delivered SMS (fired at GOODS_DROPOFF
// completion). Despite addressing the customer rather than a
// recipient, the helper lives here because the underlying transport
// (sendSms + fire-and-forget + Sentry tagging) is identical — adding
// a dedicated file for one helper would be over-decomposition.
export function composeDriverArrivedAtPickupMessage(language: Language): string {
  switch (language) {
    case 'fr':
      return 'Bimoto: le moto-taxi est arrive au point de collecte de votre colis.';
    case 'en':
      return 'Bimoto: the moto-taxi has arrived at the pickup point for your parcel.';
    case 'rw':
    default:
      return 'Bimoto: moto-taxi yageze aho izajya ifata ipake yawe.';
  }
}

export function notifyCustomerDriverArrivedAtPickup(args: {
  customerPhone: string | null | undefined;
  language: Language;
}): void {
  const { customerPhone, language } = args;
  if (!customerPhone || customerPhone.trim() === '') return;
  const body = composeDriverArrivedAtPickupMessage(language);
  void sendSms(customerPhone, body).catch((err) => {
    console.error('[customer-sms] notifyCustomerDriverArrivedAtPickup failed', err);
    Sentry.captureException(err, {
      tags: { event: 'customer_sms_driver_arrived_pickup' },
    });
  });
}
