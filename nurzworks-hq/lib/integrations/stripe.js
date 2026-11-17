'use strict';
// Optional online card/ACH payments with Stripe Checkout. When a Stripe secret key is saved, customer invoice
// pages show a "Pay online" button; the webhook records the payment against the invoice automatically.
const crypto = require('crypto');
const { get } = require('../db');
const { getSecret } = require('../auth');
const { HttpError, round2 } = require('../util');
const { baseUrl, currency } = require('../config');

const API = () => (process.env.NW_STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
function enabled() { return !!getSecret('stripe_secret_key'); }

function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out);
    else if (v !== undefined && v !== null) out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(path, body) {
  const key = getSecret('stripe_secret_key');
  if (!key) throw new HttpError(409, 'Online payments are not set up.');
  const res = await fetch(API() + path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Stripe: ${(data.error && data.error.message) || res.status}`);
  return data;
}
async function checkoutForInvoice(publicToken) {
  const inv = get("SELECT i.*, c.email customer_email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.public_token=:t AND i.status NOT IN ('draft','void')", { t: publicToken });
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  if (!(inv.balance > 0)) throw new HttpError(400, 'This invoice is already paid.');
  const back = `${baseUrl()}/p/i/${publicToken}`;
  const s = await stripe('/v1/checkout/sessions', {
    mode: 'payment', success_url: `${back}?paid=1`, cancel_url: back, client_reference_id: String(inv.id), customer_email: inv.customer_email || undefined,
    line_items: { 0: { quantity: 1, price_data: { currency: currency().toLowerCase(), unit_amount: Math.round(round2(inv.balance) * 100), product_data: { name: `Invoice ${inv.number}` } } } },
    metadata: { invoice_id: String(inv.id), invoice_number: inv.number }
  });
  return { url: s.url };
}
// Stripe-Signature: t=timestamp,v1=hmac
function verifyWebhook(raw, header) {
  const secret = getSecret('stripe_webhook_secret');
  if (!secret) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const sig = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sig.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts.v1));
}
function handleWebhook(raw, header) {
  if (!verifyWebhook(raw, header)) throw new HttpError(400, 'Invalid signature');
  const evt = JSON.parse(raw);
  if (evt.type === 'checkout.session.completed' && evt.data && evt.data.object && evt.data.object.payment_status === 'paid') {
    const s = evt.data.object;
    const invId = Number(s.metadata && s.metadata.invoice_id);
    if (invId && !get('SELECT id FROM payments WHERE external_id=:x', { x: s.id })) {
      const { systemCtx } = require('../ops');
      require('../services/invoices').recordPayment({ invoice_id: invId, amount: round2(s.amount_total / 100), method: 'stripe', reference: s.payment_intent || s.id, external_id: s.id, notes: 'Paid online (Stripe Checkout)' }, systemCtx('Stripe', 'webhook'));
    }
  }
  return { received: true };
}
module.exports = { enabled, checkoutForInvoice, handleWebhook, verifyWebhook };
