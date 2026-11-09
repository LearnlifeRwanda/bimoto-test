export type NotificationEventKey =
  | 'bidReceived'
  | 'bidAccepted'
  | 'bidDeclined'
  | 'journeyStarted'
  | 'journeyEnded'
  | 'journeyConfirmed'
  | 'journeyCancelled'
  | 'journeyDisputed'
  | 'journeyInterrupted'
  | 'newMessage'
  | 'escrowReleased'
  | 'escrowRefunded'
  | 'ratingReceived'
  | 'driverNewlyAvailable'
  | 'rideNotStarted'
  | 'noShowWarning'
  | 'accountSuspended'
  | 'accountFlagged'
  | 'disputeUpheld'
  | 'disputeRejected'
  | 'disputeClosedNoAction'
  // FIELD-FIT G4 — the admin's verification decision, told to the
  // driver who is waiting for it. Approve/reject wrote the row and said
  // nothing, so a motari learned his fate only by opening the app.
  | 'verificationApproved'
  | 'verificationRejected'
  // COUNTER-READY G2 — the one-counter-per-bid conversation. Dormant
  // behind COUNTER_BID_ENABLED until the founder flips it, so these
  // three sit here unsent until the baseline weeks are done.
  | 'bidCountered'
  | 'counterAccepted'
  | 'counterDeclined';

export interface NotificationStrings {
  title: string;
  body: string;
}

// Per-language string table for the 14 push events that
// notification.service.ts dispatches. Templates use {var} placeholders
// which the server interpolates at send time.
//
// `rw` translations were drafted to keep titles short and the body
// actionable; a fluent reviewer should verify register and idiom
// before wider rollout (see TODO marker further down). Do NOT
// machine-translate replacements for those strings.

const en: Record<NotificationEventKey, NotificationStrings> = {
  bidReceived: {
    title: 'New bid',
    body: 'A driver has bid on your journey. Tap to review.',
  },
  bidAccepted: {
    title: 'Your bid was accepted',
    body: 'You won the journey. Tap to start.',
  },
  bidDeclined: {
    title: 'Bid declined',
    body: 'Your bid was not selected this time.',
  },
  journeyStarted: {
    title: 'Journey started',
    body: 'Your driver has begun the journey.',
  },
  journeyEnded: {
    title: 'Journey ended',
    body: 'Confirm the journey is complete to release payment.',
  },
  journeyConfirmed: {
    title: 'Payment released',
    body: 'The customer confirmed. Funds are on the way.',
  },
  journeyCancelled: {
    title: 'Journey cancelled',
    body: 'The journey has been cancelled.',
  },
  journeyDisputed: {
    title: 'Journey under review',
    body: 'A dispute has been opened. Support will reach out.',
  },
  journeyInterrupted: {
    title: 'Journey interrupted',
    body: 'The journey was interrupted. Tap for details.',
  },
  newMessage: {
    title: 'New message from {sender}',
    body: '{preview}',
  },
  escrowReleased: {
    title: 'Payment received',
    body: '{amount} RWF has been released to your wallet.',
  },
  escrowRefunded: {
    title: 'Refund issued',
    body: '{amount} RWF has been refunded.',
  },
  ratingReceived: {
    title: 'New {stars}-star rating',
    body: 'You received a new rating. Tap to view.',
  },
  driverNewlyAvailable: {
    title: 'New journey nearby',
    body: 'A passenger is requesting a ride near you. Tap to bid.',
  },
  rideNotStarted: {
    title: "Ride hasn't started yet",
    body: "This ride hasn't started yet — tap to resolve.",
  },
  noShowWarning: {
    title: 'No-show warning',
    body: "You've reached {count} no-shows. Further no-shows may suspend your account.",
  },
  accountSuspended: {
    title: 'Account suspended',
    body: 'Your driver account is suspended until {until}. You cannot bid on journeys until then.',
  },
  accountFlagged: {
    title: 'Account flagged for review',
    body: 'Your account has been flagged for admin review due to repeated no-shows.',
  },
  disputeUpheld: {
    title: 'Dispute upheld',
    body: 'An admin reviewed your no-show dispute and decided in your favour. The no-show has been removed from your record.',
  },
  disputeRejected: {
    title: 'Dispute rejected',
    body: 'An admin reviewed your no-show dispute and the original attribution stands.',
  },
  disputeClosedNoAction: {
    title: 'Dispute closed',
    body: 'An admin reviewed your no-show dispute and closed it without further action.',
  },
  verificationApproved: {
    title: 'You are approved',
    body: 'Your documents were accepted. You can start accepting rides now.',
  },
  verificationRejected: {
    title: 'Documents not accepted',
    body: 'Your documents were not accepted: {reason}. You can send them again from My documents.',
  },
  bidCountered: {
    title: 'A different price was suggested',
    body: 'The passenger suggested {amount} RWF instead of your {original} RWF. Tap to accept or decline.',
  },
  counterAccepted: {
    title: 'Your price was accepted',
    body: 'The driver accepted {amount} RWF. Your ride is matched.',
  },
  counterDeclined: {
    title: 'Your price was not accepted',
    body: 'The driver kept their offer of {original} RWF. You can still accept it.',
  },
};

