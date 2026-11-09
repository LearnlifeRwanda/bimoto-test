import { Language, VehicleType } from '../types/user.js';
import { JourneyStatus } from '../types/journey.js';

export type QuickMessageReviewStatus = 'native-reviewed' | 'placeholder';

export interface QuickMessage {
  id: string;
  text: Record<Language, string>;
  forRole: 'CUSTOMER' | 'DRIVER' | 'BOTH';
  /** Journey states where this message should surface. Empty array means
   *  the message has no context restriction (treat as universal). */
  contexts: JourneyStatus[];
  /** IDs that are likely responses to this message. UI surfaces these
   *  near the top when the user has just received this message. */
  responseSet: string[];
  /** Optional emoji codepoint for visual recognition (driver literacy aid). */
  icon?: string;
  /** Per-locale review status. Map keys mirror Language values. */
  reviewStatus: Record<Language, QuickMessageReviewStatus>;
  /** R3-V — optional vehicle-type filter. When absent or empty, the
   *  message applies to all vehicle types. When present, the message
   *  only surfaces for journeys whose vehicleType is in the list.
   *  Backward-compatible: existing entries omit the field. */
  vehicleTypes?: VehicleType[];
}

const reviewedEnFrPlaceholderRw: Record<Language, QuickMessageReviewStatus> = {
  [Language.EN]: 'native-reviewed',
  [Language.RW]: 'placeholder',
  [Language.FR]: 'native-reviewed',
};

