import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { VehicleType, getVehicleCompliance } from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { roleHomePath } from '../../lib/role-home';
import { performLogout } from '../../lib/logout';
import { vehicleIcon } from '../../components/journey/vehicle-icons';

type RoleOption = 'CUSTOMER' | 'DRIVER' | 'BOTH';

// FIELD-BATCH G1 — the role glyphs were inverted: the customer carried
// a motorcycle and the driver carried a car. Bimoto is a moto-taxi
// service, so the motari gets the motorcycle and the customer gets a
// person hailing a ride rather than a vehicle at all.
//
// Glyphs are deliberately old so they render on the mixed Android
// hardware in Kigali:
//   🏍️ U+1F3CD Unicode 7.0 — already shipped on the register screen and
//      confirmed rendering in the field, just on the wrong option.
//   🙋 U+1F64B Unicode 6.0 — in every Android emoji font since 4.4;
//      a person putting a hand up reads as hailing a ride.
//   ↔️ U+2194 Unicode 1.1/Emoji 0.6 — the oldest of the three, already
//      shipping, and still reads as "both ways"; swapping it would add
//      font risk for no gain.
// Exported so the pairing is assertable and cannot silently invert.
export const ROLE_ICONS: Record<RoleOption, string> = {
  CUSTOMER: '🙋',
  DRIVER: '🏍️',
  BOTH: '↔️',
};

// BIKE-GATE — the real VehicleType enum (the old local list carried
// CAR/BICYCLE/VAN, which the server rejects). Labels and the
// plate-required rule come from the shared compliance matrix.
const VEHICLE_TYPES = Object.values(VehicleType);

