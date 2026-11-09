import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { performLogout } from '../../lib/logout';
import {
  VehicleType,
  getVehicleCompliance,
  isValidEmergencyContact,
  MAX_EMERGENCY_CONTACTS,
} from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
// CUTGUARD v2 G2 — "a field never loaded is never saved". See
// lib/loaded-field.ts for the defect this mechanism is for.
import { deriveSave, forDisplay, fieldFromResponse } from '../../lib/loaded-field';
import { useLoadedUserField } from '../../hooks/useLoadedUserField';
import { presentApiError } from '../../lib/api-error-presenter';
import { vehicleIcon } from '../../components/journey/vehicle-icons';
import { useDiagnosticsUpload, useNotificationSounds } from '../../hooks/usePreferences';
import { deliverDataExport } from '../../lib/data-export';
import { MoneyPinSettingsSection } from '../../components/money/MoneyPinSettingsSection';
import { AppLockSettingsSection } from '../../components/lock/AppLockSettingsSection';

/** Matches the Content-Disposition filename the endpoint already sets, so
 *  the file is named the same whichever runtime delivered it. */
const DATA_EXPORT_FILENAME = 'bimoto-data-export.json';

const LANGUAGES = [
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

// PILOT-UX G3 — the real VehicleType enum (the old local list carried
// CAR/BICYCLE/VAN, which the server's isVehicleType guard rejects, and
// omitted the electric types). Labels come from the compliance matrix.
const VEHICLE_TYPES = Object.values(VehicleType);
// PILOT-GUARD Item 8 — the local `const MAX_EMERGENCY_CONTACTS = 3`
// that stood here shadowed the shared one imported above, which is the
// value shared/schemas/user.schema.ts caps the server-side array at.

export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const { showToast, setLanguage } = useUIStore();

  // Emergency contacts.
  //
  // CUTGUARD v2 G2 — was `useState(user?.emergencyContacts || [])`. That
  // `|| []` spelled "she has none" and "this payload never carried the
  // field" the same way, and the save below replaces the WHOLE array, so
  // the second one silently erased the first. A rider who added one
  // contact after login PUT `[theNewOne]` over her real numbers and her
  // SOS fan-out went quiet.
  //
  // The field now carries whether it was loaded, `forDisplay` is the only
  // thing allowed a fallback, and `deriveSave` cannot build a replacement
  // out of a field that was never loaded.
  const {
    field: contactsField,
    setField: setContactsField,
    ensureLoaded: ensureContactsLoaded,
  } = useLoadedUserField<string[]>((u) =>
    // GAP-CLOSE G2's belt, kept and given its real meaning: a legacy
    // STRING is not a loaded ARRAY, so it reads as not-loaded rather
    // than being coerced into one.
    Array.isArray(u?.emergencyContacts) ? u.emergencyContacts : undefined,
  );
  const contacts = forDisplay(contactsField, [] as string[]);
  const [newContact, setNewContact] = useState('');
  // VALIDATE-MEND G2 — the inline answer. The server is the authority
  // (PUT /me now parses updateMeSchema), but a person typing "mama"
  // should be told so at the input, not by a toast after a round trip.
  // Both layers ask the SAME shared function, so they cannot disagree.
  const [contactError, setContactError] = useState<string | null>(null);
  const [isSavingContacts, setIsSavingContacts] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);

  // Vehicle info
  // The stored profile came from the server, so its vehicleType is a
  // valid enum value; the auth store types it as plain string.
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    (user?.driverProfile?.vehicleType as VehicleType) || VehicleType.MOTO,
  );
  // CUTGUARD v2 U-6 — the same mechanism, the same `|| ''`. Login never
  // carried `driverProfile` (G1 fixes that on the server), so these two
  // seeded empty and the vehicle save PUT `""` over a motari's real
  // plate and description — blocked only during an active journey or an
  // open bid, which is to say almost never.
  const {
    field: vehicleField,
    setField: setVehicleField,
    ensureLoaded: ensureVehicleLoaded,
  } = useLoadedUserField((u) => u?.driverProfile);
  const loadedVehicle = forDisplay(vehicleField, undefined);
  const [plate, setPlate] = useState(loadedVehicle?.registrationPlate || '');
  const [vehicleDesc, setVehicleDesc] = useState(loadedVehicle?.vehicleDescription || '');
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);

  const isDriver = user?.role === 'DRIVER' || user?.role === 'BOTH';

  // FLIGHT-RECORDER G2 — the off switch for the consented diagnostics
  // upload. The signup consent screen says this is on; this is where a
  // person who does not want it turns it off, and OFF means the batcher
  // makes no request at all (services/diagnostics-upload.ts). The Send
  // report button on Diagnostics is unaffected either way.
  const diagnosticsUpload = useDiagnosticsUpload();

  // ACCOUNT-RIGHTS-SURFACE G3 — one export at a time; re-taps are no-ops
  // (the NET-UX G3 idiom the contact-removal row already uses).
  const [exporting, setExporting] = useState(false);
  // NOTIFY G4 — the Bimoto sound, and the one place to turn it off.
  //
  // Default ON (Faustin, 24 Aug: a motari has to know something happened
  // without looking). OFF silences the chime and changes nothing else —
  // every toast still renders and still lasts its full ~15 seconds.
  const notificationSounds = useNotificationSounds();

  const handleChangeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setLanguage(langCode);
    showToast(t('settings.languageChanged'), 'success');
  };

  const handleAddContact = async () => {
    if (!newContact.trim()) return;
    if (contacts.length >= MAX_EMERGENCY_CONTACTS) {
      showToast(t('profile.maxContacts', { max: MAX_EMERGENCY_CONTACTS }), 'error');
      return;
    }
    if (!isValidEmergencyContact(newContact)) {
      setContactError(t('errors.invalidEmergencyContact'));
      return;
    }
    setContactError(null);

    // CUTGUARD v2 G2 — the invariant, at the save site. `deriveSave`
    // cannot build a replacement array out of a field that was never
    // loaded, so there is nothing to PUT; the screen fetches the field
    // and asks the person to try again rather than replacing two real
    // numbers with one.
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

    setIsSavingContacts(true);
    try {
      const res = await apiFetch(`/api/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ emergencyContacts: updatedContacts }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setUser(updated);
      // The response is a payload like any other, so it is read the same
      // way: a server that answered without the field leaves the screen
      // not-loaded rather than pretending the save proved something.
      setContactsField(fieldFromResponse(updated?.emergencyContacts ?? updatedContacts));
      setNewContact('');
      showToast(t('profile.contactAdded'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsSavingContacts(false);
    }
  };

  const handleRemoveContact = async (index: number) => {
    // NET-UX G3 — one removal at a time; re-taps are no-ops.
    if (removingIndex !== null) return;
    // CUTGUARD v2 G2 — a removal is a whole-array replace too, and a
    // removal computed from a list the screen never loaded is the same
    // clobber wearing a different button.
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
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ emergencyContacts: updatedContacts }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setUser(updated);
      setContactsField(fieldFromResponse(updated?.emergencyContacts ?? updatedContacts));
    } catch (err) {
      presentApiError(err);
    } finally {
      setRemovingIndex(null);
    }
  };

  const handleSaveVehicle = async () => {
    // CUTGUARD v2 U-6 — same invariant, the vehicle identity. A save
    // built on a driverProfile the screen never loaded sends `""` for the
    // plate and the description, which is how a motari's registration
    // disappeared. Refuse, fetch, and say so.
    if (!vehicleField.loaded) {
      const healed = await ensureVehicleLoaded();
      if (!healed.loaded) {
        showToast(t('errors.vehicleNotLoaded'), 'error');
        return;
      }
    }

    setIsSavingVehicle(true);
    try {
      const res = await apiFetch(`/api/users/me/driver-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          vehicleType,
          registrationPlate: plate.trim().toUpperCase(),
          vehicleDescription: vehicleDesc.trim(),
        }),
      });

      // NET-UX G2 — the taxonomy presenter renders the server's own
      // message key (incl. errors.vehicleChangeBlocked from the
      // DRIVER-ID v3 vehicle-change guard) instead of raw body text.
      if (!res.ok) throw await apiErrorFromResponse(res);

      const driverData = await res.json();
      if (user) {
        setUser({ ...user, driverProfile: driverData });
      }
      setVehicleField(fieldFromResponse(driverData));
      showToast(t('settings.vehicleSaved'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsSavingVehicle(false);
    }
  };

  const handleLogout = async () => {
    await performLogout();
    navigate('/login', { replace: true });
  };

  // ACCOUNT-RIGHTS-SURFACE G3 — the data export finally has a caller.
  //
  // Content is EXACTLY what the endpoint has always returned (profile,
  // driver profile, journeys, ratings, sent messages). Whether each table
  // should carry more is founder decision D20 and is not touched here; all
  // that changes is that a person can now get the file.
  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    showToast(t('deletion.exportPreparing'), 'info');
    try {
      const res = await apiFetch('/api/users/me/data-export', { credentials: 'include' });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const json = await res.text();
      const delivery = await deliverDataExport(json, DATA_EXPORT_FILENAME);
      showToast(
        t(
          delivery === 'downloaded'
            ? 'deletion.exportDownloaded'
            : delivery === 'shared'
              ? 'deletion.exportShared'
              : 'deletion.exportCopied',
        ),
        'success',
      );
    } catch (err) {
      // A REJECTED/AUTH/offline failure renders through the shared
      // presenter; a delivery failure (no route on this runtime at all)
      // is not an API error and needs its own honest line.
      if (err instanceof Error && err.message === 'no export delivery route available') {
        showToast(t('deletion.exportFailed'), 'error');
      } else {
        presentApiError(err);
      }
    } finally {
      setExporting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto space-y-6">
        <h1 className="text-xl font-bold text-[#1B4F72]">
          {t('settings.title')}
        </h1>

        {/* Language Selection */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            {t('settings.language')}
          </h2>
          <div className="flex gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleChangeLanguage(lang.code)}
                className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  i18n.language === lang.code
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
                aria-pressed={i18n.language === lang.code}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Emergency Contacts */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            {t('settings.emergencyContacts')}
          </h2>

          {contacts.length > 0 && (
            <div className="space-y-2 mb-3">
              {contacts.map((contact, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700">{contact}</span>
                  <button
                    onClick={() => handleRemoveContact(i)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-600 hover:text-[#E74C3C]"
                    aria-label={t('settings.removeContact')}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {contacts.length < MAX_EMERGENCY_CONTACTS && (
            <div className="flex gap-2">
              <Input
                placeholder={t('settings.contactPlaceholder')}
                type="tel"
                value={newContact}
                onChange={(e) => {
                  setNewContact(e.target.value);
                  if (contactError) setContactError(null);
                }}
                error={contactError ?? undefined}
                helperText={t('settings.contactFormatHint')}
                className="flex-1"
              />
              <Button
                size="sm"
                loading={isSavingContacts}
                onClick={handleAddContact}
                disabled={!newContact.trim()}
              >
                {t('settings.add')}
              </Button>
            </div>
          )}
        </div>

        {/* MONEY-PIN G3 — driver-only, and only once a PIN exists. A
            driver who has not enrolled is NOT nagged here; he meets the
            PIN at his first money screen, once. */}
        {isDriver && <MoneyPinSettingsSection />}

        {/* APP-LOCK G4 — offered to EVERYONE, default off. Drivers get
            one dismissible recommending line inside the section; nobody
            is opted in and nobody is nagged. */}
        <AppLockSettingsSection isDriver={isDriver} />

        {/* Diagnostics upload consent */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {t('settings.diagnosticsUpload')}
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            {t('settings.diagnosticsUploadHelp')}
          </p>
          <div className="flex gap-2">
            {[
              { on: true, label: t('common.on'), testid: 'settings-diagnostics-on' },
              { on: false, label: t('common.off'), testid: 'settings-diagnostics-off' },
            ].map((opt) => (
              <button
                key={opt.testid}
                type="button"
                data-testid={opt.testid}
                disabled={diagnosticsUpload.loading}
                onClick={() => void diagnosticsUpload.setEnabled(opt.on)}
                className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  diagnosticsUpload.enabled === opt.on
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
                aria-pressed={diagnosticsUpload.enabled === opt.on}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* MAP-REACH G4 — Maps & offline.
            Placed HERE, immediately after the diagnostics card and well
            above the account-rights section at the bottom: this is an
            ordinary setting a rider is meant to find, not a right
            deliberately made hard to reach. The card itself lives on its
            own route because it is five rows tall. */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {t('settings.mapsOffline')}
          </h2>
          <p className="text-sm text-gray-600 mb-2">
            {t('settings.mapsOfflineHelp')}
          </p>
          <button
            type="button"
            data-testid="settings-maps-offline"
            onClick={() => navigate('/settings/maps')}
            className="flex w-full min-h-[44px] items-center justify-between rounded-lg px-1 text-left text-sm text-gray-800 hover:bg-gray-50"
          >
            <span>{t('settings.mapsOfflineOpen')}</span>
            <span aria-hidden className="text-gray-500">›</span>
          </button>
        </div>

        {/* NOTIFY G4 — notification sounds */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {t('settings.notificationSounds')}
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            {t('settings.notificationSoundsHelp')}
          </p>
          <div className="flex gap-2">
            {[
              { on: true, label: t('common.on'), testid: 'settings-sounds-on' },
              { on: false, label: t('common.off'), testid: 'settings-sounds-off' },
            ].map((opt) => (
              <button
                key={opt.testid}
                type="button"
                data-testid={opt.testid}
                disabled={notificationSounds.loading}
                onClick={() => void notificationSounds.setEnabled(opt.on)}
                className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  notificationSounds.enabled === opt.on
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
                aria-pressed={notificationSounds.enabled === opt.on}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Vehicle Info (if driver) */}
        {isDriver && (
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              {t('settings.vehicleInfo')}
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('register.vehicleType')}
              </label>
              <div className="flex flex-wrap gap-2">
                {VEHICLE_TYPES.map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    data-testid={`settings-vehicle-${vt}`}
                    onClick={() => setVehicleType(vt)}
                    className={`min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 ${
                      vehicleType === vt
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                    aria-pressed={vehicleType === vt}
                  >
                    {vehicleIcon(vt, 'w-5 h-5')}
                    {t(getVehicleCompliance(vt).nameKey)}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label={t('register.plate')}
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder={t('register.platePlaceholder')}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('register.vehicleDescription')}
              </label>
              <textarea
                value={vehicleDesc}
                onChange={(e) => setVehicleDesc(e.target.value)}
                placeholder={t('register.vehicleDescriptionPlaceholder')}
                rows={2}
                className="block w-full min-h-[44px] px-3 py-2.5 rounded-lg border border-gray-300 text-base bg-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
              />
            </div>

            <Button
              fullWidth
              loading={isSavingVehicle}
              onClick={handleSaveVehicle}
            >
              {t('settings.saveVehicle')}
            </Button>
          </div>
        )}

        {/* Logout */}
        <Button
          fullWidth
          variant="danger"
          onClick={handleLogout}
        >
          {t('settings.logout')}
        </Button>

        {/* ACCOUNT-RIGHTS-SURFACE G2/G3 — the account-rights section, and
            it sits HERE, below the logout button, at the very bottom of
            the last screen in the app that has one.

            That placement is the founder ruling, not an accident of
            layout: deletion is meant to be hard to find and impossible to
            reach by mistake. There is no link to it from home, none in the
            nav, and none from the profile screen — Settings is the only
            door, and this is the bottom of it.

            `account.deleteAccount` has existed, translated into all three
            languages, since long before there was anywhere to render it.
            This is that anywhere. */}
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-1">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {t('settings.title')}
          </h2>

          {/* Export first, deletion last: the reversible right goes above
              the irreversible one. */}
          <button
            type="button"
            data-testid="settings-export-data"
            disabled={exporting}
            onClick={() => void handleExportData()}
            className="flex w-full min-h-[44px] items-center justify-between rounded-lg px-1 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            <span>{t('account.exportData')}</span>
            <span aria-hidden className="text-gray-500">›</span>
          </button>

          <button
            type="button"
            data-testid="settings-delete-account"
            onClick={() => navigate('/settings/delete-account')}
            className="flex w-full min-h-[44px] items-center justify-between rounded-lg px-1 text-left text-sm text-[#7B241C] hover:bg-gray-50"
          >
            <span>{t('account.deleteAccount')}</span>
            <span aria-hidden className="text-[#7B241C]/50">›</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
