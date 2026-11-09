import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store';
import { useEmergencyFollowStore } from '../stores/emergency-follow.store';
import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';
import { useChatStore } from '../stores/chat.store';
import { useUIStore } from '../stores/ui.store';
import { useDiagnosticsStore } from '../stores/diagnostics.store';
import {
  SOCKET_EVENTS,
  JourneyType,
  type AccountFrozenEvent,
  type AutoBidFiredEvent,
  type DisputeResolvedEvent,
  type EscrowReleasedEvent,
  type EscrowRefundedEvent,
  type NoShowWarningEvent,
  type RatingReceivedEvent,
  type VerificationDecidedEvent,
  type EmergencyAlertEvent,
  type EmergencyEndedEvent,
  type JourneyAvailableEvent,
  type JourneyWishPriceUpdatedEvent,
  type BidCounteredEvent,
  type CounterAcceptedEvent,
  type CounterDeclinedEvent,
} from '@bimoto/shared';
import { useTranslation } from 'react-i18next';
import { apiFetch, getFreshAccessToken } from '../lib/api';
import { refreshSession } from '../lib/auth-refresh';
import { playNotificationSound } from '../lib/notification-sound';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// AUTH-REFRESH G3 — handshake rejections the server's socket auth
// middleware produces (packages/server/src/socket). Anything else on
// connect_error is a network problem and stays with the built-in
// reconnection/backoff.
export const SOCKET_AUTH_ERRORS = new Set(['Authentication required', 'Invalid token']);

