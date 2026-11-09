import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { OfflineMapCard } from '../../components/map/OfflineMapCard';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
// CUTGUARD v2 G2 — "a field never loaded is never saved". Same mechanism
// as SettingsPage, and deliberately the same one: two screens editing the
// same field must not each have their own opinion about what an absent
// payload means.
import { deriveSave, forDisplay, fieldFromResponse } from '../../lib/loaded-field';
import { useLoadedUserField } from '../../hooks/useLoadedUserField';
import { presentApiError } from '../../lib/api-error-presenter';
import { performLogout } from '../../lib/logout';
import { getDriverRatingInfo } from '../../lib/driver-rating';
// PILOT-GUARD Item 8 — the shared declarations, not a third copy.
//
// MAX_EMERGENCY_CONTACTS was declared THREE times: here, in
// SettingsPage, and — the real one — in shared/constants/config.ts,
// where the emergencyContactsSchema the server enforces reads it. The
// two local `const MAX_EMERGENCY_CONTACTS = 3` lines shadowed it in a
// way the constants guard is structurally unable to see, so raising the
// cap in one place would have left two screens silently capping at 3.
import { isValidEmergencyContact, MAX_EMERGENCY_CONTACTS } from '@bimoto/shared';

export const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const { showToast } = useUIStore();

  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [isSaving, setIsSaving] = useState(false);

  // Emergency contacts
  // GAP-CLOSE G2 — belt. `contacts.map` below assumes an array; one field
  // crash came from a v13 server that answered with a legacy STRING, and
  // `'0788...' || []` keeps the string. PILOT-GUARD Item 8's server has
  // sent arrays ever since (emergencyContactsSchema enforces it), and the
  // shared User type still declares the field `string` — so the belt costs
  // one line and removes the last shape the screen cannot survive.
  // CUTGUARD v2 G2 — the `: []` arm of this ternary was the clobber. The
  // Array.isArray belt was right about SHAPE and silent about PROVENANCE:
  // it turned both "no contacts" and "no field on the payload" into the
  // same empty list, which the whole-array PUT below then wrote back.
  const {
    field: contactsField,
    setField: setContactsField,
    ensureLoaded: ensureContactsLoaded,
  } = useLoadedUserField<string[]>((u) =>
    Array.isArray(u?.emergencyContacts) ? u.emergencyContacts : undefined,
  );
  const contacts = forDisplay(contactsField, [] as string[]);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [newContact, setNewContact] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);

  // AUTH-UX G3 — logout, one tap from Profile (every role's nav has a
  // Profile tab; Settings was the only holder before and D6 left it
  // hard to find). Confirmed via the existing settings.logout strings,
  // then the shared performLogout sequence — no new logout logic.
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    await performLogout();
    navigate('/login', { replace: true });
  };

  const handleSaveProfile = async () => {
    if (!nickname.trim()) {
      showToast(t('profile.nicknameRequired'), 'error');
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/users/me`, {
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ nickname: nickname.trim() }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setUser(updated);
      setIsEditing(false);
      showToast(t('profile.saved'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddContact = async () => {
    if (!newContact.trim()) return;
    if (contacts.length >= MAX_EMERGENCY_CONTACTS) {
      showToast(t('profile.maxContacts', { max: MAX_EMERGENCY_CONTACTS }), 'error');
      return;
    }
    // PILOT-GUARD Item 8 — the same check SettingsPage has always run.
    //
    // Same editor, same field, same PUT /api/users/me: this screen
    // submitted the contact unvalidated, so a number Bimoto cannot dial
    // reached the server and came back as a generic rejection — on the
    // one list that only matters during an emergency.
    if (!isValidEmergencyContact(newContact)) {
      setContactError(t('errors.invalidEmergencyContact'));
      return;
    }
    setContactError(null);

    // CUTGUARD v2 G2 — see SettingsPage: no loaded field, no replacement
    // array, nothing to send.
    let next = deriveSave(contactsField, (cur) => [...cur, newContact.trim()]);
    if (!next.ok) {
      const healed = await ensureContactsLoaded();
      next = deriveSave(healed, (cur) => [...cur, newContact.trim()]);
    }
    if (!next.ok) {
      showToast(t('errors.contactsNotLoaded'), 'error');
      return;
    }
    const updatedContacts = next.value;

    setIsAddingContact(true);
    try {
      const res = await apiFetch(`/api/users/me`, {
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ emergencyContacts: updatedContacts }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setUser(updated);
      setContactsField(fieldFromResponse(updated?.emergencyContacts ?? updatedContacts));
      setNewContact('');
      setContactModalOpen(false);
      showToast(t('profile.contactAdded'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsAddingContact(false);
    }
  };

  const handleRemoveContact = async (index: number) => {
    // NET-UX G3 — one removal at a time; re-taps are no-ops.
    if (removingIndex !== null) return;
    // CUTGUARD v2 G2 — a removal is a whole-array replace too.
    let next = deriveSave(contactsField, (cur) => cur.filter((_, i) => i !== index));
    if (!next.ok) {
      const healed = await ensureContactsLoaded();
      next = deriveSave(healed, (cur) => cur.filter((_, i) => i !== index));
    }
    if (!next.ok) {
      showToast(t('errors.contactsNotLoaded'), 'error');
      return;
    }
    const updatedContacts = next.value;

    setRemovingIndex(index);
    try {
      const res = await apiFetch(`/api/users/me`, {
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ emergencyContacts: updatedContacts }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setUser(updated);
      setContactsField(fieldFromResponse(updated?.emergencyContacts ?? updatedContacts));
      showToast(t('profile.contactRemoved'), 'info');
    } catch (err) {
      presentApiError(err);
    } finally {
      setRemovingIndex(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isDriver = user.role === 'DRIVER' || user.role === 'BOTH';
  // PROFILE-RESCUE G2 — the raw profile row's avgRating is a Prisma
  // Decimal that JSON-serializes as a STRING ("4.85"); calling .toFixed
  // on it directly crashed every driver's Profile (the Kigali field
  // report). The shared accessor Number()-coerces and maps never-rated
  // (0) to null, same as every other rating consumer since RATE-DISPLAY.
  const driverRating = getDriverRatingInfo(user).avgRating;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-title font-bold text-[#1B4F72] mb-6">
          {t('profile.title')}
        </h1>

        {/* User Info Card */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-[#1B4F72]/10 flex items-center justify-center">
              {/* FIELD-UX G3 — the wire may carry an empty (or missing)
                  nickname; nickname[0] would be undefined and
                  .toUpperCase() a crash. Same '?' fallback as
                  MatchedPage/BidPage avatars. */}
              <span className="text-title font-bold text-[#1B4F72]" data-testid="profile-avatar-initial">
                {(user.nickname?.trim() || '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  autoFocus
                />
              ) : (
                <p className="text-heading font-semibold text-gray-900">{user.nickname}</p>
              )}
              <p className="text-secondary text-gray-500 capitalize">{user.role.toLowerCase()}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-title font-bold text-[#1B4F72]">{user.completedRides}</p>
              <p className="text-caption text-gray-500">{t('profile.ridesCompleted')}</p>
            </div>
            {isDriver && user.driverProfile && (
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                {driverRating === null ? (
                  <p
                    className="text-secondary text-gray-500"
                    data-testid="profile-rating-empty"
                  >
                    {t('driver.stats.noRatingsYet')}
                  </p>
                ) : (
                  <div className="flex items-center justify-center gap-1">
                    <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span
                      className="text-title font-bold text-[#1B4F72]"
                      data-testid="profile-rating-value"
                    >
                      {driverRating.toFixed(1)}
                    </span>
                  </div>
                )}
                <p className="text-caption text-gray-500">{t('profile.rating')}</p>
              </div>
            )}
          </div>

          {/* Verification status */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${user.idVerified ? 'bg-[#27AE60]' : 'bg-gray-300'}`} />
              <span className="text-secondary text-gray-600">
                {user.idVerified ? t('profile.idVerified') : t('profile.idNotVerified')}
              </span>
            </div>
            {isDriver && (
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${user.licenseVerified ? 'bg-[#27AE60]' : 'bg-gray-300'}`} />
                <span className="text-secondary text-gray-600">
                  {user.licenseVerified ? t('profile.licenseVerified') : t('profile.licenseNotVerified')}
                </span>
              </div>
            )}
          </div>

          {/* Edit / Save */}
          {isEditing ? (
            <div className="flex gap-2">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => {
                  setIsEditing(false);
                  setNickname(user.nickname);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                fullWidth
                loading={isSaving}
                onClick={handleSaveProfile}
              >
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <Button
              fullWidth
              variant="secondary"
              onClick={() => setIsEditing(true)}
            >
              {t('profile.editProfile')}
            </Button>
          )}
        </div>

        {/* PILOT-UX G2 — language is switchable from the Profile tab
            (present in the bottom nav for every role), not only during
            onboarding. The flag switcher reuses the WelcomePage
            component; the choice persists via ui-store prefs and is
            re-applied at boot by i18n init. */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4" data-testid="profile-language-card">
          <h2 className="text-body font-semibold text-gray-900 mb-3">
            {t('settings.language')}
          </h2>
          <LanguageSwitcher variant="compact" />
        </div>

        {/* MAP-CACHE G5 — opt-in offline Kigali map (download / progress /
            update / delete). */}
        <OfflineMapCard />

        {/* WIRE-FIX G4 — the admin island's only entry used to be the
            login redirect (wiring-report §1.5): an admin who navigated
            to /profile had no in-app way back to /admin short of
            re-login or typing the URL. This role-conditional card is
            the persistent way back; non-admins never see it. */}
        {user.role === 'ADMIN' && (
          <button
            onClick={() => navigate('/admin')}
            data-testid="profile-admin-link"
            className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            <span className="text-body font-semibold text-gray-900">
              {t('profile.adminDashboard')}
            </span>
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* FIELD-FIT G3 — "My documents". The second door to
            /driver/verification, alongside the dashboard banner, because
            Profile is on every role's nav and the dashboard is not
            always there to carry it: a REVOKED driver's dashboard is
            replaced by its terminal notice, and re-applying through this
            page is the only way back into the verification pipeline.
            Shown for every driver, verified or not — documents expire
            and get replaced. */}
        {isDriver && user.driverProfile && (
          <button
            onClick={() => navigate('/driver/verification')}
            data-testid="profile-documents-link"
            className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            <span className="text-body font-semibold text-gray-900">
              {t('verification.myDocuments')}
            </span>
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* MONEY-UX G4 — "Wallet": the name drivers look for, leading
            to the money screen that already exists (/driver/account —
            "Your money today", payout schedule, Pay me now). Naming
            and entry point only; no payout behaviour lives here. */}
        {isDriver && (
          <button
            onClick={() => navigate('/driver/account')}
            data-testid="profile-wallet-link"
            className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            <span className="text-body font-semibold text-gray-900">
              {t('wallet.title')}
            </span>
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* MONEY-UX G2 — payments entry for anyone who rides as a
            customer: what you paid, the current ride's payment state,
            and how payment works. */}
        {(user.role === 'CUSTOMER' || user.role === 'BOTH') && (
          <button
            onClick={() => navigate('/payments')}
            data-testid="profile-payments-link"
            className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            <span className="text-body font-semibold text-gray-900">
              {t('payments.title')}
            </span>
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* FIELD-CLOSE G3 — user guide entry. */}
        <button
          onClick={() => navigate('/guide')}
          data-testid="profile-guide-link"
          className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
        >
          <span className="text-body font-semibold text-gray-900">
            {t('guide.title')}
          </span>
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Settings entry — /settings was routed but unreachable
            (nothing in the app navigated to it). */}
        <button
          onClick={() => navigate('/settings')}
          data-testid="profile-settings-link"
          className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
        >
          <span className="text-body font-semibold text-gray-900">
            {t('settings.title')}
          </span>
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* MATCH-CLOSE G4 — diagnostics entry. Two taps from the bottom
            nav (Profile → Diagnostics) so a field report can carry a
            screenshot instead of a guess. */}
        <button
          onClick={() => navigate('/diagnostics')}
          data-testid="profile-diagnostics-link"
          className="w-full mb-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
        >
          <span className="text-body font-semibold text-gray-900">
            {t('diagnostics.open')}
          </span>
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Emergency Contacts */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-body font-semibold text-gray-900">
              {t('profile.emergencyContacts')}
            </h2>
            {contacts.length < MAX_EMERGENCY_CONTACTS && (
              <button
                onClick={() => setContactModalOpen(true)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#1B4F72]"
                aria-label={t('profile.addContact')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
          </div>

          {contacts.length === 0 ? (
            <p className="text-secondary text-gray-500 py-2">{t('profile.noContacts')}</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-secondary text-gray-700">{contact}</span>
                  <button
                    onClick={() => handleRemoveContact(i)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-600 hover:text-[#E74C3C]"
                    aria-label={t('profile.removeContact')}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logout (AUTH-UX G3) */}
        <button
          onClick={() => setLogoutModalOpen(true)}
          data-testid="profile-logout-button"
          className="w-full mt-4 bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors min-h-[44px]"
        >
          <span className="text-body font-semibold text-[#E74C3C]">
            {t('settings.logout')}
          </span>
          <svg className="w-5 h-5 text-[#E74C3C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>

        {/* Logout Confirm Modal */}
        <Modal
          isOpen={logoutModalOpen}
          onClose={() => setLogoutModalOpen(false)}
          title={t('settings.logout')}
        >
          <div className="space-y-4">
            <p className="text-secondary text-gray-700">{t('settings.logout_confirm')}</p>
            <div className="flex gap-2">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => setLogoutModalOpen(false)}
                disabled={isLoggingOut}
              >
                {t('common.cancel')}
              </Button>
              <Button
                fullWidth
                variant="danger"
                loading={isLoggingOut}
                onClick={handleLogout}
              >
                {t('settings.logout')}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Add Contact Modal */}
        <Modal
          isOpen={contactModalOpen}
          onClose={() => {
            setContactModalOpen(false);
            setNewContact('');
          }}
          title={t('profile.addContact')}
        >
          <div className="space-y-4">
            <Input
              label={t('profile.contactPhone')}
              type="tel"
              placeholder={t('profile.contactPhonePlaceholder')}
              value={newContact}
              onChange={(e) => {
                setNewContact(e.target.value);
                if (contactError) setContactError(null);
              }}
              error={contactError ?? undefined}
              autoFocus
            />
            <Button
              fullWidth
              loading={isAddingContact}
              onClick={handleAddContact}
              disabled={!newContact.trim()}
            >
              {t('profile.addContactButton')}
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default ProfilePage;
