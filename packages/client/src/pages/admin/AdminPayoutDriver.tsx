import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

const FREEZE_CATEGORIES = [
  'AML_CRITICAL',
  'FRAUD_SUSPECTED',
  'SAFETY_CONCERN',
  'KYC_PENDING',
  'REGULATORY_REQUEST',
  'ADMIN_DISCRETION',
] as const;

interface DriverMoney {
  driver: { id: string; nickname: string; phone: string; role: string };
  pendingAmount: number;
  storedPreference: string;
  effectivePreference: string;
  trainingWheelsActive: boolean;
  freeze: {
    frozenAt: string | null;
    frozenReason: string | null;
    frozenBy: string | null;
    frozenCategory: string | null;
  };
  batches: {
    id: string;
    amount: number;
    status: string;
    trigger: string;
    failureReason: string | null;
    createdAt: string;
    paidOutAt: string | null;
    held: boolean;
    heldReason: string | null;
  }[];
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  SUCCESS: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

// LAUNCH-TRUTH G2 — fee-waiver panel types. Counters come from the
// server (caps enforced there, never here); the panel only displays.
interface FeeWaiverRow {
  id: string;
  driverId: string;
  type: 'LIFETIME' | 'TEMPORARY';
  campaign: string;
  grantedAt: string;
  expiresAt: string | null;
  extensionCount: number;
  revokedAt: string | null;
  reason: string;
}

interface WaiverData {
  waivers: FeeWaiverRow[];
  counters: {
    lifetimeUsed: number;
    lifetimeMax: number;
    temporaryUsed: number;
    temporaryMax: number;
  };
}

function isWaiverActive(w: FeeWaiverRow): boolean {
  if (w.revokedAt) return false;
  return w.expiresAt === null || new Date(w.expiresAt).getTime() > Date.now();
}

export default function AdminPayoutDriver() {
  const { driverId } = useParams<{ driverId: string }>();
  const [data, setData] = useState<DriverMoney | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action form state
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<string>(FREEZE_CATEGORIES[0]);
  const [releasePayouts, setReleasePayouts] = useState(false);
  const [confirming, setConfirming] = useState<'freeze' | 'unfreeze' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // DRIVER-ID v3 — revoke action (separate reason so the audit trail
  // never inherits a half-typed freeze reason).
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeConfirming, setRevokeConfirming] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeOutcome, setRevokeOutcome] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // LAUNCH-TRUTH G2 — fee-waiver panel state (own reason fields, same
  // audit-trail hygiene as freeze/revoke).
  const [waiverData, setWaiverData] = useState<WaiverData | null>(null);
  const [waiverType, setWaiverType] = useState<'LIFETIME' | 'TEMPORARY'>('TEMPORARY');
  const [waiverCampaign, setWaiverCampaign] = useState('PILOT_500');
  const [waiverReason, setWaiverReason] = useState('');
  const [extendMonths, setExtendMonths] = useState(1);
  const [waiverConfirming, setWaiverConfirming] = useState<
    'grant' | 'extend' | 'revoke' | null
  >(null);
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);
  const [waiverOutcome, setWaiverOutcome] = useState<string | null>(null);
  const [waiverError, setWaiverError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/admin/payouts/driver/${driverId}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load driver (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [driverId]);

  const loadWaivers = useCallback(() => {
    apiFetch(`/api/admin/fee-waivers?driverId=${driverId}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load waivers (${res.status})`);
        return res.json();
      })
      .then(setWaiverData)
      .catch((err) => setWaiverError(err.message));
  }, [driverId]);

  useEffect(() => {
    load();
    loadWaivers();
  }, [load, loadWaivers]);

  const performWaiverAction = async (action: 'grant' | 'extend' | 'revoke') => {
    setWaiverSubmitting(true);
    setWaiverError(null);
    setWaiverOutcome(null);
    try {
      const activeWaiver = waiverData?.waivers.find(isWaiverActive);
      // DEADWOOD G3 — three endpoints, spelled out at three call sites.
      // The path used to be assembled into a `url` variable, which left
      // the wiring audit (scripts/wiring-audit) unable to read any of
      // them: one UNRESOLVED entry standing for three real wires. Note
      // that `${action}` could not simply be interpolated instead —
      // that reads as a :param segment and would match no endpoint.
      // They go through apiFetch now, like every other call on this
      // screen: assembling the URL by hand was also the only thing
      // keeping three admin-authenticated writes outside the
      // AUTH-REFRESH G4 gate (__tests__/raw-fetch-guard.test.ts). Same
      // URLs, same method, same bodies; they gain the Authorization
      // header and refresh-and-retry on 401.
      const init = (body: Record<string, unknown>): RequestInit => ({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let res: Response;
      if (action === 'grant') {
        res = await apiFetch(
          `/api/admin/fee-waivers/driver/${driverId}/grant`,
          init({
            type: waiverType,
            campaign: waiverCampaign.trim(),
            reason: waiverReason.trim(),
          }),
        );
      } else if (!activeWaiver) {
        throw new Error('No active waiver');
      } else if (action === 'extend') {
        res = await apiFetch(
          `/api/admin/fee-waivers/${activeWaiver.id}/extend`,
          init({ months: extendMonths, reason: waiverReason.trim() }),
        );
      } else {
        res = await apiFetch(
          `/api/admin/fee-waivers/${activeWaiver.id}/revoke`,
          init({ reason: waiverReason.trim() }),
        );
      }
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.code ?? `Request failed (${res.status})`);
      }
      if (action === 'grant') {
        setWaiverOutcome(
          payload.waiver.expiresAt
            ? `Waiver granted — no commission until ${new Date(payload.waiver.expiresAt).toLocaleDateString()}.`
            : 'Lifetime waiver granted — no commission, ever.',
        );
      } else if (action === 'extend') {
        setWaiverOutcome(
          `Waiver extended — now expires ${new Date(payload.waiver.expiresAt).toLocaleDateString()}.`,
        );
      } else {
        setWaiverOutcome(
          'Waiver revoked (forward-only — rides already waived stay waived).',
        );
      }
      setWaiverReason('');
      loadWaivers();
    } catch (err: any) {
      setWaiverError(err.message);
    } finally {
      setWaiverSubmitting(false);
      setWaiverConfirming(null);
    }
  };

  const performAction = async (action: 'freeze' | 'unfreeze') => {
    setSubmitting(true);
    setActionError(null);
    setOutcome(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (action === 'freeze') body.category = category;
      if (action === 'unfreeze') body.releasePayouts = releasePayouts;
      const res = await apiFetch(`/api/admin/freeze/${driverId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.code ?? `Request failed (${res.status})`);
      }
      if (action === 'freeze') {
        setOutcome(
          `Driver frozen — ${payload.heldBatchCount} pending batch(es) held.`,
        );
      } else {
        setOutcome(
          `Driver unfrozen — ${payload.releasedBatchCount} held batch(es) released.`,
        );
      }
      setReason('');
      setReleasePayouts(false);
      load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
      setConfirming(null);
    }
  };

  const performRevoke = async () => {
    setRevokeSubmitting(true);
    setRevokeError(null);
    setRevokeOutcome(null);
    try {
      const res = await apiFetch(
        `/api/admin/verifications/${driverId}/revoke`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: revokeReason.trim() }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.code ?? `Request failed (${res.status})`);
      }
      const settled = payload.settlement?.deferredForFreeze
        ? 'settlement deferred (account frozen — runs after unfreeze)'
        : payload.settlement?.batchId
          ? `${payload.settlement.amount.toLocaleString()} RWF settlement fired`
          : 'no balance to settle';
      setRevokeOutcome(
        `Driver revoked — ${payload.withdrawnBidCount} open bid(s) withdrawn, ${settled}.`,
      );
      setRevokeReason('');
      load();
    } catch (err: any) {
      setRevokeError(err.message);
    } finally {
      setRevokeSubmitting(false);
      setRevokeConfirming(false);
    }
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (error || !data) {
    return (
      <div className="p-4">
        <div className="text-red-600">{error ?? 'Driver not found'}</div>
        <Link to="/admin/payouts" className="text-blue-600 hover:underline">
          Back to payouts
        </Link>
      </div>
    );
  }

  const frozen = data.freeze.frozenAt !== null;
  const reasonTooShort = reason.trim().length < 10;

  return (
    <div className="p-4">
      <Link to="/admin/payouts" className="text-blue-600 hover:underline text-sm">
        ← Back to payouts
      </Link>
      <h1 className="text-2xl font-bold mb-1 mt-2">{data.driver.nickname}</h1>
      <div className="text-gray-500 mb-4">
        {data.driver.phone} · {data.driver.role}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Pending balance (RWF)</div>
          <div className="text-2xl font-bold">
            {data.pendingAmount.toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Payout preference</div>
          <div className="font-semibold">Effective: {data.effectivePreference}</div>
          <div className="text-sm text-gray-500">
            Stored: {data.storedPreference}
            {data.trainingWheelsActive && ' (training wheels active)'}
          </div>
        </div>
        <div
          data-testid="freeze-state"
          className={`rounded-lg shadow p-4 ${
            frozen ? 'bg-red-50 border border-red-300' : 'bg-white'
          }`}
        >
          <div className="text-sm text-gray-500">Account state</div>
          {frozen ? (
            <>
              <div className="font-semibold text-red-700">
                Frozen ({data.freeze.frozenCategory})
              </div>
              <div className="text-sm">{data.freeze.frozenReason}</div>
              <div className="text-xs text-gray-500">
                Since {new Date(data.freeze.frozenAt!).toLocaleString()}
                {data.freeze.frozenBy && ` · by ${data.freeze.frozenBy}`}
              </div>
            </>
          ) : (
            <div className="font-semibold text-green-700">Active</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-3">
          {frozen ? 'Unfreeze driver' : 'Freeze driver'}
        </h2>
        {outcome && (
          <div className="mb-3 p-2 bg-green-50 border border-green-300 rounded text-sm">
            {outcome}
          </div>
        )}
        {actionError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded text-sm">
            {actionError}
          </div>
        )}
        <div className="space-y-3">
          {!frozen && (
            <label className="block">
              <span className="text-sm text-gray-500 block">Category</span>
              <select
                aria-label="Freeze category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="border rounded p-2"
              >
                {FREEZE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-sm text-gray-500 block">
              Reason (min 10 characters, recorded in the audit trail)
            </span>
            <textarea
              aria-label="Action reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border rounded p-2 w-full"
              rows={2}
            />
          </label>
          {frozen && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Release held payouts"
                checked={releasePayouts}
                onChange={(e) => setReleasePayouts(e.target.checked)}
              />
              <span className="text-sm">
                Release held payout batches back into the payout path
              </span>
            </label>
          )}

          {confirming ? (
            <div
              data-testid="confirm-box"
              className="p-3 bg-yellow-50 border border-yellow-300 rounded"
            >
              <div className="text-sm mb-2">
                {confirming === 'freeze'
                  ? `Freeze ${data.driver.nickname} (${category})? Pending payout batches will be held.`
                  : `Unfreeze ${data.driver.nickname}? ${
                      releasePayouts
                        ? 'Held batches WILL be released.'
                        : 'Held batches will stay held.'
                    }`}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => performAction(confirming)}
                  disabled={submitting}
                  className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
                >
                  Confirm {confirming}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={submitting}
                  className="px-4 py-2 border rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(frozen ? 'unfreeze' : 'freeze')}
              disabled={reasonTooShort}
              className={`px-4 py-2 rounded text-white disabled:opacity-50 ${
                frozen ? 'bg-green-600' : 'bg-red-600'
              }`}
            >
              {frozen ? 'Unfreeze driver…' : 'Freeze driver…'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-3">Revoke driver identity</h2>
        <p className="text-sm text-gray-500 mb-3">
          The number stops validating immediately, open bids are withdrawn, and any remaining
          earnings are paid out through the normal payout path (deferred until unfreeze if the
          account is frozen). Records are kept; nothing is deleted. A revoked driver returns
          only by re-applying through verification.
        </p>
        {revokeOutcome && (
          <div className="mb-3 p-2 bg-green-50 border border-green-300 rounded text-sm">
            {revokeOutcome}
          </div>
        )}
        {revokeError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded text-sm">
            {revokeError}
          </div>
        )}
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-gray-500 block">
              Reason (min 10 characters, recorded in the audit trail)
            </span>
            <textarea
              aria-label="Revocation reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="border rounded p-2 w-full"
              rows={2}
            />
          </label>
          {revokeConfirming ? (
            <div
              data-testid="revoke-confirm-box"
              className="p-3 bg-yellow-50 border border-yellow-300 rounded"
            >
              <div className="text-sm mb-2">
                Revoke {data.driver.nickname}? This ends their driver account; remaining
                earnings are settled honestly, never confiscated.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={performRevoke}
                  disabled={revokeSubmitting}
                  className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
                >
                  Confirm revoke
                </button>
                <button
                  onClick={() => setRevokeConfirming(false)}
                  disabled={revokeSubmitting}
                  className="px-4 py-2 border rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setRevokeConfirming(true)}
              disabled={revokeReason.trim().length < 10}
              className="px-4 py-2 rounded text-white bg-red-700 disabled:opacity-50"
            >
              Revoke driver…
            </button>
          )}
        </div>
      </div>

      {/* LAUNCH-TRUTH G2 — pilot fee-waiver panel. Grant/extend/revoke
          behind the same reason + confirm discipline as freeze/revoke;
          the campaign counters are displayed so the caps are visible
          BEFORE granting (they are enforced server-side). */}
      <div className="bg-white rounded-lg shadow p-4 mb-6" data-testid="fee-waiver-panel">
        <h2 className="font-semibold mb-1">Pilot fee waiver</h2>
        {waiverData && (
          <div className="text-sm text-gray-500 mb-3" data-testid="fee-waiver-counters">
            Campaign grants used — Lifetime: {waiverData.counters.lifetimeUsed}/
            {waiverData.counters.lifetimeMax} · Temporary:{' '}
            {waiverData.counters.temporaryUsed}/{waiverData.counters.temporaryMax}
          </div>
        )}
        {waiverOutcome && (
          <div className="mb-3 p-2 bg-green-50 border border-green-300 rounded text-sm">
            {waiverOutcome}
          </div>
        )}
        {waiverError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded text-sm">
            {waiverError}
          </div>
        )}
        {(() => {
          const nonRevoked = waiverData?.waivers.find((w) => !w.revokedAt) ?? null;
          const active = nonRevoked && isWaiverActive(nonRevoked) ? nonRevoked : null;
          return (
            <div className="space-y-3">
              {nonRevoked ? (
                <div
                  data-testid="fee-waiver-current"
                  className={`p-3 rounded border ${
                    active
                      ? 'bg-green-50 border-green-300'
                      : 'bg-yellow-50 border-yellow-300'
                  }`}
                >
                  <div className="font-semibold">
                    {nonRevoked.type === 'LIFETIME'
                      ? 'Lifetime waiver — no commission, ever'
                      : active
                        ? `Temporary waiver — no commission until ${new Date(nonRevoked.expiresAt!).toLocaleDateString()}`
                        : `Temporary waiver EXPIRED ${new Date(nonRevoked.expiresAt!).toLocaleDateString()} (not yet revoked)`}
                  </div>
                  <div className="text-sm text-gray-500">
                    Campaign: {nonRevoked.campaign} · granted{' '}
                    {new Date(nonRevoked.grantedAt).toLocaleDateString()} · extensions:{' '}
                    {nonRevoked.extensionCount}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500" data-testid="fee-waiver-none">
                  No fee waiver — this driver pays the normal tier commission.
                </div>
              )}

              <label className="block">
                <span className="text-sm text-gray-500 block">
                  Reason (min 10 characters, recorded in the audit trail)
                </span>
                <textarea
                  aria-label="Waiver action reason"
                  value={waiverReason}
                  onChange={(e) => setWaiverReason(e.target.value)}
                  className="border rounded p-2 w-full"
                  rows={2}
                />
              </label>

              {!nonRevoked && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-sm text-gray-500 block">Type</span>
                    <select
                      aria-label="Waiver type"
                      value={waiverType}
                      onChange={(e) =>
                        setWaiverType(e.target.value as 'LIFETIME' | 'TEMPORARY')
                      }
                      className="border rounded p-2"
                    >
                      <option value="TEMPORARY">TEMPORARY (6 months)</option>
                      <option value="LIFETIME">LIFETIME (never expires)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm text-gray-500 block">Campaign</span>
                    <input
                      aria-label="Waiver campaign"
                      value={waiverCampaign}
                      onChange={(e) => setWaiverCampaign(e.target.value)}
                      className="border rounded p-2"
                    />
                  </label>
                </div>
              )}

              {nonRevoked?.type === 'TEMPORARY' && (
                <label className="block">
                  <span className="text-sm text-gray-500 block">
                    Extend by (months — max 12 months total from grant)
                  </span>
                  <input
                    type="number"
                    min={1}
                    aria-label="Extension months"
                    value={extendMonths}
                    onChange={(e) => setExtendMonths(parseInt(e.target.value, 10) || 1)}
                    className="border rounded p-2 w-24"
                  />
                </label>
              )}

              {waiverConfirming ? (
                <div
                  data-testid="waiver-confirm-box"
                  className="p-3 bg-yellow-50 border border-yellow-300 rounded"
                >
                  <div className="text-sm mb-2">
                    {waiverConfirming === 'grant'
                      ? `Grant a ${waiverType} fee waiver (${waiverCampaign}) to ${data.driver.nickname}? Their rides and parcels will carry zero Bimoto commission ${
                          waiverType === 'LIFETIME' ? 'permanently' : 'for 6 months'
                        }.`
                      : waiverConfirming === 'extend'
                        ? `Extend ${data.driver.nickname}'s temporary waiver by ${extendMonths} month(s)?`
                        : `Revoke ${data.driver.nickname}'s waiver? Future rides charge normal commission; rides already waived stay waived.`}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => performWaiverAction(waiverConfirming)}
                      disabled={waiverSubmitting}
                      className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
                    >
                      Confirm {waiverConfirming}
                    </button>
                    <button
                      onClick={() => setWaiverConfirming(null)}
                      disabled={waiverSubmitting}
                      className="px-4 py-2 border rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {!nonRevoked && (
                    <button
                      onClick={() => setWaiverConfirming('grant')}
                      disabled={
                        waiverReason.trim().length < 10 || !waiverCampaign.trim()
                      }
                      className="px-4 py-2 rounded text-white bg-green-700 disabled:opacity-50"
                    >
                      Grant waiver…
                    </button>
                  )}
                  {nonRevoked?.type === 'TEMPORARY' && (
                    <button
                      onClick={() => setWaiverConfirming('extend')}
                      disabled={waiverReason.trim().length < 10}
                      className="px-4 py-2 rounded text-white bg-blue-600 disabled:opacity-50"
                    >
                      Extend waiver…
                    </button>
                  )}
                  {nonRevoked && (
                    <button
                      onClick={() => setWaiverConfirming('revoke')}
                      disabled={waiverReason.trim().length < 10}
                      className="px-4 py-2 rounded text-white bg-red-600 disabled:opacity-50"
                    >
                      Revoke waiver…
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <h2 className="font-semibold mb-2">Last {data.batches.length} payout batches</h2>
      {data.batches.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
          No payout batches yet for this driver.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white rounded-lg shadow text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="p-3">Created</th>
                <th className="p-3">Amount (RWF)</th>
                <th className="p-3">Status</th>
                <th className="p-3">Trigger</th>
                <th className="p-3">Held</th>
                <th className="p-3">Failure reason</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-b last:border-b-0">
                  <td className="p-3 whitespace-nowrap">
                    {new Date(b.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">{b.amount.toLocaleString()}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded ${STATUS_BADGE[b.status] ?? 'bg-gray-100'}`}
                    >
                      {b.status}
                    </span>
                    {b.status === 'FAILED' && b.paidOutAt && (
                      <span className="ml-1 text-xs text-red-700">(reversed)</span>
                    )}
                  </td>
                  <td className="p-3">{b.trigger}</td>
                  <td className="p-3">
                    {b.held ? (
                      <span title={b.heldReason ?? undefined}>Yes</span>
                    ) : (
                      'No'
                    )}
                  </td>
                  <td className="p-3 text-gray-500">{b.failureReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