export function useSocket(currentJourneyId?: string) {
  const socketRef = useRef<Socket | null>(null);
  // t in a ref: socket handlers are registered once per connection
  // effect, so a bare closure would pin the language active at connect
  // time. The ref always holds the current-language t.
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [isConnected, setIsConnected] = useState(false);
  // MATCH-CLOSE G4 — mirror the live connection state into the
  // diagnostics store, so the diagnostics screen can report it without
  // opening a second socket of its own.
  const publishConnected = useCallback((connected: boolean) => {
    setIsConnected(connected);
    useDiagnosticsStore.getState().setSocketConnected(connected);
  }, []);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const updateJourney = useJourneyStore((s) => s.updateJourney);
  const signalJourneyAvailable = useJourneyStore((s) => s.signalJourneyAvailable);
  const updateNearbyRequest = useJourneyStore((s) => s.updateNearbyRequest);
  const activeJourney = useJourneyStore((s) => s.activeJourney);
  const addBid = useBidStore((s) => s.addBid);
  const removeBid = useBidStore((s) => s.removeBid);
  const setMyBids = useBidStore((s) => s.setMyBids);
  const addMessage = useChatStore((s) => s.addMessage);
  const showToast = useUIStore((s) => s.showToast);
  const setAccountFrozen = useUIStore((s) => s.setAccountFrozen);

  // NOTIFY G1/G3/G4 — one call for "something happened".
  //
  // Every socket toast is notification-class (D9's ~15 s) rather than
  // the 3-second transient form feedback uses: news that arrived while
  // the phone was in a pocket has to survive being looked at. The sound
  // is fired alongside and can only fail silently — a chime that cannot
  // play must never cost the toast (lib/notification-sound.ts).
  //
  // 'critical' is the motari's louder, doubled variant and is spent only
  // on the four things that cost him money if he misses them: a nearby
  // request, his bid accepted, his escrow released, a verification
  // decision. Passengers get 'standard' — the same Bimoto motif, softer
  // (Faustin's open sub-question of 24 Aug, answered).
  const notify = useCallback(
    (key: string, kind: 'success' | 'error' | 'info', variant: 'standard' | 'critical' = 'standard') => {
      showToast(tRef.current(key), kind, 'notification');
      playNotificationSound(variant);
    },
    [showToast],
  );

  const joinJourneyRoom = useCallback((journeyId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENTS.JOIN_JOURNEY, { journeyId });
    }
  }, []);

  const leaveJourneyRoom = useCallback((journeyId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
    }
  }, []);

  // Connect/disconnect based on auth state
  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // AUTH-REFRESH G3 — auth as a callback: socket.io re-invokes it on
    // EVERY handshake (initial connect and each reconnect attempt), so
    // a reconnect after minute 15 presents the CURRENT token —
    // refreshed first when near expiry — instead of the value captured
    // when the effect ran.
    let cancelled = false;
    let authRetried = false;
    const socket = io(API_URL, {
      auth: (cb) => {
        void getFreshAccessToken().then((fresh) => cb({ token: fresh ?? token }));
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('disconnect', () => {
      publishConnected(false);
      useDiagnosticsStore.getState().setSocketTransport(null);
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket connection error:', err.message);
      // AUTH-REFRESH G3 — a middleware auth rejection stops socket.io's
      // automatic reconnection, so an expired token would leave the
      // realtime layer dead until remount. Refresh once and retry; the
      // rotated store token also re-runs this effect with a fresh
      // connection, and `cancelled` keeps the retry from resurrecting a
      // socket the cleanup already tore down.
      if (SOCKET_AUTH_ERRORS.has(err.message) && !authRetried) {
        authRetried = true;
        void refreshSession().then((fresh) => {
          if (fresh && !cancelled) socket.connect();
        });
      }
    });

    // LIVE-WIRE G2 — report which transport actually carried this
    // connection, and keep reporting it across upgrades.
    //
    // socket.io negotiates long-polling first and upgrades to a
    // websocket when it can. On a Kigali network that blocks or drops
    // websockets it silently stays on polling forever — which works,
    // but is the state we could not see from here when the field said
    // "too slow". `isConnected` alone could not tell the two apart.
    // Every hop is optional: `socket.io.engine` does not exist until the
    // engine is up, and test doubles of the socket carry neither.
    const publishTransport = () => {
      const name = (socket.io?.engine as { transport?: { name?: string } } | undefined)
        ?.transport?.name;
      useDiagnosticsStore.getState().setSocketTransport(name ?? null);
    };
    socket.on('connect', () => {
      authRetried = false;
      publishConnected(true);
      publishTransport();
      socket.io?.engine?.on?.('upgrade', publishTransport);
    });

    // New bid placed on a journey
    socket.on(SOCKET_EVENTS.BID_PLACED, (data: any) => {
      addBid(data);
      // An offer arriving is the passenger's headline event.
      notify('bids.newBidReceived', 'info');
    });

    // LIVE-WIRE G2 — a bid's outcome, on whichever side is listening.
    //
    // Two envelopes reach this handler and they are NOT the same event
    // seen twice:
    //   * the journey room carries the accept RESULT to the customer
    //     (`{ journey, bid, ... }`, bid.routes.ts:147) — the customer
    //     who just tapped Accept is already navigating, so this is a
    //     silent store update, never a toast about their own action;
    //   * the per-user room carries `{ journeyId, bidId }` to the
    //     motari whose bid won (services/bid-outcome.ts). Until this
    //     dispatch he had no socket path at all: his journey-room join
    //     is refused while the journey is REQUESTED, measured 10/10.
    //     For him it IS news, so: fetch the journey (which makes
    //     ActiveJourneyBanner appear without a navigation) and say so.
    socket.on(SOCKET_EVENTS.BID_ACCEPTED, (data: any) => {
      if (data?.journey?.id) {
        updateJourney(data.journey.id, data.journey);
        return;
      }
      if (!data?.journeyId) return;
      // Critical: this one is a ride he has won and must ride to.
      notify('bids.yourBidAccepted', 'success', 'critical');
      apiFetch(`/api/journeys/${data.journeyId}`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((journey) => {
          if (journey?.id) useJourneyStore.getState().setActiveJourney(journey);
        })
        .catch((err) => {
          // The toast already landed; the banner will catch up on the
          // next mount-time restore.
          console.debug('bid-accepted journey fetch failed:', err);
        });
    });

    // LIVE-WIRE G2 — the losing motaris, told rather than left waiting.
    socket.on(SOCKET_EVENTS.BID_DECLINED, (data: any) => {
      if (!data?.journeyId) return;
      notify('bids.yourBidDeclined', 'info');
    });

    // LIVE-WIRE G2 — a withdrawn bid leaves the passenger's list at
    // once instead of sitting there until the next poll, where tapping
    // it answers 400. The server has emitted this since
    // bid.routes.ts:253; nothing listened.
    socket.on(SOCKET_EVENTS.BID_WITHDRAWN, (data: any) => {
      if (data?.id) removeBid(data.id);
    });

    // TEAM-ANSWERS G5 — the passenger learns the ride ended.
    //
    // The server has emitted JOURNEY_ENDED from the driver's End tap
    // since R3 (journey.routes.ts) and JOURNEY_CONFIRMED from the
    // confirm; nothing on the client listened, because until item 16b
    // was decided there was nothing for the passenger to do about it.
    // Now there is: her screen must offer "Confirm arrival", which means
    // it must first know the driver has finished.
    //
    // Both handlers do exactly what every other journey handler here
    // does — fold the server's own journey object into the store. No
    // toast: the screen changing IS the message, and a passenger sitting
    // in the vehicle does not need a notification that she has arrived.
    socket.on(SOCKET_EVENTS.JOURNEY_ENDED, (data: any) => {
      if (data?.id) updateJourney(data.id, data);
    });

    socket.on(SOCKET_EVENTS.JOURNEY_CONFIRMED, (data: any) => {
      if (data?.id) updateJourney(data.id, data);
    });

    // New chat message — server emits 'new-message' from emitToJourney
    socket.on(SOCKET_EVENTS.NEW_MESSAGE, (data: any) => {
      addMessage(data);
    });

    // SOCKET-FIX G2 — discovery feed. Both discovery broadcasters
    // (supply-broadcast ring cascade, urgent-broadcast R3-T fan-out)
    // emit journey:available; this listener used to be registered for
    // 'journey:nearby', a name nothing ever emitted. The payload is a
    // pointer, not the journey, so mounted consumers (driver dashboard)
    // refetch off the store signal; with none mounted it's a no-op.
    socket.on(SOCKET_EVENTS.JOURNEY_AVAILABLE, (data: JourneyAvailableEvent) => {
      signalJourneyAvailable(data.journeyId, data.urgent);
      // NOTIFY G2 (driver half) — the toast this event already produced
      // lives on the driver dashboard, which reads the store signal
      // above; what it never had was a way to reach a motari who is not
      // looking at the screen. Critical variant: a request he cannot see
      // is a fare he does not get.
      playNotificationSound('critical');
    });

    // SOCKET-FIX G3 — the customer raised their wish price (suggest-up).
    // Both store slices update so every surface rendering the price
    // (dashboard job cards via nearbyRequests, BidPage via
    // activeJourney) shows the new value live; ValuePulse at the render
    // sites provides the brief visual cue on change.
    socket.on(SOCKET_EVENTS.JOURNEY_WISH_PRICE_UPDATED, (data: JourneyWishPriceUpdatedEvent) => {
      updateJourney(data.journeyId, {
        wishPrice: data.wishPrice,
        suggestUpCount: data.suggestUpCount,
      });
      updateNearbyRequest(data.journeyId, {
        wishPrice: data.wishPrice,
        suggestUpCount: data.suggestUpCount,
      });
    });

    // SOCKET-FIX G5 — a stored auto-bid rule fired server-side: minimal
    // acknowledgement only (toast + bids-list refetch). The auto-bid
    // management UI is a separate future dispatch; nothing more belongs
    // here.
    // WIRE-FIX G2 — the refetch used to call GET /api/bids/mine, an
    // endpoint that has never existed (/api/bids mounts only
    // /my-history), so the list silently never refreshed. my-history
    // returns the caller's bid array most-recent-first — the exact
    // shape setMyBids holds — so the call site retargets; and a failed
    // refresh now debug-logs instead of vanishing.
    socket.on(SOCKET_EVENTS.AUTO_BID_FIRED, (_data: AutoBidFiredEvent) => {
      notify('bids.autoBidPlaced', 'info');
      apiFetch(`/api/bids/my-history`, {
        credentials: 'include',
      })
        .then((res) => {
          if (!res.ok) {
            console.debug('auto-bid refetch failed:', res.status);
            return null;
          }
          return res.json();
        })
        .then((data) => {
          if (Array.isArray(data)) setMyBids(data);
        })
        .catch((err) => {
          // Refetch is best-effort — the toast already landed — but the
          // failure is at least visible in the debug log.
          console.debug('auto-bid refetch failed:', err);
        });
    });

    // SOCKET-FIX G4 — an admin froze this account. The server emits and
    // then force-disconnects the socket, so all this handler does is
    // raise the blocking AccountFrozenNotice; the logout (existing auth
    // store path) runs only when the user acknowledges — safe mid-ride.
    socket.on(SOCKET_EVENTS.ACCOUNT_FROZEN, (_data: AccountFrozenEvent) => {
      setAccountFrozen(true);
    });

    // SOS-WIRE G1 — emergency alert on the journey room. Until the
    // name unification this listener was registered for
    // 'emergency:alert', which nothing emitted; it now receives the
    // server's journey-room emit (so the driver of an SOS-flagged ride
    // sees it live).
    //
    // LOOSE-ENDS G3 — and it names the journey correctly. "Emergency
    // alert on this ride" reached a motari carrying a parcel and the
    // sender watching that parcel move; neither of them is on a ride.
    // Three of JourneyType's four members are parcels, so the test is
    // `!== PASSENGER`. No journeyType on the payload (a deployed APK,
    // an alert replayed from a log) → today's wording, unchanged.
    socket.on(SOCKET_EVENTS.EMERGENCY_ALERT, (data: EmergencyAlertEvent | undefined) => {
      const isParcel =
        data?.journeyType !== undefined && data.journeyType !== JourneyType.PASSENGER;
      notify(
        isParcel ? 'emergency.alertReceivedParcel' : 'emergency.alertReceived',
        'error',
        'critical',
      );
      // SOS-FOLLOW G4 — how the OTHER participant's phone starts
      // streaming without having pressed anything. The raiser learns the
      // alert's identity from their own POST response; this is the only
      // way the second phone learns it live, and both phones streaming
      // is the point: which of the two still works is not knowable in
      // advance. Nothing about the toast above changed.
      if (data?.journeyId && data.alertId) {
        useEmergencyFollowStore.getState().markActive(data.journeyId, data.alertId);
      }
    });

    // SOS-FOLLOW G3 — the one new event the journey room hears, and the
    // reason the follow can be allowed at all. It carries an id, a
    // journey and a terminal status: no positions, in either direction,
    // ever. Clearing the store is what actually stops this device's
    // geolocation watch.
    socket.on(SOCKET_EVENTS.EMERGENCY_ENDED, (data: EmergencyEndedEvent | undefined) => {
      if (data?.journeyId) useEmergencyFollowStore.getState().clear(data.journeyId);
    });

    // ── NOTIFY G3 — the six things a user was never told in-app ────
    //
    // Every one of these arrives on this user's OWN room (emitToUser,
    // composed inside services/notification.service.ts) — never a
    // journey room, never a broadcast — so a handler here can announce
    // without checking who the message is about: if it arrived, it is
    // about the person holding the phone.
    //
    // Each is a toast and a sound and NOTHING ELSE. D9 ruled no inbox,
    // so nothing here writes to a store, a table, or a queue that
    // survives the tab.

    // "You were paid X RWF" — the one the field asked for first, and
    // the one a motari has never received. Critical variant: money.
    socket.on(SOCKET_EVENTS.ESCROW_RELEASED, (data: EscrowReleasedEvent | undefined) => {
      if (typeof data?.amount !== 'number') return;
      showToast(
        tRef.current('notify.escrowReleased', { amount: data.amount.toLocaleString() }),
        'success',
        'notification',
      );
      playNotificationSound('critical');
    });

    // The passenger's money coming back. Standard variant: she is
    // holding the phone she cancelled on, or reading a driver's
    // withdrawal, and neither needs to startle her.
    socket.on(SOCKET_EVENTS.ESCROW_REFUNDED, (data: EscrowRefundedEvent | undefined) => {
      if (typeof data?.amount !== 'number') return;
      showToast(
        tRef.current('notify.escrowRefunded', { amount: data.amount.toLocaleString() }),
        'info',
        'notification',
      );
      playNotificationSound('standard');
    });

    socket.on(SOCKET_EVENTS.RATING_RECEIVED, (data: RatingReceivedEvent | undefined) => {
      if (typeof data?.stars !== 'number') return;
      showToast(
        tRef.current('notify.ratingReceived', { count: data.stars }),
        'info',
        'notification',
      );
      playNotificationSound('standard');
    });

    // FIELD-FIT G4 delivered this decision by push and by SMS. This is
    // the third channel, and the only one that reaches a motari who is
    // sitting in the app waiting to be allowed to work. Critical either
    // way: approved means he can earn today, rejected means he cannot.
    socket.on(SOCKET_EVENTS.VERIFICATION_DECIDED, (data: VerificationDecidedEvent | undefined) => {
      if (data?.decision !== 'APPROVED' && data?.decision !== 'REJECTED') return;
      const approved = data.decision === 'APPROVED';
      notify(
        approved ? 'notify.verificationApproved' : 'notify.verificationRejected',
        approved ? 'success' : 'error',
        'critical',
      );
    });

    socket.on(SOCKET_EVENTS.NO_SHOW_WARNING, (data: NoShowWarningEvent | undefined) => {
      if (typeof data?.count !== 'number') return;
      showToast(
        tRef.current('notify.noShowWarning', { count: data.count }),
        'error',
        'notification',
      );
      playNotificationSound('standard');
    });

    // The outcome only — no admin note, no reviewer. Same posture
    // EMERGENCY_ENDED takes: a participant is told their case is closed
    // and how, never what an administrator wrote about it.
    socket.on(SOCKET_EVENTS.DISPUTE_RESOLVED, (data: DisputeResolvedEvent | undefined) => {
      const keys: Record<DisputeResolvedEvent['outcome'], string> = {
        UPHELD: 'notify.disputeUpheld',
        REJECTED: 'notify.disputeRejected',
        NO_ACTION: 'notify.disputeClosed',
      };
      const outcome = data?.outcome;
      if (!outcome || !(outcome in keys)) return;
      notify(keys[outcome], outcome === 'UPHELD' ? 'success' : 'info');
    });

    // ── COUNTER-READY G2/G3 — the counter-offer conversation ────────
    //
    // Registered unconditionally, and that is not a flag leak: a dormant
    // server (COUNTER_BID_ENABLED unset) refuses both counter endpoints
    // at their first line, so neither of these events can ever reach a
    // phone talking to one. A listener with nothing to hear renders
    // nothing — which is what "the UI renders nothing" means here — and
    // registering it now is what keeps the emit↔listen orphan guard
    // (shared/__tests__/socket-event-contract.test.ts) honest: the
    // constant, the emit and the listener move in ONE commit, which is
    // that registry's own rule.
    //
    // STANDARD sound in both directions. 'critical' is spent on the four
    // things that cost a motari money if he misses them; a price
    // suggestion is a conversation, not a lost fare, and the passenger's
    // side of it is hers to read when she looks.

    // To the MOTARI: somebody suggested a different number for his offer.
    socket.on(SOCKET_EVENTS.BID_COUNTERED, (data: BidCounteredEvent | undefined) => {
      if (typeof data?.counterAmountRwf !== 'number') return;
      showToast(
        tRef.current('notify.bidCountered', {
          amount: data.counterAmountRwf.toLocaleString(),
        }),
        'info',
        'notification',
      );
      playNotificationSound('standard');
    });

    // To the PASSENGER: he took her number. The journey itself arrives
    // over BID_ACCEPTED on the journey room (emitted by the respond
    // route, exactly as her own accept emits it), so this handler is the
    // news and nothing else.
    socket.on(SOCKET_EVENTS.COUNTER_ACCEPTED, (data: CounterAcceptedEvent | undefined) => {
      if (typeof data?.agreedPrice !== 'number') return;
      showToast(
        tRef.current('notify.counterAccepted', {
          amount: data.agreedPrice.toLocaleString(),
        }),
        'success',
        'notification',
      );
      playNotificationSound('standard');
    });

    // To the PASSENGER: he said no — and his own offer is STILL THERE at
    // the price he first named. The number in this toast is his, not
    // hers, because "you can still take his offer" is the whole message.
    socket.on(SOCKET_EVENTS.COUNTER_DECLINED, (data: CounterDeclinedEvent | undefined) => {
      if (typeof data?.originalPrice !== 'number') return;
      showToast(
        tRef.current('notify.counterDeclined', {
          price: data.originalPrice.toLocaleString(),
        }),
        'info',
        'notification',
      );
      playNotificationSound('standard');
    });

    socketRef.current = socket;

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
      publishConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token]);

  // Auto-join/leave journey rooms. Prefer the explicit currentJourneyId
  // (e.g. URL :id on chat-related pages) over activeJourney from the store.
  const targetJourneyId = currentJourneyId ?? activeJourney?.id;
  useEffect(() => {
    if (!isConnected || !targetJourneyId) return;
    joinJourneyRoom(targetJourneyId);
    return () => {
      leaveJourneyRoom(targetJourneyId);
    };
  }, [isConnected, targetJourneyId, joinJourneyRoom, leaveJourneyRoom]);

  return {
    socket: socketRef.current,
    isConnected,
    joinJourneyRoom,
    leaveJourneyRoom,
  };
}
