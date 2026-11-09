import { db } from '../db/dexie';
import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';

export class ConflictResolver {
  /**
   * Rule 1: Financial events (BID_ACCEPTED, ESCROW_*) — server ALWAYS wins.
   * If server says a bid was already accepted by someone else, revert local state.
   */
  async resolveFinancialConflict(journeyId: string, serverState: any): Promise<void> {
    const localJourney = await db.journeys.get(journeyId);
    if (localJourney && localJourney.status !== serverState.status) {
      await db.journeys.update(journeyId, {
        status: serverState.status,
        driverId: serverState.driverId,
        agreedPrice: serverState.agreedPrice,
      });
      // Sync Zustand store
      useJourneyStore.getState().updateJourney(journeyId, serverState);
    }
  }

  /**
   * Rule 2: GPS events — client timestamp wins. Server just stores what client recorded.
   * No conflict resolution needed client-side; server accepts client timestamps as-is.
   */
  resolveGpsConflict(): void {
    // No-op: GPS data flows client → server only. Client is source of truth for timestamps.
  }

  /**
   * Rule 3: State transitions — must follow state machine. Server wins on conflict.
   * If server has a different journey status than local, adopt server's state.
   */
  async resolveStateConflict(journeyId: string, serverStatus: string): Promise<void> {
    const localJourney = await db.journeys.get(journeyId);
    if (localJourney && localJourney.status !== serverStatus) {
      await db.journeys.update(journeyId, { status: serverStatus });
      // Sync Zustand store
      useJourneyStore.getState().updateJourney(journeyId, { status: serverStatus });
    }
  }

  /**
   * Rule 4: Messages — append-only, dedup by id.
   */
  async resolveMessageConflict(message: any): Promise<void> {
    const existing = await db.messages.get(message.id);
    if (!existing) {
      await db.messages.put(message);
    }
  }

  /**
   * Rule 5: Dedup by clientEventId — skip events already processed.
   */
  isDuplicate(clientEventId: string, existingIds: Set<string>): boolean {
    return existingIds.has(clientEventId);
  }

  /**
   * Apply a batch of server events to local stores, resolving conflicts.
   */
  async applyServerEvents(events: any[]): Promise<void> {
    for (const event of events) {
      switch (event.eventType) {
        case 'BID_ACCEPTED':
        case 'ESCROW_HELD':
        case 'ESCROW_RELEASED':
        case 'ESCROW_REFUNDED':
        case 'ESCROW_FROZEN':
          if (event.journeyId) {
            await this.resolveFinancialConflict(event.journeyId, event.payload);
          }
          break;
        case 'JOURNEY_STARTED':
        case 'JOURNEY_ENDED':
        case 'JOURNEY_CONFIRMED':
        case 'JOURNEY_CANCELLED':
        case 'JOURNEY_INTERRUPTED':
        case 'JOURNEY_DISPUTED':
        case 'JOURNEY_EXPIRED':
          if (event.journeyId && event.payload?.status) {
            await this.resolveStateConflict(event.journeyId, event.payload.status);
          }
          break;
        case 'MESSAGE_SENT':
          await this.resolveMessageConflict(event.payload);
          break;
        default:
          break;
      }
    }
  }
}