// TODO Kinyarwanda native review — these were drafted to keep titles
// short and the body actionable; a fluent reviewer should verify
// register and idiom before the pilot.
const rw: Record<NotificationEventKey, NotificationStrings> = {
  bidReceived: {
    title: 'Igisubizo gishya', // "New response"
    body: 'Umushoferi yatanze igiciro. Kanda urebe.',
  },
  bidAccepted: {
    title: 'Watsindiye urugendo',
    body: 'Watsindiye urugendo. Kanda utangire.',
  },
  bidDeclined: {
    title: 'Igisubizo nticyatoranyijwe',
    body: 'Igiciro cyawe nticyatoranyijwe iki gihe.',
  },
  journeyStarted: {
    title: 'Urugendo rwatangiye',
    body: 'Umushoferi yatangiye urugendo.',
  },
  journeyEnded: {
    title: 'Urugendo rurangiye',
    body: 'Emeza ko urugendo rwarangiye kugira ngo umushoferi yishyurwe.',
  },
  journeyConfirmed: {
    title: 'Amafaranga yoherejwe',
    body: 'Umukiriya yemeje. Amafaranga arageze.',
  },
  journeyCancelled: {
    title: 'Urugendo rwahagaritswe',
    body: 'Urugendo rwahagaritswe.',
  },
  journeyDisputed: {
    title: 'Urugendo rurarebwa',
    body: 'Hatanzwe ibibazo. Twazagufasha.',
  },
  journeyInterrupted: {
    title: 'Urugendo rwahagaze',
    body: 'Urugendo rwahagaze. Kanda urebe ibisobanuro.',
  },
  newMessage: {
    title: 'Ubutumwa bushya: {sender}',
    body: '{preview}',
  },
  escrowReleased: {
    title: 'Wakiriye amafaranga',
    body: '{amount} RWF yashyizwe muri konti yawe.',
  },
  escrowRefunded: {
    title: 'Wasubijwe amafaranga',
    body: '{amount} RWF yarasubijwe.',
  },
  ratingReceived: {
    title: 'Inyenyeri {stars} nshya',
    body: 'Wahawe igipimo gishya. Kanda urebe.',
  },
  driverNewlyAvailable: {
    title: 'Urugendo rushya hafi yawe',
    body: 'Umugenzi arasaba urugendo hafi yawe. Kanda utange igiciro.',
  },
  rideNotStarted: {
    title: 'Urugendo ntirwatangiye',
    body: 'Uru rugendo ntirwatangiye — kanda urebe icyo wakora.',
  },
  noShowWarning: {
    title: 'Iburira ryo kudahari',
    body: 'Wageze ku ngendo {count} utahari. Ibindi bizatuma konti yawe ihagarikwa.',
  },
  accountSuspended: {
    title: 'Konti yawe yahagaritswe',
    body: 'Konti yawe y’umushoferi yahagaritswe kugeza {until}. Ntushobora gutanga ibiciro mbere y’icyo gihe.',
  },
  accountFlagged: {
    title: 'Konti yawe yamenyekanyeshejwe',
    body: 'Konti yawe yamenyekanyeshejwe kubera kudahari incuro nyinshi. Iperereza riraba.',
  },
  // TODO Kinyarwanda native review — dispute resolution outcomes (R3-N-5).
  disputeUpheld: {
    title: 'Ikibazo cyemewe',
    body: 'Umuyobozi yasuzumye ikibazo cyawe maze afata icyemezo cyo kukwemera. Kudahari byavanywe muri konti yawe.',
  },
  disputeRejected: {
    title: 'Ikibazo cyanzwe',
    body: 'Umuyobozi yasuzumye ikibazo cyawe maze afata icyemezo gikomera ku byavuzwe mbere.',
  },
  disputeClosedNoAction: {
    title: 'Ikibazo cyafunzwe',
    body: 'Umuyobozi yasuzumye ikibazo cyawe maze akigifunga nta gikorwa cyongeyeho.',
  },
  verificationApproved: {
    title: 'Wemerewe',
    body: 'Impapuro zawe zemewe. Ushobora gutangira kwakira ingendo ubu.',
  },
  verificationRejected: {
    title: 'Impapuro ntizemewe',
    body: 'Impapuro zawe ntizemewe: {reason}. Ushobora kongera kuzohereza muri Impapuro zanjye.',
  },
  bidCountered: {
    title: 'Hatanzwe igiciro gitandukanye',
    body: 'Umugenzi yasabye {amount} RWF aho gutanga {original} RWF wari watanze. Kanda wemere cyangwa wange.',
  },
  counterAccepted: {
    title: 'Igiciro cyawe cyemewe',
    body: 'Umushoferi yemeye {amount} RWF. Urugendo rwawe rwabonetse.',
  },
  counterDeclined: {
    title: 'Igiciro cyawe nticyemewe',
    body: 'Umushoferi yagumanye igiciro cye cya {original} RWF. Uracyashobora kukwemera.',
  },
};

