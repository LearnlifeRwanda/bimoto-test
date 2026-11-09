// PAY-TRUTH G4 — a card checkout a human can drive without real money.
//
// The card rail has never been used by anybody. PREPROTO-SIM G4 hid the
// card option in simulated mode because the Flutterwave Inline widget
// cannot be simulated client-side, and Kigali runs simulated — so the
// first human being ever to use the card path would have done it with a
// real card and real francs.
//
// This is the missing half. It stands in for `window.FlutterwaveCheckout`
// ONLY when the server reports PAYMENTS_MODE=simulated, and it is
// deliberately shaped as a drop-in for the vendor widget: same config
// object, same `callback({ transaction_id })` on approval, same
// `onclose()` on cancel. chargeWithCard is NOT branched around it — it
// opens this exactly as it opens the real one, and everything after the
// widget (the /api/payments/initiate-card verify round-trip, the server's
// anti-tamper guards, the escrow transition, the audit chain) is the real
// production path.
//
// What it does NOT cover is stated plainly in the completion report: the
// vendor script, the vendor iframe, 3-D Secure, real card networks, and
// anything Flutterwave's own widget does that we cannot observe.
//
// Plain DOM on purpose: it replaces a script tag, so it must work from a
// service module with no React tree of its own — same as the thing it
// stands in for.

export interface SimulatedCheckoutConfig {
  tx_ref?: unknown;
  amount?: unknown;
  currency?: unknown;
  callback?: (resp: { transaction_id: string; tx_ref: unknown; status: string }) => void;
  onclose?: () => void;
  [key: string]: unknown;
}

const OVERLAY_ID = 'bimoto-simulated-card-checkout';

/** Drop-in stand-in for window.FlutterwaveCheckout in simulated mode. */
export function openSimulatedCardCheckout(config: SimulatedCheckoutConfig): void {
  // Never stack two checkouts; the vendor widget is single-instance too.
  document.getElementById(OVERLAY_ID)?.remove();

  let settled = false;
  const amount = typeof config.amount === 'number' ? config.amount : Number(config.amount ?? 0);
  const currency = String(config.currency ?? 'RWF');

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('data-testid', 'simulated-card-checkout');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.5);padding:16px;';

  const panel = document.createElement('div');
  panel.style.cssText =
    'background:#fff;border-radius:12px;max-width:360px;width:100%;padding:20px;' +
    'font-family:inherit;box-shadow:0 10px 30px rgba(0,0,0,0.25);';

  // The banner is not decoration: this frame must never be mistaken for a
  // real card form, by a tester or by a pilot customer.
  const banner = document.createElement('p');
  banner.textContent = 'SIMULATION — no real money';
  banner.style.cssText =
    'margin:0 0 12px;font-size:12px;font-weight:700;color:#b45309;letter-spacing:0.04em;';

  const title = document.createElement('p');
  title.textContent = 'Card payment';
  title.style.cssText = 'margin:0 0 4px;font-size:16px;font-weight:600;color:#111827;';

  const sum = document.createElement('p');
  sum.textContent = `${amount.toLocaleString()} ${currency}`;
  sum.style.cssText = 'margin:0 0 16px;font-size:20px;font-weight:700;color:#1B4F72;';

  const button = (label: string, testId: string, primary: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('data-testid', testId);
    b.style.cssText =
      'display:block;width:100%;min-height:44px;margin-top:8px;border-radius:8px;' +
      'font-size:14px;font-weight:600;cursor:pointer;' +
      (primary
        ? 'background:#15803d;color:#fff;border:none;'
        : 'background:#fff;color:#374151;border:1px solid #d1d5db;');
    return b;
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  // The vendor widget can fire callback AND onclose; chargeWithCard already
  // guards against that, and so does this — whichever happens first wins.
  const approve = button('Pay', 'simulated-card-approve', true);
  approve.onclick = () => {
    if (settled) return;
    settled = true;
    close();
    config.callback?.({
      transaction_id: `sim-card-${Date.now()}`,
      tx_ref: config.tx_ref,
      status: 'successful',
    });
  };

  const cancel = button('Cancel', 'simulated-card-cancel', false);
  cancel.onclick = () => {
    if (settled) return;
    settled = true;
    close();
    config.onclose?.();
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel.click();
  }
  document.addEventListener('keydown', onKey);

  panel.append(banner, title, sum, approve, cancel);
  overlay.append(panel);
  document.body.append(overlay);
}
