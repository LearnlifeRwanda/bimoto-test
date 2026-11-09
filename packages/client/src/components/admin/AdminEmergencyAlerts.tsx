import React, { useEffect } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SOCKET_EVENTS,
  JourneyType,
  type EmergencyAlertEvent,
  type EmergencyEndedEvent,
} from '@bimoto/shared';
import { useSocket } from '../../hooks/useSocket';
import { useEmergencyAlertStore } from '../../stores/emergency-alert.store';

// SOS-WIRE G3 — the admin shell's emergency surface. Mounted inside
// AdminGuard (every /admin route), it holds the admin's socket
// connection (the same useSocket pattern the customer/driver pages
// use; admin-role sockets land in the server's 'admins' room at
// connect) and renders a persistent, unmissable banner per alert:
// red, fixed to the top, never auto-dismissed — only the explicit
// "Acknowledged" click clears one. Concurrent alerts stack; repeated
// taps for the same journey bump a counter on the existing banner
// instead of duplicating it. Deliberately no sound: the panel may be
// unstaffed, and the ops/contact SMS channels cover absence.
//
// OUTBOX G5 — the banner says WHO pressed the button.
//
// #166 gave the motari the same red button as the passenger and put
// `raisedBy` on the payload, but this banner still announced every
// alert as "Emergency — passenger needs help" and showed the
// passenger's phone. An admin reading it during a driver's emergency
// was told the wrong person was in trouble and handed the wrong number
// to call — the SMS channel had the truth and the screen did not.
//
// So a driver-raised alert now leads with the motari: his title, his
// phone, his plate. The counterpart is still shown underneath in both
// directions, because ops has to be able to reach both people on a
// ride. An alert with no `raisedBy` (pre-#166, or replayed from a log)
// keeps exactly the passenger-shaped rendering it has today.
//
// LOOSE-ENDS G3 — and the banner now also says WHAT KIND of journey it
// is. `raisedBy` fixed who; nothing said what. A motari carrying a
// parcel raised an alert and the panel announced a ride with a
// passenger — the customer on the other end of a parcel run is the
// SENDER, and he is at home, not on the bike. Same branch shape as
// `raisedBy` above, same fallback rule: an alert with no `journeyType`
// (deployed APK, replayed log) keeps today's ride-shaped wording.
export const AdminEmergencyAlerts: React.FC = () => {
  const { t } = useTranslation();
  const { socket, isConnected } = useSocket();
  const alerts = useEmergencyAlertStore((s) => s.alerts);
  const addAlert = useEmergencyAlertStore((s) => s.addAlert);
  const acknowledgeAlert = useEmergencyAlertStore((s) => s.acknowledgeAlert);
  const alertEnded = useEmergencyAlertStore((s) => s.alertEnded);
  // SOS-FOLLOW G5 — the Follow link needs a router, and this banner must
  // not be able to crash. It is the surface that tells an operator
  // somebody pressed a panic button; a render error here would take out
  // the alert along with the page it is drawn over, which is the worst
  // failure this component has. So the link renders where routing exists
  // (every /admin route, which is everywhere this is mounted in the app)
  // and is simply absent anywhere it does not — the dashboard's own link
  // to the page is unaffected either way.
  const inRouter = useInRouterContext();

  useEffect(() => {
    if (!socket) return;
    const handler = (event: EmergencyAlertEvent) => addAlert(event);
    // SOS-FOLLOW G3 — a banner for an emergency that has ENDED is worse
    // than no banner: it tells an unstaffed panel that somebody still
    // needs help. Acknowledgement remains the only way a PERSON
    // dismisses one; this is the emergency itself being over.
    const ended = (event: EmergencyEndedEvent) => alertEnded(event);
    socket.on(SOCKET_EVENTS.EMERGENCY_ALERT, handler);
    socket.on(SOCKET_EVENTS.EMERGENCY_ENDED, ended);
    return () => {
      socket.off(SOCKET_EVENTS.EMERGENCY_ALERT, handler);
      socket.off(SOCKET_EVENTS.EMERGENCY_ENDED, ended);
    };
  }, [socket, isConnected, addAlert, alertEnded]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[100] space-y-1" role="alert">
      {alerts.map((alert) => {
        // Three of JourneyType's four members are parcels, so the test
        // is `!== PASSENGER` — an urgent-messenger run is not a ride
        // either. Absent (older payload) → the ride wording.
        const isParcel =
          alert.journeyType !== undefined && alert.journeyType !== JourneyType.PASSENGER;
        const titleKey =
          alert.raisedBy === 'DRIVER'
            ? isParcel
              ? 'emergency.adminBannerTitleDriverParcel'
              : 'emergency.adminBannerTitleDriver'
            : isParcel
              ? 'emergency.adminBannerTitleSender'
              : 'emergency.adminBannerTitle';
        // The customer's label follows the same truth: on a parcel run
        // he is the sender, and calling him "Passenger" tells ops he is
        // on the bike when he is not.
        const customerPhoneLabel = isParcel
          ? 'emergency.adminSenderPhone'
          : 'emergency.adminRiderPhone';
        return (
        <div
          key={alert.journeyId}
          className="bg-[#E74C3C] text-white px-4 py-3 shadow-lg flex flex-wrap items-center gap-x-6 gap-y-2"
          data-testid="emergency-alert-banner"
        >
          <span className="font-bold uppercase tracking-wide" data-testid="emergency-alert-title">
            {t(titleKey)}
            {alert.count > 1 && ` (×${alert.count})`}
          </span>
          {alert.raisedBy === 'DRIVER' ? (
            <>
              {/* The person in trouble, first. */}
              <span className="text-sm" data-testid="emergency-alert-primary-contact">
                {t('emergency.adminDriverPhone')}:{' '}
                <span className="font-mono font-semibold">
                  {alert.driverPhone || '—'}
                </span>
                {alert.driverNickname && ` (${alert.driverNickname})`}
                {alert.driverPlate && ` · ${t('emergency.adminPlate')} ${alert.driverPlate}`}
              </span>
              {/* The other person on the journey, whom ops must also
                  reach — the passenger on a ride, the sender on a
                  parcel run. */}
              <span className="text-sm" data-testid="emergency-alert-counterpart">
                {t(customerPhoneLabel)}:{' '}
                <span className="font-mono">{alert.riderPhone || '—'}</span>
                {alert.riderNickname && ` (${alert.riderNickname})`}
              </span>
            </>
          ) : (
            <span className="text-sm" data-testid="emergency-alert-primary-contact">
              {t(customerPhoneLabel)}:{' '}
              <span className="font-mono font-semibold">
                {alert.riderPhone || '—'}
              </span>
              {alert.riderNickname && ` (${alert.riderNickname})`}
            </span>
          )}
          <span className="text-sm">
            {t('emergency.adminJourney')}:{' '}
            <span className="font-mono">{alert.journeyId}</span>
          </span>
          <span className="text-xs text-white/80">
            {new Date(alert.timestamp).toLocaleTimeString()}
          </span>
          <span className="ml-auto flex items-center gap-2">
          {/* SOS-FOLLOW G5 — the banner interrupts; the page is where
              the emergency is worked. Following live, the map, the ages
              and the Resolve form all live there. */}
          {inRouter && (
            <Link
              to="/admin/emergency"
              className="min-h-[44px] px-4 flex items-center rounded-lg bg-white text-[#E74C3C] font-semibold text-sm hover:bg-white/90"
              data-testid="emergency-alert-follow-link"
            >
              {t('emergency.adminFollow')}
            </Link>
          )}
          <button
            onClick={() => acknowledgeAlert(alert.journeyId)}
            className="min-h-[44px] px-4 rounded-lg border-2 border-white font-semibold text-sm hover:bg-white/10 active:bg-white/20 transition-colors"
          >
            {t('emergency.adminAcknowledge')}
          </button>
          </span>
        </div>
        );
      })}
    </div>
  );
};
