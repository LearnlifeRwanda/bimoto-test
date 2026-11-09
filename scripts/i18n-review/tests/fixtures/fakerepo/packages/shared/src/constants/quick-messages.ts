// Fixture standing in for packages/shared/src/constants/quick-messages.ts.
// The apostrophes and braces in the comments below are deliberate: an
// earlier scanner treated a comment's apostrophe as an opening string
// quote and silently dropped four real entries from the workbook.

import { Language } from '../types/user.js';

export const QUICK_MESSAGES: QuickMessage[] = [
  {
    id: 'qm_on_my_way',
    text: {
      [Language.RW]: 'Ndaje',
      [Language.EN]: 'On my way',
      [Language.FR]: "J'arrive",
    },
    forRole: 'DRIVER',
  },
  // The driver's phrasing here matters { and so does this brace }.
  {
    id: 'qm_arrived',
    text: {
      [Language.RW]: 'Nagezeho',
      [Language.EN]: 'I have arrived',
      [Language.FR]: 'Je suis arrivé',
    },
    forRole: 'DRIVER',
  },
  /* Block comment with an apostrophe: the customer's reply. */
  {
    id: 'qm_thank_you',
    text: {
      [Language.RW]: 'Urakoze',
      [Language.EN]: 'Thank you',
      [Language.FR]: 'Merci',
    },
    forRole: 'BOTH',
  },
];