export const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser, setRegistrationPending } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);
  // COCKPIT G5 — the switcher below owns the choice and has already
  // applied it (i18n + the persisted preference). This page only reads
  // it, so the profile PUT carries what the person is actually looking
  // at rather than a second copy of the same state.
  const language = useUIStore((s) => s.language);

  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<RoleOption | ''>('');
  const [vehicleType, setVehicleType] = useState<string>(VehicleType.MOTO);
  const [plate, setPlate] = useState('');
  const [vehicleDescription, setVehicleDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDriver = role === 'DRIVER' || role === 'BOTH';
  const compliance = getVehicleCompliance(vehicleType);

  const handleSubmit = async () => {
    if (!nickname.trim()) {
      showToast(t('register.nicknameRequired'), 'error');
      return;
    }
    if (!role) {
      showToast(t('register.roleRequired'), 'error');
      return;
    }
    if (isDriver && compliance.registrationRequired && !plate.trim()) {
      showToast(t('register.plateRequired'), 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // Update user profile
      const profileRes = await apiFetch(`/api/users/me`, {
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          nickname: nickname.trim(),
          role,
          language,
        }),
      });

      if (!profileRes.ok) throw await apiErrorFromResponse(profileRes);

      const updatedUser = await profileRes.json();

      // Create driver profile if needed
      if (isDriver) {
        const driverRes = await apiFetch(`/api/users/me/driver-profile`, {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            vehicleType,
            registrationPlate:
              compliance.registrationRequired && plate.trim()
                ? plate.trim().toUpperCase()
                : undefined,
            vehicleDescription: vehicleDescription.trim(),
          }),
        });

        if (!driverRes.ok) throw await apiErrorFromResponse(driverRes);

        const driverData = await driverRes.json();
        updatedUser.driverProfile = driverData;
      }

      setUser(updatedUser);
      // (The language was already applied and persisted when it was
      // picked — LanguageSwitcher does both — so there is nothing to
      // re-set here.)
      // AUTH-UX G1 — registration is complete: drop the guard flag, then
      // head for the chosen role's home. ProtectedRoute still detours
      // through /consent first (a brand-new account has no consent yet).
      setRegistrationPending(null);
      showToast(t('register.success'), 'success');
      navigate(roleHomePath(updatedUser?.role ?? role), { replace: true });
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // LIVE-WIRE G5 — the field's item 4: registration has no back button.
  //
  // #150 built BackControl app-wide, but it is mounted by the shell's
  // header, which only AppShell mounts — and /register, like /login and
  // /consent, is a bare route outside the shell (App.tsx). So this
  // screen genuinely had no way out.
  //
  // History-back is the wrong behaviour here and BackControl is
  // therefore not what is mounted: registration is reached by a guard
  // redirect from a *completed OTP*, so "back" would land on a login
  // screen this account has already passed and the guard would bounce
  // straight here again. What the person actually wants at this point —
  // wrong number typed, or a change of mind — is to abandon the
  // half-finished sign-up and start again with a different number, so
  // that is what this does, and what it says.
  const handleUseDifferentNumber = async () => {
    await performLogout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <button
          type="button"
          data-testid="register-back"
          onClick={handleUseDifferentNumber}
          className="-ml-1 mb-3 inline-flex items-center gap-1.5 min-h-[44px] px-2 text-sm font-medium text-[#1B4F72] hover:text-[#164060] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('register.useDifferentNumber')}
        </button>
        <h1 className="text-2xl font-bold text-[#1B4F72] mb-1">
          {t('register.title')}
        </h1>
        <p className="text-gray-600 text-sm mb-6">
          {t('register.subtitle')}
        </p>

        <div className="space-y-6">
          {/* Nickname */}
          <Input
            label={t('register.nickname')}
            placeholder={t('register.nicknamePlaceholder')}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus
          />

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('register.roleLabel')}
            </label>
            <div className="space-y-3">
              {([
                { value: 'CUSTOMER' as RoleOption, label: t('register.roleCustomer'), icon: ROLE_ICONS.CUSTOMER },
                { value: 'DRIVER' as RoleOption, label: t('register.roleDriver'), icon: ROLE_ICONS.DRIVER },
                { value: 'BOTH' as RoleOption, label: t('register.roleBoth'), icon: ROLE_ICONS.BOTH },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`register-role-${option.value}`}
                  onClick={() => setRole(option.value)}
                  className={`w-full min-h-[64px] px-4 py-3 rounded-xl border-2 text-left flex items-center gap-3 transition-colors ${
                    role === option.value
                      ? 'border-[#1B4F72] bg-[#1B4F72]/5'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                  aria-pressed={role === option.value}
                >
                  <span className="text-2xl" aria-hidden="true">{option.icon}</span>
                  <span className={`text-base font-medium ${
                    role === option.value ? 'text-[#1B4F72]' : 'text-gray-700'
                  }`}>
                    {option.label}
                  </span>
                  {role === option.value && (
                    <svg className="w-5 h-5 text-[#1B4F72] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* COCKPIT G5 — the shared switcher, not a third hardcoded copy
              of the language list. This page kept its own two-button
              picker (later three) with its own styling and its own
              state, so the door was the one place in the app where the
              language list could drift from the one WelcomePage and
              Settings offer. The 'welcome' variant is the one that fits:
              full language names in flex-1 pills, which is what this
              form field already looked like.

              One behaviour changes, deliberately: the switcher applies
              the choice IMMEDIATELY, so tapping Français translates the
              registration form under your finger instead of waiting for
              a successful submit. That is the point of a language picker
              at the door — someone who cannot read the default must be
              able to read the form they are filling in. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('register.language')}
            </label>
            <LanguageSwitcher variant="welcome" />
          </div>

          {/* Vehicle Form (if driver) */}
          {isDriver && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">
                {t('register.vehicleInfo')}
              </h2>

              {/* Vehicle Type Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('register.vehicleType')}
                </label>
                {/* FIELD-FIT G4 — the motari picks his machine by its
                    picture, not only its name. Same glyphs the passenger
                    side uses (components/journey/vehicle-icons). */}
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_TYPES.map((vt) => (
                    <button
                      key={vt}
                      type="button"
                      data-testid={`register-vehicle-${vt}`}
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

              {compliance.registrationHintKey && (
                <p className="text-sm text-gray-600 bg-blue-50 rounded-lg p-3">
                  {t(compliance.registrationHintKey)}
                </p>
              )}

              {compliance.registrationRequired && (
                <Input
                  label={t('register.plate')}
                  placeholder={t('register.platePlaceholder')}
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                />
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('register.vehicleDescription')}
                </label>
                <textarea
                  value={vehicleDescription}
                  onChange={(e) => setVehicleDescription(e.target.value)}
                  placeholder={t('register.vehicleDescriptionPlaceholder')}
                  rows={2}
                  className="block w-full min-h-[44px] px-3 py-2.5 rounded-lg border border-gray-300 text-base bg-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <Button
            fullWidth
            size="lg"
            loading={isSubmitting}
            onClick={handleSubmit}
            disabled={!nickname.trim() || !role}
          >
            {t('register.createAccount')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