export const QUICK_MESSAGES: QuickMessage[] = [
  {
    id: 'qm_on_my_way',
    text: {
      [Language.RW]: 'Ndaje',
      [Language.EN]: 'On my way',
      [Language.FR]: 'J\'arrive',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_almost_there', 'qm_5_minutes', 'qm_stuck_traffic'],
    icon: '🛵',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_arrived',
    text: {
      [Language.RW]: 'Nagezeho',
      [Language.EN]: 'I have arrived',
      [Language.FR]: 'Je suis arrivé',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you', 'qm_5_minutes'],
    icon: '📍',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_waiting',
    text: {
      [Language.RW]: 'Ndategereje',
      [Language.EN]: 'I am waiting',
      [Language.FR]: 'J\'attends',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_almost_there', 'qm_5_minutes'],
    icon: '⏳',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_where_are_you',
    text: {
      [Language.RW]: 'Uri he?',
      [Language.EN]: 'Where are you?',
      [Language.FR]: 'Où êtes-vous ?',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_on_my_way', 'qm_almost_there', 'qm_5_minutes'],
    icon: '📍',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_almost_there',
    text: {
      [Language.RW]: 'Ndi hafi',
      [Language.EN]: 'Almost there',
      [Language.FR]: 'Presque là',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you'],
    icon: '🏁',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_stuck_traffic',
    text: {
      [Language.RW]: 'Mpagaze mu modoka nyinshi',
      [Language.EN]: 'Stuck in traffic',
      [Language.FR]: 'Coincé dans le trafic',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_5_minutes'],
    icon: '🚦',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_cancel_please',
    text: {
      [Language.RW]: 'Hagarika urugendo',
      [Language.EN]: 'Please cancel the ride',
      [Language.FR]: 'Veuillez annuler la course',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '❌',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_thank_you',
    text: {
      [Language.RW]: 'Urakoze',
      [Language.EN]: 'Thank you',
      [Language.FR]: 'Merci',
    },
    forRole: 'BOTH',
    contexts: [
      JourneyStatus.MATCHED,
      JourneyStatus.IN_PROGRESS,
      JourneyStatus.AWAITING_CONFIRMATION,
      JourneyStatus.COMPLETED,
    ],
    responseSet: [],
    icon: '🙏',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_5_minutes',
    text: {
      [Language.RW]: 'Ndageraho iminota 5',
      [Language.EN]: 'Give me 5 minutes',
      [Language.FR]: 'Donnez-moi 5 minutes',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '⏱️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_call_me',
    text: {
      [Language.RW]: 'Mpamagara',
      [Language.EN]: 'Call me',
      [Language.FR]: 'Appelez-moi',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '📞',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.1 — Pre-pickup, customer-side
  // ---------------------------------------------------------------------------
  {
    id: 'qm_at_pickup_cust',
    text: {
      [Language.EN]: 'I\'m at the pickup, where are you?',
      [Language.RW]: 'Ndi ahantu ho gufata, uri he?',
      [Language.FR]: 'Je suis au point de prise en charge, où êtes-vous ?',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_on_my_way', 'qm_almost_there', 'qm_stuck_traffic'],
    icon: '📍',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_late_5min_cust',
    text: {
      [Language.EN]: 'I\'m 5 minutes late myself',
      [Language.RW]: 'Nanjye nzatinda iminota 5',
      [Language.FR]: 'Je suis moi-même en retard de 5 minutes',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_waiting', 'qm_no_problem'],
    icon: '⏱️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_at_gate_cust',
    text: {
      [Language.EN]: 'I\'m at the gate',
      [Language.RW]: 'Ndi ku irembo',
      [Language.FR]: 'Je suis à la porte',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🚪',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_floor_2_cust',
    text: {
      [Language.EN]: 'I\'m on the 2nd floor — give me a minute',
      [Language.RW]: 'Ndi ku gorofa ya 2 — mpa umunota',
      [Language.FR]: 'Je suis au 2e étage — donnez-moi une minute',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_waiting'],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_floor_3_cust',
    text: {
      [Language.EN]: 'I\'m on the 3rd floor — give me a minute',
      [Language.RW]: 'Ndi ku gorofa ya 3 — mpa umunota',
      [Language.FR]: 'Je suis au 3e étage — donnez-moi une minute',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_waiting'],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_are_you_really_coming_cust',
    text: {
      [Language.EN]: 'Are you really coming? Please respond',
      [Language.RW]: 'Mu by\'ukuri uraza? Nyamuneka subiza',
      [Language.FR]: 'Venez-vous vraiment ? Veuillez répondre',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_on_my_way', 'qm_cant_make_trip_drv'],
    icon: '❓',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_will_cancel_soon_cust',
    text: {
      [Language.EN]: 'I will cancel if you don\'t arrive in 5 minutes',
      [Language.RW]: 'Nzahagarika niba utaza mu minota 5',
      [Language.FR]: 'J\'annulerai si vous n\'arrivez pas dans 5 minutes',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_almost_there', 'qm_on_my_way'],
    icon: '⚠️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.2 — Pre-pickup, driver-side
  // ---------------------------------------------------------------------------
  {
    id: 'qm_approaching_2min_drv',
    text: {
      [Language.EN]: 'Approaching, 2 minutes away',
      [Language.RW]: 'Ndegera, ngiye kugera mu minota 2',
      [Language.FR]: 'J\'approche, à 2 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you', 'qm_at_pickup_cust'],
    icon: '🛵',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_approaching_5min_drv',
    text: {
      [Language.EN]: 'Approaching, 5 minutes away',
      [Language.RW]: 'Ndegera, ngiye kugera mu minota 5',
      [Language.FR]: 'J\'approche, à 5 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you', 'qm_at_pickup_cust'],
    icon: '🛵',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_approaching_10min_drv',
    text: {
      [Language.EN]: 'Approaching, 10 minutes away',
      [Language.RW]: 'Ndegera, ngiye kugera mu minota 10',
      [Language.FR]: 'J\'approche, à 10 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you'],
    icon: '🛵',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_what_wearing_drv',
    text: {
      [Language.EN]: 'What are you wearing? It will help me find you',
      [Language.RW]: 'Wambaye iki? Bizamfasha kukubona',
      [Language.FR]: 'Que portez-vous ? Cela m\'aidera à vous trouver',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_clothing_red', 'qm_clothing_blue'],
    icon: '👕',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_describe_landmark_drv',
    text: {
      [Language.EN]: 'I can\'t find this address — can you describe a landmark?',
      [Language.RW]: 'Sinshobora kubona iyi aderesi — wasobanura ikimenyetso?',
      [Language.FR]: 'Je ne trouve pas cette adresse — pouvez-vous décrire un point de repère ?',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🗺️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_cant_make_trip_drv',
    text: {
      [Language.EN]: 'Sorry, my vehicle has a problem — I cannot make this trip',
      [Language.RW]: 'Mbabarira, ikinyabiziga cyanjye gifite ikibazo — sinshobora gukora uru rugendo',
      [Language.FR]: 'Désolé, mon véhicule a un problème — je ne peux pas faire ce trajet',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '⚠️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.3 — Mid-trip, customer-side
  // ---------------------------------------------------------------------------
  {
    id: 'qm_drive_carefully_cust',
    text: {
      [Language.EN]: 'Please drive carefully',
      [Language.RW]: 'Nyamuneka tware witonze',
      [Language.FR]: 'Veuillez conduire prudemment',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🛡️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_drive_slower_cust',
    text: {
      [Language.EN]: 'Please drive slower',
      [Language.RW]: 'Nyamuneka tware buhoro',
      [Language.FR]: 'Veuillez conduire plus lentement',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_different_route_cust',
    text: {
      [Language.EN]: 'Can we take a different route?',
      [Language.RW]: 'Twafata indi nzira?',
      [Language.FR]: 'Pouvons-nous prendre un autre itinéraire ?',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🛣️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_quick_stop_cust',
    text: {
      [Language.EN]: 'Can we make a quick stop?',
      [Language.RW]: 'Twahagarara akanya gato?',
      [Language.FR]: 'Pouvons-nous faire un arrêt rapide ?',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🛑',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_are_we_close_cust',
    text: {
      [Language.EN]: 'Are we close?',
      [Language.RW]: 'Tugiye kugera?',
      [Language.FR]: 'Sommes-nous proches ?',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_away_2min_drv', 'qm_away_5min_drv'],
    icon: '📍',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.4 — Mid-trip, driver-side
  // ---------------------------------------------------------------------------
  {
    id: 'qm_away_2min_drv',
    text: {
      [Language.EN]: '2 minutes away',
      [Language.RW]: 'Iminota 2',
      [Language.FR]: 'Dans 2 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '⏱️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_away_5min_drv',
    text: {
      [Language.EN]: '5 minutes away',
      [Language.RW]: 'Iminota 5',
      [Language.FR]: 'Dans 5 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '⏱️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_away_10min_drv',
    text: {
      [Language.EN]: '10 minutes away',
      [Language.RW]: 'Iminota 10',
      [Language.FR]: 'Dans 10 minutes',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '⏱️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_traffic_ahead_drv',
    text: {
      [Language.EN]: 'There is traffic ahead',
      [Language.RW]: 'Hari imodoka nyinshi imbere',
      [Language.FR]: 'Il y a du trafic devant',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🚦',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.5 — Post-trip
  // ---------------------------------------------------------------------------
  {
    id: 'qm_safe_arrival',
    text: {
      [Language.EN]: 'Safe arrival, thank you',
      [Language.RW]: 'Twageze amahoro, urakoze',
      [Language.FR]: 'Arrivée en sécurité, merci',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.AWAITING_CONFIRMATION, JourneyStatus.COMPLETED],
    responseSet: ['qm_thank_you'],
    icon: '✅',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_confirm_in_app_drv',
    text: {
      [Language.EN]: 'Please confirm the trip in the app',
      [Language.RW]: 'Nyamuneka emeza urugendo muri porogaramu',
      [Language.FR]: 'Veuillez confirmer le trajet dans l\'application',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.AWAITING_CONFIRMATION],
    responseSet: ['qm_thank_you'],
    icon: '✅',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_sorry_for_delay',
    text: {
      [Language.EN]: 'Sorry for the delay',
      [Language.RW]: 'Mbabarira ku gutinda',
      [Language.FR]: 'Désolé pour le retard',
    },
    forRole: 'BOTH',
    contexts: [JourneyStatus.AWAITING_CONFIRMATION, JourneyStatus.COMPLETED],
    responseSet: ['qm_no_problem'],
    icon: '🙏',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.6 — Cancellation-adjacent
  // ---------------------------------------------------------------------------
  {
    id: 'qm_cancel_no_show_cust',
    text: {
      [Language.EN]: 'I am cancelling because you did not come',
      [Language.RW]: 'Ndahagaritse kuko utaje',
      [Language.FR]: 'J\'annule parce que vous n\'êtes pas venu',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '❌',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_cancel_changed_plans_cust',
    text: {
      [Language.EN]: 'I am cancelling because I changed my plans',
      [Language.RW]: 'Ndahagaritse kuko nahinduye gahunda',
      [Language.FR]: 'J\'annule parce que j\'ai changé de plans',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_no_hard_feelings'],
    icon: '❌',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_cancel_safety_cust',
    text: {
      [Language.EN]: 'I am cancelling because of a safety concern',
      [Language.RW]: 'Ndahagaritse kubera ikibazo cy\'umutekano',
      [Language.FR]: 'J\'annule à cause d\'un problème de sécurité',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '⚠️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_will_try_another_cust',
    text: {
      [Language.EN]: 'I will try another driver',
      [Language.RW]: 'Nzagerageza undi mushoferi',
      [Language.FR]: 'Je vais essayer un autre chauffeur',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_no_hard_feelings',
    text: {
      [Language.EN]: 'No hard feelings',
      [Language.RW]: 'Nta kibazo',
      [Language.FR]: 'Sans rancune',
    },
    forRole: 'BOTH',
    contexts: [],
    responseSet: [],
    icon: '🤝',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_flat_tyre_drv',
    text: {
      [Language.EN]: 'I had a flat tyre',
      [Language.RW]: 'Mfite ipine yashizemo umuyaga',
      [Language.FR]: 'J\'ai eu un pneu crevé',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🛞',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.7 — Goods delivery
  // ---------------------------------------------------------------------------
  {
    id: 'qm_package_ready_cust',
    text: {
      [Language.EN]: 'The package is ready',
      [Language.RW]: 'Ipaki yiteguye',
      [Language.FR]: 'Le colis est prêt',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_on_my_way', 'qm_almost_there'],
    icon: '📦',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_have_package_drv',
    text: {
      [Language.EN]: 'I have the package',
      [Language.RW]: 'Mfite ipaki',
      [Language.FR]: 'J\'ai le colis',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '📦',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_package_delivered_drv',
    text: {
      [Language.EN]: 'Package delivered',
      [Language.RW]: 'Ipaki yatanzwe',
      [Language.FR]: 'Colis livré',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS, JourneyStatus.AWAITING_CONFIRMATION],
    responseSet: ['qm_thank_you'],
    icon: '✅',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_recipient_not_answering_drv',
    text: {
      [Language.EN]: 'The recipient is not answering',
      [Language.RW]: 'Uwakira ntiyitabye',
      [Language.FR]: 'Le destinataire ne répond pas',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_left_at_door_drv'],
    icon: '❓',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_left_at_door_drv',
    text: {
      [Language.EN]: 'I left the package at the door',
      [Language.RW]: 'Nasize ipaki ku muryango',
      [Language.FR]: 'J\'ai laissé le colis à la porte',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS, JourneyStatus.AWAITING_CONFIRMATION],
    responseSet: [],
    icon: '🚪',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.8 — Emergency
  // ---------------------------------------------------------------------------
  {
    id: 'qm_help_needed',
    text: {
      [Language.EN]: 'Help needed',
      [Language.RW]: 'Nkeneye ubufasha',
      [Language.FR]: 'Besoin d\'aide',
    },
    forRole: 'BOTH',
    contexts: [],
    responseSet: [],
    icon: '🚨',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_medical',
    text: {
      [Language.EN]: 'Medical emergency',
      [Language.RW]: 'Ibyihutirwa by\'ubuvuzi',
      [Language.FR]: 'Urgence médicale',
    },
    forRole: 'BOTH',
    contexts: [],
    responseSet: [],
    icon: '🏥',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_police_needed',
    text: {
      [Language.EN]: 'Police needed',
      [Language.RW]: 'Nkeneye polisi',
      [Language.FR]: 'Police nécessaire',
    },
    forRole: 'BOTH',
    contexts: [],
    responseSet: [],
    icon: '🚓',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // B.9 — Issue / complaint
  // ---------------------------------------------------------------------------
  {
    id: 'qm_drive_too_fast_cust',
    text: {
      [Language.EN]: 'You are driving too fast',
      [Language.RW]: 'Uratwara umuvuduko cyane',
      [Language.FR]: 'Vous conduisez trop vite',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_please_slow_down_cust',
    text: {
      [Language.EN]: 'Please slow down',
      [Language.RW]: 'Nyamuneka gabanya umuvuduko',
      [Language.FR]: 'Veuillez ralentir',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_please_stop_now_cust',
    text: {
      [Language.EN]: 'Please stop now',
      [Language.RW]: 'Nyamuneka hagarara nonaha',
      [Language.FR]: 'Veuillez vous arrêter maintenant',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🛑',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // Helper entries — referenced from responseSets above
  // ---------------------------------------------------------------------------
  {
    id: 'qm_no_problem',
    text: {
      [Language.EN]: 'No problem',
      [Language.RW]: 'Nta kibazo',
      [Language.FR]: 'Pas de problème',
    },
    forRole: 'BOTH',
    contexts: [],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_clothing_red',
    text: {
      [Language.EN]: 'I\'m wearing red',
      [Language.RW]: 'Nambaye umutuku',
      [Language.FR]: 'Je porte du rouge',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_clothing_blue',
    text: {
      [Language.EN]: 'I\'m wearing blue',
      [Language.RW]: 'Nambaye ubururu',
      [Language.FR]: 'Je porte du bleu',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // ---------------------------------------------------------------------------
  // R3-V — vehicle-specific messages. The vehicleTypes field gates the
  // message to journeys whose vehicleType is in the list.
  // ---------------------------------------------------------------------------
  {
    id: 'qm_helmet_please_cust',
    text: {
      [Language.EN]: 'Please wear a helmet',
      [Language.RW]: 'Nyamuneka ambara ingofero',
      [Language.FR]: 'Veuillez porter un casque',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🪖',
    reviewStatus: reviewedEnFrPlaceholderRw,
    vehicleTypes: [VehicleType.MOTO, VehicleType.E_MOTO],
  },
  {
    id: 'qm_helmet_for_passenger_drv',
    text: {
      [Language.EN]: 'Helmet ready for you',
      [Language.RW]: 'Ingofero iri tegure',
      [Language.FR]: 'Casque prêt pour vous',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you'],
    icon: '🪖',
    reviewStatus: reviewedEnFrPlaceholderRw,
    vehicleTypes: [VehicleType.MOTO, VehicleType.E_MOTO],
  },
  {
    id: 'qm_pedal_pace_drv',
    text: {
      [Language.EN]: 'Going at pedalling pace',
      [Language.RW]: 'Ndatambaga buhoro',
      [Language.FR]: 'Je pédale, allure modérée',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_no_problem'],
    icon: '🚲',
    reviewStatus: reviewedEnFrPlaceholderRw,
    vehicleTypes: [VehicleType.BIKE, VehicleType.E_BIKE],
  },
  {
    id: 'qm_uphill_slow_drv',
    text: {
      [Language.EN]: 'Slower on the hill',
      [Language.RW]: 'Buhoro ku musozi',
      [Language.FR]: 'Plus lent dans la montée',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_no_problem'],
    icon: '⛰️',
    reviewStatus: reviewedEnFrPlaceholderRw,
    vehicleTypes: [VehicleType.BIKE, VehicleType.E_BIKE],
  },
  {
    id: 'qm_battery_low_drv',
    text: {
      [Language.EN]: 'Battery is low',
      [Language.RW]: 'Bateri irarangiye',
      [Language.FR]: 'Batterie faible',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    icon: '🔋',
    reviewStatus: reviewedEnFrPlaceholderRw,
    vehicleTypes: [VehicleType.E_BIKE, VehicleType.E_MOTO],
  },
  // R3-CHILD — child-passenger and safety quick-messages.
  // 12 child + 3 safety entries; all rw strings are machine-translated
  // placeholders awaiting GAP-P4 native review.
  {
    id: 'qm_child_travelling_with_child',
    text: {
      [Language.EN]: 'I am travelling with a small child',
      [Language.RW]: 'Ndi kumwe n\'umwana muto',
      [Language.FR]: 'Je voyage avec un jeune enfant',
    },
    forRole: 'CUSTOMER',
    contexts: [],
    responseSet: ['qm_child_drive_slower', 'qm_child_has_helmet'],
    icon: '👶',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_drive_slower',
    text: {
      [Language.EN]: 'Please drive slower because of the child',
      [Language.RW]: 'Twiyumvirira kubera umwana, twibere buhoro',
      [Language.FR]: 'Conduisez plus lentement à cause de l\'enfant',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_no_problem'],
    icon: '🐢',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_child_afraid',
    text: {
      [Language.EN]: 'The child is afraid — please drive even more slowly',
      [Language.RW]: 'Umwana arafite ubwoba — wiyumvirira ugende buhoro cyane',
      [Language.FR]: 'L\'enfant a peur — roulez encore plus lentement',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_no_problem'],
    icon: '😢',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_has_helmet',
    text: {
      [Language.EN]: 'The child has a helmet',
      [Language.RW]: 'Umwana afite ingofero',
      [Language.FR]: 'L\'enfant a un casque',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you'],
    icon: '🪖',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_no_helmet',
    text: {
      [Language.EN]: 'The child does not have a helmet — do you have a small one?',
      [Language.RW]: 'Umwana ntafite ingofero — ufite ngufi?',
      [Language.FR]: 'L\'enfant n\'a pas de casque — en avez-vous un petit ?',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🪖',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_have_seat',
    text: {
      [Language.EN]: 'I have a child seat available',
      [Language.RW]: 'Mfite intebe y\'umwana',
      [Language.FR]: 'J\'ai un siège enfant disponible',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_thank_you'],
    icon: '💺',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_parent_calling',
    text: {
      [Language.EN]: 'I am a parent calling on behalf of a child passenger',
      [Language.RW]: 'Ndi umubyeyi mbahamagariye umwana',
      [Language.FR]: 'Je suis un parent qui appelle au nom d\'un enfant passager',
    },
    forRole: 'CUSTOMER',
    contexts: [],
    responseSet: ['qm_child_call_parent_on_arrival'],
    icon: '👨‍👩‍👧',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_child_alone',
    text: {
      [Language.EN]: 'My child is travelling alone, please be careful',
      [Language.RW]: 'Umwana wanjye ari wenyine — wiyumvirira',
      [Language.FR]: 'Mon enfant voyage seul, soyez prudent',
    },
    forRole: 'CUSTOMER',
    contexts: [],
    responseSet: ['qm_child_call_parent_on_arrival'],
    icon: '🧒',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_child_picked_up',
    text: {
      [Language.EN]: 'The child has been picked up safely',
      [Language.RW]: 'Umwana yafashwe neza',
      [Language.FR]: 'L\'enfant a été pris en charge en toute sécurité',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '✅',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_child_delivered',
    text: {
      [Language.EN]: 'The child has been delivered safely',
      [Language.RW]: 'Umwana yagezweyo amahoro',
      [Language.FR]: 'L\'enfant a été livré en toute sécurité',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.IN_PROGRESS, JourneyStatus.AWAITING_CONFIRMATION],
    responseSet: ['qm_thank_you'],
    icon: '🎉',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_speaks_only_rw',
    text: {
      [Language.EN]: 'The child speaks only Kinyarwanda',
      [Language.RW]: 'Umwana avuga Ikinyarwanda gusa',
      [Language.FR]: 'L\'enfant ne parle que le kinyarwanda',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🗣️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_child_call_parent_on_arrival',
    text: {
      [Language.EN]: 'I will call you when I arrive',
      [Language.RW]: 'Nzaguhamagara naho ngeze',
      [Language.FR]: 'Je vous appellerai à mon arrivée',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: ['qm_thank_you'],
    icon: '📞',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_safety_confirm_age',
    text: {
      [Language.EN]: 'I confirm the passenger is over the legal minimum age for a motorcycle',
      [Language.RW]: 'Nemeza ko umugenzi yujuje imyaka isabwa kuri pikipiki',
      [Language.FR]: 'Je confirme que le passager a l\'âge légal minimum pour la moto',
    },
    forRole: 'CUSTOMER',
    contexts: [],
    responseSet: ['qm_thank_you'],
    icon: '✔️',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_safety_cannot_carry_child',
    text: {
      [Language.EN]: 'I am not legally allowed to carry this child on a motorcycle — please request a bicycle or car',
      [Language.RW]: 'Nta burenganzira mfite bwo gutwara uyu mwana kuri pikipiki — saba igare cyangwa imodoka',
      [Language.FR]: 'Je n\'ai pas le droit de transporter cet enfant à moto — demandez un vélo ou une voiture',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: [],
    icon: '🚫',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_safety_helmets_required',
    text: {
      [Language.EN]: 'Helmets are required for both passenger and driver — please confirm you have one',
      [Language.RW]: 'Ingofero ni ngombwa ku mugenzi n\'umushoferi — emeza ko ifite',
      [Language.FR]: 'Les casques sont obligatoires pour le passager et le conducteur — confirmez en avoir un',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED],
    responseSet: ['qm_child_has_helmet', 'qm_child_no_helmet'],
    icon: '🪖',
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  // R3-EXPRESS — urgent-handoff conversational layer. 6 entries scoped
  // to MATCHED / IN_PROGRESS — the windows where recipient-waiting,
  // sealed-envelope, and signature-required cues actually fire. All rw
  // strings are machine-translated placeholders awaiting GAP-P4 review.
  {
    id: 'qm_urgent_recipient_waiting',
    text: {
      [Language.EN]: 'The recipient is waiting and ready',
      [Language.RW]: 'Uwakira ategereje ari witeguye',
      [Language.FR]: 'Le destinataire attend et est prêt',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_urgent_recipient_unavailable',
    text: {
      [Language.EN]: 'The recipient is not yet available — please wait',
      [Language.RW]: 'Uwakira ntaraboneka — ategereze',
      [Language.FR]: 'Le destinataire n\'est pas encore disponible — veuillez attendre',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_urgent_handoff_only',
    text: {
      [Language.EN]: 'This is a fast handoff — no waiting needed',
      [Language.RW]: 'Iri ni iherekezwa ryihuse — nta gutegereza bisabwa',
      [Language.FR]: 'Ceci est un transfert rapide — pas besoin d\'attendre',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_urgent_signature_required',
    text: {
      [Language.EN]: 'The recipient must sign on delivery',
      [Language.RW]: 'Uwakira agomba gusinya ku itangwa',
      [Language.FR]: 'Le destinataire doit signer à la livraison',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_urgent_sealed_envelope',
    text: {
      [Language.EN]: 'This envelope is sealed — please do not open',
      [Language.RW]: 'Iyi nyandiko ifunze — ntimuyifungure',
      [Language.FR]: 'Cette enveloppe est scellée — ne l\'ouvrez pas',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_urgent_deadline_minutes',
    text: {
      [Language.EN]: 'I need this delivered within the next 30 minutes',
      [Language.RW]: 'Nshaka ko bigezwa mu minota 30 itaha',
      [Language.FR]: 'J\'ai besoin que ceci soit livré dans les 30 prochaines minutes',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // R3-DELIVERY — six quick-messages for the customer + parcel multi-stop
  // flow. Driver-facing strings cover the parcel handoff lifecycle
  // (collected → en route → delivered or recipient-not-present); customer
  // strings flag fragility and pre-paid drop-offs so the driver knows
  // not to demand payment at the recipient. All rw strings are
  // machine-translated placeholders awaiting GAP-P4 review.
  {
    id: 'qm_delivery_parcel_handed_off',
    text: {
      [Language.EN]: 'I have collected the parcel and am on my way',
      [Language.RW]: 'Nakiriye ifunika ndi munzira',
      [Language.FR]: 'J\'ai récupéré le colis et je suis en route',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_delivery_recipient_signed',
    text: {
      [Language.EN]: 'The recipient has signed for the parcel',
      [Language.RW]: 'Uwakira yasinye ku ifunika',
      [Language.FR]: 'Le destinataire a signé pour le colis',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_delivery_parcel_delivered',
    text: {
      [Language.EN]: 'The parcel has been delivered safely',
      [Language.RW]: 'Ifunika ryagejejweyo neza',
      [Language.FR]: 'Le colis a été livré en toute sécurité',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_delivery_recipient_not_present',
    text: {
      [Language.EN]: 'The recipient is not at the address — what should I do?',
      [Language.RW]: 'Uwakira nta hari aha aderesi — nkore iki?',
      [Language.FR]: 'Le destinataire n\'est pas à l\'adresse — que dois-je faire?',
    },
    forRole: 'DRIVER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_delivery_fragile_parcel',
    text: {
      [Language.EN]: 'This parcel is fragile, please handle with care',
      [Language.RW]: 'Iri funika ryangirika vuba, nyamuneka ribyitwareho neza',
      [Language.FR]: 'Ce colis est fragile, veuillez le manipuler avec soin',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_delivery_fee_paid_already',
    text: {
      [Language.EN]: 'The recipient has already paid — no payment needed at drop-off',
      [Language.RW]: 'Uwakira yamaze kwishyura — nta kwishyura bikenewe ku gutangwa',
      [Language.FR]: 'Le destinataire a déjà payé — pas de paiement requis à la livraison',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },

  // R3-PRIORITY — softer-urgency conversational layer for the
  // PRIORITY_MESSENGER tier. Less time-pressured than R3-EXPRESS's
  // qm_urgent_* set: the recipient can wait a bit, signing is
  // optional, leaving at reception is acceptable. All rw strings are
  // machine-translated placeholders awaiting GAP-P4 review.
  {
    id: 'qm_priority_recipient_can_wait_30min',
    text: {
      [Language.EN]: 'The recipient can wait 30 minutes',
      [Language.RW]: 'Uwakira ashobora gutegereza iminota 30',
      [Language.FR]: 'Le destinataire peut attendre 30 minutes',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_priority_signing_optional',
    text: {
      [Language.EN]: 'A signature would be nice but is not required',
      [Language.RW]: 'Umukono wakwemerwa ariko ntiwasabwa',
      [Language.FR]: 'Une signature serait appréciée mais n\'est pas requise',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_priority_drop_at_reception',
    text: {
      [Language.EN]: 'If no answer, leave it at reception',
      [Language.RW]: 'Niba nta gisubizo, sigara ku karangurura',
      [Language.FR]: 'Sans réponse, laissez-le à la réception',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
  {
    id: 'qm_priority_call_when_close',
    text: {
      [Language.EN]: 'Please call me when you are 5 minutes away',
      [Language.RW]: 'Nyamuneka mumpamagare iyo musigaye iminota 5',
      [Language.FR]: 'Appelez-moi quand vous serez à 5 minutes',
    },
    forRole: 'CUSTOMER',
    contexts: [JourneyStatus.MATCHED, JourneyStatus.IN_PROGRESS],
    responseSet: [],
    reviewStatus: reviewedEnFrPlaceholderRw,
  },
];