const fr: Record<NotificationEventKey, NotificationStrings> = {
  bidReceived: {
    title: 'Nouvelle offre',
    body: 'Un chauffeur a fait une offre sur votre course. Appuyez pour examiner.',
  },
  bidAccepted: {
    title: 'Votre offre a été acceptée',
    body: 'Vous avez gagné la course. Appuyez pour commencer.',
  },
  bidDeclined: {
    title: 'Offre refusée',
    body: "Votre offre n'a pas été retenue cette fois.",
  },
  journeyStarted: {
    title: 'Course commencée',
    body: 'Votre chauffeur a commencé la course.',
  },
  journeyEnded: {
    title: 'Course terminée',
    body: 'Confirmez la fin de la course pour libérer le paiement.',
  },
  journeyConfirmed: {
    title: 'Paiement libéré',
    body: 'Le client a confirmé. Les fonds sont en route.',
  },
  journeyCancelled: {
    title: 'Course annulée',
    body: 'La course a été annulée.',
  },
  journeyDisputed: {
    title: 'Course en litige',
    body: 'Un litige a été ouvert. Le support va vous contacter.',
  },
  journeyInterrupted: {
    title: 'Course interrompue',
    body: 'La course a été interrompue. Appuyez pour les détails.',
  },
  newMessage: {
    title: 'Nouveau message de {sender}',
    body: '{preview}',
  },
  escrowReleased: {
    title: 'Paiement reçu',
    body: '{amount} RWF ont été versés à votre portefeuille.',
  },
  escrowRefunded: {
    title: 'Remboursement émis',
    body: '{amount} RWF ont été remboursés.',
  },
  ratingReceived: {
    title: 'Nouvelle note {stars} étoiles',
    body: 'Vous avez reçu une nouvelle note. Appuyez pour la voir.',
  },
  driverNewlyAvailable: {
    title: 'Nouvelle course à proximité',
    body: 'Un passager cherche une course près de vous. Appuyez pour faire une offre.',
  },
  rideNotStarted: {
    title: "La course n'a pas commencé",
    body: "Cette course n'a pas encore commencé — appuyez pour la résoudre.",
  },
  noShowWarning: {
    title: 'Avertissement : absences',
    body: "Vous avez atteint {count} absences. D'autres absences peuvent suspendre votre compte.",
  },
  accountSuspended: {
    title: 'Compte suspendu',
    body: 'Votre compte chauffeur est suspendu jusqu’au {until}. Vous ne pouvez pas faire d’offres avant.',
  },
  accountFlagged: {
    title: 'Compte signalé',
    body: 'Votre compte a été signalé à l’administration en raison d’absences répétées.',
  },
  disputeUpheld: {
    title: 'Contestation acceptée',
    body: 'Un administrateur a examiné votre contestation et a décidé en votre faveur. L’absence a été supprimée de votre dossier.',
  },
  disputeRejected: {
    title: 'Contestation rejetée',
    body: 'Un administrateur a examiné votre contestation et l’attribution initiale est maintenue.',
  },
  disputeClosedNoAction: {
    title: 'Contestation clôturée',
    body: 'Un administrateur a examiné votre contestation et l’a clôturée sans action supplémentaire.',
  },
  verificationApproved: {
    title: 'Vous êtes approuvé',
    body: 'Vos documents ont été acceptés. Vous pouvez commencer à accepter des courses.',
  },
  verificationRejected: {
    title: 'Documents non acceptés',
    body: "Vos documents n'ont pas été acceptés : {reason}. Vous pouvez les renvoyer depuis Mes documents.",
  },
  bidCountered: {
    title: 'Un autre prix a été proposé',
    body: 'Le passager propose {amount} RWF au lieu de vos {original} RWF. Appuyez pour accepter ou refuser.',
  },
  counterAccepted: {
    title: 'Votre prix a été accepté',
    body: 'Le chauffeur a accepté {amount} RWF. Votre course est confirmée.',
  },
  counterDeclined: {
    title: "Votre prix n'a pas été accepté",
    body: 'Le chauffeur maintient son offre de {original} RWF. Vous pouvez toujours l’accepter.',
  },
};

// Export a flat keyed-by-string map so server code can index by the
// raw `User.language` enum value (`'en'` | `'rw'` | `'fr'`) without
// needing the shared Language enum type at the call site.
export const NOTIFICATION_STRINGS: Record<
  'en' | 'rw' | 'fr',
  Record<NotificationEventKey, NotificationStrings>
> = { en, rw, fr };
