import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Wordmark } from '../../components/ui/Wordmark';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { storeRefreshToken } from '../../lib/secure-token-store';
import { apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { roleHomePath } from '../../lib/role-home';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// AUTH-UX G2 — client display of the server's known OTP lifetimes: codes
// expire 5 minutes after issue (the SMS says so), and resends sit behind
// a 60s client cooldown so the server's 3-per-10-min budget isn't burned
// by impatient re-taps. Neither constant changes any server behavior.
const OTP_VALIDITY_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setUser, setToken, setRegistrationPending } = useAuthStore();
  const { showToast } = useUIStore();

  const location = useLocation();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // AUTH-UX G2 — countdown state. `now` ticks once a second while the
  // OTP step is showing so both countdowns (expiry, resend cooldown)
  // re-render without per-render Date.now() reads scattered around.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendReadyAt, setResendReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // PILOT-UX G1 — the field holds ONLY the 9 local subscriber digits;
  // the single visible +250 is the static prefix box. A typed or pasted
  // +250 / 250 / leading 0 is stripped so the prefix never doubles.
  const SUBSCRIBER_DIGITS = 9;

  // AUTH-UX G4 — the OTP step is a real history entry (router state
  // pushed on a successful send), so BACK — browser and Android hardware
  // back alike, via the webview's default history handling — returns to
  // the phone-entry step instead of exiting the app. The phone-length
  // guard drops the flag after a reload (component state is gone then,
  // so the OTP step would render around an empty phone number).
  const hasOtpHistoryState = Boolean(
    (location.state as { otpStep?: boolean } | null)?.otpStep,
  );
  const otpSent = hasOtpHistoryState && phone.length === SUBSCRIBER_DIGITS;

  useEffect(() => {
    if (!otpSent) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [otpSent]);

  const isExpired = expiresAt !== null && now >= expiresAt;
  const resendWaitMs = resendReadyAt === null ? 0 : Math.max(0, resendReadyAt - now);

  const toLocalDigits = (value: string): string => {
    let digits = value.replace(/\D/g, '');
    // No Rwandan subscriber number starts with 2 or 0, so a leading
    // 250 / 0 can only be a country-code or trunk prefix — drop it.
    if (digits.startsWith('250')) {
      digits = digits.slice(3);
    } else if (digits.startsWith('0')) {
      digits = digits.slice(1);
    }
    return digits.slice(0, SUBSCRIBER_DIGITS);
  };

  const toFullPhone = (localDigits: string): string =>
    localDigits.length > 0 ? `+250${localDigits}` : '';

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(toLocalDigits(e.target.value));
  };

  const handleRequestOtp = useCallback(async () => {
    const formatted = toFullPhone(phone);
    if (!formatted || formatted.length < 13) {
      showToast(t('login.invalidPhone'), 'error');
      return;
    }

    setIsRequesting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formatted }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      // AUTH-UX G2 — every successful send (first or resend) restarts
      // both clocks and clears any half-typed previous code.
      const sentAt = Date.now();
      setExpiresAt(sentAt + OTP_VALIDITY_MS);
      setResendReadyAt(sentAt + RESEND_COOLDOWN_MS);
      setNow(sentAt);
      setOtp(['', '', '', '', '', '']);
      // G4 — push the OTP step onto history (first send only — a resend
      // is already on it and must not stack extra back entries).
      if (!otpSent) {
        navigate('/login', { state: { otpStep: true } });
      }
      showToast(t('login.otpSent'), 'success');
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      // NET-UX G2 — invalid OTP / rate-limit render the server's own
      // message keys (a resend into the 3-per-10-min limit surfaces the
      // server's errors.rate_limited copy); a dead network reads as
      // connection trouble, never raw "Failed to fetch".
      presentApiError(err);
    } finally {
      setIsRequesting(false);
    }
  }, [phone, otpSent, navigate, showToast, t]);

  const handleVerify = useCallback(async (code: string) => {
    // AUTH-UX G2 — the 5-minute validity is over: the input area already
    // shows the expired state, and a submit of the stale code would only
    // earn a generic server rejection — block it locally.
    if (expiresAt !== null && Date.now() >= expiresAt) return;
    const formatted = toFullPhone(phone);
    setIsVerifying(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: formatted, otp: code }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const data = await res.json();
      // PREPROTO-AUTH G6 — access token stays in memory (store), refresh
      // token goes to native secure storage (no-op on web, where the
      // httpOnly cookies carry the session).
      setToken(data.accessToken ?? null);
      if (data.refreshToken) {
        await storeRefreshToken(data.refreshToken);
      }
      // AUTH-UX G1 — isNewUser raises the durable registration flag
      // BEFORE navigating: RegisterRoute only renders while the flag is
      // up, and ProtectedRoute bounces every deep link back to /register
      // until RegisterPage completes. The flag is keyed by user id, so a
      // half-registered account whose session fully expired is walked
      // back to /register on re-login (the server now says
      // isNewUser=false — the row exists), while returning users (seeded
      // accounts included) go straight to their role's home.
      const stillPending =
        useAuthStore.getState().registrationPendingUserId === data.user?.id;
      setUser(data.user);
      if (data.isNewUser || stillPending) {
        setRegistrationPending(data.user?.id ?? null);
        navigate('/register', { replace: true });
      } else {
        navigate(roleHomePath(data.user?.role), { replace: true });
      }
    } catch (err) {
      presentApiError(err);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setIsVerifying(false);
    }
  }, [phone, expiresAt, setToken, setUser, setRegistrationPending, navigate, showToast, t]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit on 6th digit
    if (value && index === 5) {
      const code = newOtp.join('');
      if (code.length === 6) {
        handleVerify(code);
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;

    const newOtp = [...otp];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newOtp[i] = pasted[i];
    }
    setOtp(newOtp);

    if (pasted.length === 6) {
      handleVerify(pasted);
    } else {
      otpRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="mb-2">
            <Wordmark />
          </h1>
          {/* LOGIN-EASE (Jean, 24 Aug) — the welcome says what Bimoto
              IS, and it STAYS. Deliberately a plain <p> outside the
              otpSent branch with no timer and no toast: it renders on
              every visit to this screen, before and after the code is
              sent. The first-launch WelcomeCarousel is a different
              surface and stays one-time by design. If this line ever
              needs to be timed or dismissed, that is a product
              decision, not a refactor. */}
          <p className="text-gray-600">{t('login.subtitle')}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          {!otpSent ? (
            <>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('login.phoneLabel')}
              </label>
              <div className="flex gap-2 mb-4">
                <span className="inline-flex items-center px-3 min-h-[44px] rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-600">
                  +250
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  placeholder={t('login.phonePlaceholder')}
                  value={phone}
                  onChange={handlePhoneChange}
                  className="flex-1"
                  aria-label={t('login.phoneLabel')}
                  autoFocus
                />
              </div>
              <Button
                fullWidth
                loading={isRequesting}
                onClick={handleRequestOtp}
                disabled={phone.replace(/\D/g, '').length < 9}
              >
                {t('login.sendCode')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4 text-center">
                {t('login.otpPrompt', { phone: toFullPhone(phone) })}
              </p>

              {isExpired ? (
                // AUTH-UX G2 — the code is dead; stop promising the
                // inputs will work and point at the one way forward.
                <div
                  className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-center"
                  role="status"
                >
                  <p className="text-sm text-amber-800">{t('login.codeExpired')}</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2 justify-center mb-3" onPaste={handleOtpPaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className="w-11 h-14 text-center text-xl font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
                        aria-label={t('login.otpDigit', { n: i + 1 })}
                      />
                    ))}
                  </div>

                  {expiresAt !== null && (
                    <p className="text-xs text-gray-500 text-center mb-4" role="timer">
                      {t('login.codeExpiresIn', { time: formatCountdown(expiresAt - now) })}
                    </p>
                  )}

                  {isVerifying ? (
                    <div className="flex justify-center py-3">
                      <Spinner size="md" />
                    </div>
                  ) : (
                    <Button
                      fullWidth
                      onClick={() => handleVerify(otp.join(''))}
                      disabled={otp.join('').length < 6}
                    >
                      {t('login.verify')}
                    </Button>
                  )}
                </>
              )}

              {/* AUTH-UX G2 — resend, behind a 60s client cooldown per
                  send. The server's own 3-per-10-min limit still applies;
                  its 429 renders errors.rate_limited via the presenter. */}
              <button
                onClick={handleRequestOtp}
                disabled={isRequesting || resendWaitMs > 0}
                className="mt-4 w-full text-center text-sm min-h-[44px] text-[#1B4F72] disabled:text-gray-400 enabled:hover:underline"
              >
                {resendWaitMs > 0
                  ? t('login.resendIn', { seconds: Math.ceil(resendWaitMs / 1000) })
                  : t('login.resendCode')}
              </button>

              <button
                onClick={() => {
                  // AUTH-UX G4 — "change phone" IS the back affordance:
                  // pop the OTP history entry (identical to hardware
                  // back) and wipe the code and both clocks, so a fresh
                  // send starts clean.
                  setOtp(['', '', '', '', '', '']);
                  setExpiresAt(null);
                  setResendReadyAt(null);
                  navigate(-1);
                }}
                className="mt-2 w-full text-center text-sm text-[#1B4F72] hover:underline min-h-[44px]"
              >
                {t('login.changePhone')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
