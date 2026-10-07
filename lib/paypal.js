'use strict';

/**
 * PayPal Sandbox REST v2 client.
 *
 * PayPal has no RBI purpose-code field, so the code is encoded twice:
 *   - invoice_number  -> `P0802-2026-001` (max 25 chars, FR-12)
 *   - item.memo       -> human-readable compliance trail (FR-13)
 */

const logger = require('./logger');

const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
const INVOICE_NUMBER_MAX = 25;
const DEFAULT_CURRENCY = process.env.PAYPAL_INVOICE_CURRENCY || 'USD';
const DEFAULT_EMAIL = process.env.PAYPAL_INVOICE_EMAIL || 'buyer@example.com';
const DEFAULT_NAME = process.env.PAYPAL_INVOICE_NAME || 'Gabriel Mendez';
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

let tokenCache = { token: null, expiresAt: 0 };

const hasCredentials = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

const request = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    logger.warn(`paypal ${path} returned non-JSON body`);
  }
  if (!res.ok) {
    const message = data?.message || `HTTP ${res.status}`;
    const detail = data?.details?.[0]?.description || '';
    throw new Error(`PayPal ${path}: ${message}${detail ? ` (${detail})` : ''}`);
  }
  return data;
};

/** FR-10: OAuth 2.0 client-credentials, cached in memory for ~8h. */
const getAccessToken = async () => {
  if (!hasCredentials()) throw new Error('PayPal credentials missing: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
  if (tokenCache.token && tokenCache.expiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64');

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${data?.error_description || data?.error || res.status}`);

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 28800) * 1000,
  };
  logger.info(`paypal token cached for ${data.expires_in}s`);
  return tokenCache.token;
};

/** FR-12: `P0802-2026-001`. Truncated defensively to PayPal's 25-char limit. */
const buildInvoiceNumber = (purposeCode, sequence) => {
  const year = new Date().getFullYear();
  const suffix = String(sequence).padStart(3, '0');
  return `${purposeCode}-${year}-${suffix}`.slice(0, INVOICE_NUMBER_MAX);
};

/**
 * FR-12 sequence per purpose code per year. Scans both compliance records and
 * the issued-invoice ledger, because an invoice created without a recordId is
 * still a real invoice and PayPal rejects a reused invoice_number.
 */
const nextSequence = async (purposeCode) => {
  const year = new Date().getFullYear();
  const prefix = `${purposeCode}-${year}-`;
  const db = store.read();
  const fromRecords = db.compliance_records
    .map((record) => record.invoice_number)
    .filter((value) => typeof value === 'string' && value.startsWith(prefix));
  const fromLedger = (db.issued_invoices || [])
    .map((entry) => entry.invoice_number)
    .filter((value) => typeof value === 'string' && value.startsWith(prefix));
  return new Set([...fromRecords, ...fromLedger]).size + 1;
};

const store = require('./store');

const buildItem = ({ purposeCode, label, description, amount, currency, quantity = 1 }) => ({
  name: `${purposeCode} - ${label}`.slice(0, 127),
  quantity: String(quantity),
  unit_amount: {
    currency_code: currency,
    value: Number(amount).toFixed(2),
  },
  description: `RBI purpose code ${purposeCode}. ${description}`.slice(0, 127),
});

const buildPayload = ({ purposeCode, purposeLabel, purposeDescription, amount, currency, description, sequence, memo }) => ({
  detail: {
    invoice_number: buildInvoiceNumber(purposeCode, sequence),
    currency_code: currency,
    note: `RBI Purpose Code ${purposeCode} - ${purposeLabel}`.slice(0, 127),
    memo: (memo || `Purpose Code: ${purposeCode}. ${purposeDescription}`).slice(0, 127),
    terms: 'Payment received by the exporter. Software export services are subject to Form A1 / eForm B2 reporting as advised.',
    items: [
      buildItem({
        purposeCode,
        label: purposeLabel,
        description: description || purposeDescription,
        amount,
        currency,
      }),
    ],
  },
  payer: {
    email_address: DEFAULT_EMAIL,
    name: { given_name: DEFAULT_NAME.split(' ')[0], surname: DEFAULT_NAME.split(' ').slice(1).join(' ') },
  },
  primary_recipients: [
    { email_address: process.env.PAYPAL_INVOICE_EMAIL || DEFAULT_EMAIL },
  ],
  invoice_id: buildInvoiceNumber(purposeCode, sequence),
});

/** FR-11 / FR-14: create a DRAFT invoice and return its approval link. */
const createInvoice = async ({
  purposeCode,
  purposeLabel,
  purposeDescription,
  amount,
  currency = DEFAULT_CURRENCY,
  description,
  memo,
}) => {
  const token = await getAccessToken();
  const sequence = await nextSequence(purposeCode);
  const payload = buildPayload({
    purposeCode,
    purposeLabel,
    purposeDescription,
    amount,
    currency,
    description,
    sequence,
    memo,
  });

  const invoice = await request('/v2/invoicing/invoices', { method: 'POST', body: payload, token });
  logger.info(`paypal invoice created: ${invoice.id} (${payload.detail.invoice_number})`);

  const links = invoice.links || [];
  const approval = links.find((link) => link.rel === 'approve') || links.find((link) => link.rel === 'payer_view') || null;

  // The UI renders this href, so only allow PayPal-hosted https links.
  const approvalUrl = approval && /^https:\/\/[a-z0-9.-]*paypal\.com\//i.test(approval.href)
    ? approval.href
    : null;

  const issued = {
    id: invoice.id,
    status: invoice.status,
    invoice_number: payload.detail.invoice_number,
    purpose_code: purposeCode,
    amount: Number(amount).toFixed(2),
    currency,
    approval_url: approvalUrl,
    paypal_link: approvalUrl,
    links,
    created_at: new Date().toISOString(),
  };

  // Ledger the number so the FR-12 sequence advances even for a standalone
  // invoice. A write failure must not lose a real PayPal invoice, so it is
  // logged rather than thrown.
  await store.recordInvoice({
    invoiceNumber: issued.invoice_number,
    invoiceId: issued.id,
    purposeCode,
    amount: issued.amount,
    currency,
  }).catch((err) => logger.warn(`invoice ledger write failed: ${err.message}`));

  return issued;
};

const isConfigured = () => hasCredentials();

const status = () => ({
  configured: hasCredentials(),
  base_url: BASE_URL,
  token_cached: Boolean(tokenCache.token),
  token_expires_at: tokenCache.expiresAt ? new Date(tokenCache.expiresAt).toISOString() : null,
});

module.exports = {
  createInvoice,
  buildInvoiceNumber,
  isConfigured,
  status,
  getAccessToken,
  INVOICE_NUMBER_MAX,
};
