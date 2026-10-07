'use strict';

/**
 * Offline PayPal Sandbox stand-in for FR-10, FR-11, FR-14 and FR-18.
 *
 * PayPal Sandbox credentials are not issued in this environment, so the live
 * call cannot be executed against paypal.com. This mock reproduces the two
 * endpoints the client uses, with the same status codes, shapes and auth
 * challenges, so the OAuth flow, draft-invoice construction, invoice numbering
 * and approval-link handling are all genuinely executed and asserted.
 *
 *   node scripts/mock-paypal.js [port]      standalone, prints the base URL
 *
 * It is a test double only. It is never loaded by server.js.
 */

const http = require('node:http');

const TOKEN = 'mock-access-token-do-not-use';
const START_TIME = '2026-01-01T00:00:00Z';

const createMockPaypal = () => {
  const calls = [];
  let invoiceSeq = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const auth = req.headers.authorization || '';
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch (err) {
        body = raw;
      }

      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
        res.end(text);
      };

      // FR-10: OAuth 2.0 client-credentials token endpoint.
      if (req.method === 'POST' && req.url === '/v1/oauth2/token') {
        const basic = /^Basic\s+/i.test(auth);
        calls.push({ path: '/v1/oauth2/token', basic, form: raw });
        if (!basic) {
          send(401, { error: 'invalid_client', error_description: 'Basic authentication required' });
          return;
        }
        if (!raw.includes('grant_type=client_credentials')) {
          send(400, { error: 'unsupported_grant_type', error_description: 'expected client_credentials' });
          return;
        }
        send(200, { scope: 'https://uri.paypal.com/services/invoicing', access_token: TOKEN,
          token_type: 'Bearer', app_id: 'APP-MOCK', expires_in: 28800, nonce: 'mock-nonce' });
        return;
      }

      // FR-11 / FR-14: draft invoice creation.
      if (req.method === 'POST' && req.url === '/v2/invoicing/invoices') {
        const bearer = auth === `Bearer ${TOKEN}`;
        calls.push({ path: '/v2/invoicing/invoices', bearer, invoice_number: body?.detail?.invoice_number,
          memo: body?.detail?.memo });
        if (!bearer) {
          send(401, { name: 'AUTHENTICATION_FAILURE',
            message: 'Authentication failed due to invalid authentication credentials.' });
          return;
        }
        invoiceSeq += 1;
        const id = `INV2-MOCK${String(invoiceSeq).padStart(4, '0')}`;
        const approval = `https://www.sandbox.paypal.com/checkoutnow?token=${id}`;
        send(201, {
          id,
          status: 'DRAFT',
          status_update_time: START_TIME,
          invoice_number: body?.detail?.invoice_number,
          currency_code: body?.detail?.currency_code,
          primary_recipients: body?.primary_recipients,
          detail: body?.detail,
          payer: body?.payer,
          links: [
            { href: approval, rel: 'approve', method: 'GET' },
            { href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, rel: 'self', method: 'GET' },
            { href: `https://www.sandbox.paypal.com/invoice/smart/${id}`, rel: 'payer_view', method: 'GET' },
          ],
        });
        return;
      }

      calls.push({ path: req.url, method: req.method, status: 404 });
      send(404, { name: 'RESOURCE_NOT_FOUND', message: `no mock route for ${req.method} ${req.url}` });
    });
  });

  return {
    server,
    calls,
    get invoiceCount() { return invoiceSeq; },
    listen: (port = 0) => new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

module.exports = { createMockPaypal, MOCK_TOKEN: TOKEN };

if (require.main === module) {
  const port = Number(process.argv[2] || 8099);
  createMockPaypal().listen(port).then((url) => {
    console.log(`mock PayPal Sandbox listening on ${url}`);
    console.log(`set PAYPAL_BASE_URL=${url} plus any PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET`);
  });
}