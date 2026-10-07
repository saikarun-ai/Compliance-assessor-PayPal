'use strict';

/**
 * FR-10, FR-11, FR-12, FR-13, FR-14, FR-18 verification against a local PayPal
 * Sandbox stand-in.
 *
 * Real Sandbox credentials were never issued in this environment, so these
 * requirements were previously reported as unverified. This script closes that
 * gap: it starts scripts/mock-paypal.js, boots a second Express instance
 * pointed at it with dummy credentials, and asserts the full OAuth ->
 * draft-invoice -> approval-link path, including the negative cases.
 *
 *   npm run verify:invoice
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const { createMockPaypal } = require('./mock-paypal');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.INVOICE_TEST_PORT || 3011);
const APP_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
const check = (label, pass, detail = '') => {
  checks.push({ label, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const killTree = (pid) => {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } else {
    try { process.kill(-pid); } catch (err) { /* already gone */ }
  }
};

const post = async (route, body) => {
  const res = await fetch(`${APP_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const main = async () => {
  console.log('\nPayPal invoice path verification (mock Sandbox)\n');

  const mock = createMockPaypal();
  const mockUrl = await mock.listen(0);
  // Isolate the ledger so sequence assertions (-001, -002) are deterministic
  // regardless of how many times the suite has run against the real data dir.
  const tmpData = mkdtempSync(path.join(tmpdir(), 'compliance-verify-'));
  const app = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: tmpData,
      PAYPAL_BASE_URL: mockUrl,
      PAYPAL_CLIENT_ID: 'mock-client-id',
      PAYPAL_CLIENT_SECRET: 'mock-client-secret',
      // Keep classification out of this test: no model needed, faster startup.
      LLAMA_SERVER_URL: 'http://127.0.0.1:9',
    },
  });

  const stop = () => {
    killTree(app.pid);
    app.stdout?.destroy();
    app.stderr?.destroy();
    mock.close();
    try {
      rmSync(tmpData, { recursive: true, force: true });
    } catch (err) { /* temp dir may be in use until the child is reaped */ }
  };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  try {
    const ready = await (async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const res = await fetch(`${APP_URL}/api/health`);
          if (res.ok) return true;
        } catch (err) { /* not up yet */ }
        await sleep(500);
      }
      return false;
    })();
    if (!ready) throw new Error('server did not start');

    const health = (await (await fetch(`${APP_URL}/api/health`)).json()).data;
    check('health reports PayPal configured', health.paypal.configured === true, JSON.stringify(health.paypal));
    check('health reports the mock base URL', health.paypal.base_url === mockUrl, health.paypal.base_url);

    // FR-10: OAuth client-credentials with a Basic challenge.
    const first = await post('/api/invoice', { purposeCode: 'P0802', amount: 2000 });
    check('FR-11 draft invoice created', first.status === 200 && /^INV2-MOCK/.test(first.json.data.id),
      first.json.data ? first.json.data.id : JSON.stringify(first.json));

    const tokenCall = mock.calls.find((call) => call.path === '/v1/oauth2/token');
    check('FR-10 OAuth token requested with Basic auth',
      Boolean(tokenCall) && tokenCall.basic && tokenCall.form.includes('grant_type=client_credentials'),
      tokenCall ? tokenCall.form : 'no token call');

    const invoiceCall = mock.calls.find((call) => call.path === '/v2/invoicing/invoices');
    check('FR-10 invoice call authenticated with the bearer token', Boolean(invoiceCall) && invoiceCall.bearer);
    check('FR-11 invoice created in DRAFT status', first.json.data.status === 'DRAFT', first.json.data.status);

    // FR-12 / FR-13: purpose code carried in both the number and the memo.
    check('FR-12 invoice_number embeds the purpose code', /^P0802-\d{4}-001$/.test(first.json.data.invoice_number),
      first.json.data.invoice_number);
    check('FR-12 invoice_number within 25 chars', first.json.data.invoice_number.length <= 25,
      `${first.json.data.invoice_number.length} chars`);
    check('FR-13 memo embeds the purpose code', /P0802/.test(invoiceCall.memo), invoiceCall.memo);
    check('FR-11 amount matches the request', first.json.data.amount === '2000.00', first.json.data.amount);

    // FR-14 / FR-18: approval link returned and host-allowlisted.
    const approval = first.json.data.approval_url;
    check('FR-14 approval link returned', typeof approval === 'string' && approval.startsWith('https://'),
      approval);
    check('FR-14 approval link is PayPal-hosted',
      /^https:\/\/[a-z0-9.-]*paypal\.com\//i.test(approval || ''), approval);
    check('FR-14 links array preserved for the UI', Array.isArray(first.json.data.links)
      && first.json.data.links.some((link) => link.rel === 'approve'));

    // Sequence numbering must advance for a second invoice.
    const second = await post('/api/invoice', { purposeCode: 'P0802', amount: 500 });
    check('FR-12 invoice sequence increments', /-002$/.test(second.json.data.invoice_number),
      second.json.data.invoice_number);
    check('FR-11 second invoice created', mock.invoiceCount === 2, `${mock.invoiceCount} invoices`);

    // Negative cases: the client must reject bad input before calling PayPal.
    const before = mock.invoiceCount;
    const badCode = await post('/api/invoice', { purposeCode: 'P9999', amount: 100 });
    check('unknown purpose code rejected',
      badCode.status === 400 && /purposeCode/i.test(badCode.json.error), badCode.json.error);
    const badAmount = await post('/api/invoice', { purposeCode: 'P0802', amount: 0 });
    check('zero amount rejected', badAmount.status === 400, badAmount.json.error);
    const badNegative = await post('/api/invoice', { purposeCode: 'P0802', amount: -5 });
    check('negative amount rejected', badNegative.status === 400, badNegative.json.error);
    check('no PayPal call made for rejected input', mock.invoiceCount === before,
      `${mock.invoiceCount} invoices`);

    const failed = checks.filter((entry) => !entry.pass);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    stop();
  }
};

main().catch((err) => {
  console.error(`\ninvoice verification failed: ${err.message}\n`);
  process.exitCode = 1;
});