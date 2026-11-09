// FIELD-CLOSE G3 — the user guide. A simple sectioned explainer of
// the things the field team kept being asked in person: how a ride
// works, how a parcel works, how bidding picks the driver, what SOS
// does, how to change language, where to get help. All copy lives in
// the guide.* locale keys (en/fr/rw) so the Kigali review workbook can
// correct it without touching code. Public by design — like
// /check-driver, a first-time user should be able to read it before
// they have an account.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

// Literal *Key properties so the i18n-used-keys gate sees every key.
const SECTIONS = [
  { id: 'ride', titleKey: 'guide.ride.title', bodyKey: 'guide.ride.body' },
  { id: 'parcel', titleKey: 'guide.parcel.title', bodyKey: 'guide.parcel.body' },
  { id: 'bidding', titleKey: 'guide.bidding.title', bodyKey: 'guide.bidding.body' },
  // TEAM-SAID G1 — the under-12 policy, kept in writing. Faustin,
  // Lievin and Sophonie asked for the line to stay in the guide even
  // though the booking flow no longer asks about children; this is
  // where it stays, next to the booking that no longer asks.
  { id: 'children', titleKey: 'guide.children.title', bodyKey: 'guide.children.body' },
  { id: 'sos', titleKey: 'guide.sos.title', bodyKey: 'guide.sos.body' },
  // RIDE-TRACE G4 — the passenger's half of the disclosure, in the
  // guide rather than buried in terms nobody reads, and next to SOS
  // because both are answers to the same question: what happens if
  // something goes wrong on this ride. The emergency follow is the one
  // exception to "never visible live to anyone", and it is inside this
  // section's body rather than a section of its own: a promise and its
  // exception in two places is a passenger reading only the first.
  { id: 'trace', titleKey: 'guide.trace.title', bodyKey: 'guide.trace.body' },
  { id: 'language', titleKey: 'guide.language.title', bodyKey: 'guide.language.body' },
  { id: 'help', titleKey: 'guide.help.title', bodyKey: 'guide.help.body' },
] as const;

export const UserGuidePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#1B4F72]"
          aria-label={t('common.back')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-heading font-semibold text-gray-900">
          {t('guide.title')}
        </h1>
      </div>

      <div className="w-full max-w-sm mx-auto px-4 py-6 space-y-4">
        {SECTIONS.map((section) => (
          <section
            key={section.id}
            className="bg-white rounded-xl shadow-sm p-4"
            data-testid={`guide-section-${section.id}`}
          >
            <h2 className="text-heading font-semibold text-gray-900 mb-2">
              {t(section.titleKey)}
            </h2>
            <p className="text-secondary text-gray-600 leading-relaxed">
              {t(section.bodyKey)}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
};

export default UserGuidePage;
