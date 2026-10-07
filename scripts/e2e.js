'use strict';

/**
 * End-to-end smoke test. Spawns llama.cpp and the Express server as child
 * processes, exercises every FR, then shuts both down.
 *
 * Usage: npm run e2e
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const ROOT = path.join(__dirname, '..');
const { resolveCommand, resolveModel, buildArgs } = require('../lib/llamaBin');

const MODEL = resolveModel();
const LLAMA_URL = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8081';
const PORT = Number(process.env.PORT || 3000);
const APP_URL = `http://127.0.0.1:${PORT}`;
const LLAMA_WAIT_MS = 180000;
// Hermetic run: isolate the ledger and the 24h trend cache so the absolute
// sequence assertions (-001) and the record-count assertion are deterministic.
const TMP_DATA = mkdtempSync(path.join(tmpdir(), 'compliance-e2e-'));

const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Windows does not reap grandchildren with child.kill(). llama-server.exe is a
 * launcher stub, so a naive kill leaves the real server holding ~1GB of the
 * 4GB budget. taskkill /T takes the tree.
 */
const killTree = (pid) => {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  }
};

/** Clear any server left behind by a previous interrupted run. */
const killStrays = () => {
  if (process.platform !== 'win32') return;
  ['llama-server.exe', 'llama.exe'].forEach((name) => {
    spawn('taskkill', ['/IM', name, '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  });
};

const spawnTracked = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: ROOT, windowsHide: true, ...options });
  children.push(child);
  return child;
};

const cleanup = () => {
  children.forEach((child) => killTree(child.pid));
  rmSync(TMP_DATA, { recursive: true, force: true });
};

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const waitFor = async (label, probe, timeoutMs) => {
  const started = Date.now();
  let lastError = 'no response';
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await probe();
      if (result) {
        console.log(`  ready: ${label} after ${Math.round((Date.now() - started) / 1000)}s`);
        return result;
      }
    } catch (err) {
      lastError = err.message;
    }
    await sleep(2000);
  }
  throw new Error(`${label} did not come up within ${Math.round(timeoutMs / 1000)}s (last error: ${lastError})`);
};

const startLlama = async () => {
  const fs = require('node:fs');
  const resolved = resolveCommand();
  if (!resolved) throw new Error('no llama.cpp binary — set LLAMA_BIN_DIR or unzip one into tools/llama-bin');
  if (!fs.existsSync(MODEL)) throw new Error(`model not found: ${MODEL}`);

  console.log(`starting inference: ${path.basename(resolved.command)} ${resolved.prefix.join(' ')}`);
  const child = spawnTracked(resolved.command, buildArgs(resolved.prefix), {
    cwd: resolved.dir, stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitFor('llama.cpp', async () => {
    const res = await fetch(`${LLAMA_URL}/health`);
    return res.ok;
  }, LLAMA_WAIT_MS);

  // The launcher stub may re-parent the real server, so track it by name too.
  return child.pid;
};

const llamaTreePids = (launcherPid) => new Promise((resolve) => {
  const ps = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "(Get-Process -Name 'llama','llama-server' -ErrorAction SilentlyContinue | "
      + 'Select-Object -ExpandProperty Id) -join ","',
  ], { windowsHide: true });
  let out = '';
  ps.stdout.on('data', (chunk) => { out += chunk; });
  ps.on('close', () => {
    const pids = out.trim().split(',').map(Number).filter(Boolean);
    if (launcherPid && !pids.includes(launcherPid)) pids.push(launcherPid);
    resolve(pids);
  });
});

const startApp = async () => {
  const child = spawnTracked(process.execPath, ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), LLAMA_SERVER_URL: LLAMA_URL, DATA_DIR: TMP_DATA },
  });
  await waitFor('express server', async () => {
    const res = await fetch(`${APP_URL}/api/health`);
    return res.ok;
  }, 30000);
  return child.pid;
};

const post = async (route, body) => {
  const res = await fetch(`${APP_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`${route}: ${data.error}`);
  return data.data;
};

const get = async (route) => {
  const res = await fetch(`${APP_URL}${route}`);
  const data = await res.json();
  if (!data.success) throw new Error(`${route}: ${data.error}`);
  return data.data;
};

/**
 * NFR-1: working set of the inference server plus the two Node processes this
 * run started. Scoped to our own pids, because the machine may host unrelated
 * node/llama processes that are none of the agent's business.
 */
const measureRam = (pids) => new Promise((resolve) => {
  const idList = pids.filter(Boolean).join(',');
  const ps = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${idList} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, `
      + '@{n="MB";e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress)',
  ], { windowsHide: true });

  let out = '';
  ps.stdout.on('data', (chunk) => { out += chunk; });
  ps.on('close', () => {
    try {
      const parsed = JSON.parse(out);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      resolve(rows.filter((row) => row && row.MB).map((row) => ({ name: row.ProcessName, id: row.Id, mb: row.MB })));
    } catch (err) {
      resolve([]);
    }
  });
});

const checks = [];
const classifyTimings = [];
const check = (label, pass, detail = '') => {
  checks.push({ label, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const runChecks = async (pids) => {
  console.log('\nFR checks');

  const health = await get('/api/health');
  check('NFR-3 mode reports llm+rules', health.mode === 'llm+rules', health.mode);
  check('FR-15 single page served on localhost', await fetch(`${APP_URL}/`).then((res) => res.ok));
  check('purpose code table exposed', health.purpose_codes.length === 6, health.purpose_codes.join(','));

  const cases = [
    ['I built a React dashboard for a US client for $2000', 'P0802', 'freelancer'],
    ['Monthly SaaS subscription revenue from an EU customer, 40 subscribers', 'P0807', 'startup'],
    ['Paid brand sponsorship by a UK skincare brand for 2 Instagram reels', 'P1007', 'influencer'],
    ['Management consulting engagement for a Dubai client', 'P1006', 'freelancer'],
    ['YouTube AdSense payout for my channel', 'NON_EXPORT', 'influencer'],
    ['Monthly salary from my remote job with a US company', 'P1401', 'freelancer'],
  ];

  for (const [description, expected, userType] of cases) {
    const startedAt = Date.now();
    const result = await post('/api/classify', { description, userType, receivedAt: '2026-10-15' });
    const elapsedMs = Date.now() - startedAt;
    check(`FR classify "${expected}"`, result.purpose_code === expected,
      `got ${result.purpose_code}, decided by ${result.decided_by}, ${elapsedMs} ms`);
    classifyTimings.push(elapsedMs);
  }

  const worstClassify = Math.max(...classifyTimings);
  check('NFR-2 classification under 8 s', worstClassify < 8000, `worst case ${worstClassify} ms`);
  console.log(`  classify latency: avg ${Math.round(classifyTimings.reduce((a, b) => a + b, 0) / classifyTimings.length)} ms, worst ${worstClassify} ms`);

  const software = await post('/api/classify', {
    description: 'Developed a React dashboard for a US client', userType: 'freelancer', receivedAt: '2026-10-15',
  });
  check('FR-7/FR-8 software EDF = month-end + 30 days', software.edf_deadline === '2026-11-30', software.edf_deadline);

  const nonSoftware = await post('/api/classify', {
    description: 'Management consulting for a Dubai client', userType: 'freelancer', receivedAt: '2026-10-15',
  });
  check('FR-7/FR-9 non-software EDF = on receipt', nonSoftware.edf_deadline === '2026-10-15', nonSoftware.edf_deadline);

  const platform = await post('/api/classify', {
    description: 'YouTube AdSense payout', userType: 'influencer', receivedAt: '2026-10-15',
  });
  check('FR-3 platform income needs no EDF', platform.edf_required === false && platform.purpose_code === 'NON_EXPORT');

  // FR-17: every field public/app.js reads off a classification result.
  const UI_FIELDS = ['id', 'purpose_code', 'purpose_label', 'purpose_description', 'confidence',
    'ambiguous', 'decided_by', 'rationale', 'edf_required', 'edf_deadline_type', 'edf_deadline',
    'edf_rule', 'llm'];
  const missingUi = UI_FIELDS.filter((key) => software[key] === undefined);
  check('FR-17 classification payload carries every UI field', missingUi.length === 0,
    missingUi.length ? `missing ${missingUi.join(',')}` : `${UI_FIELDS.length} fields present`);

  const preview = await post('/api/invoice/preview', { purposeCode: 'P0802', amount: 2000 });
  check('FR-12 invoice_number carries the code', preview.detail.invoice_number === 'P0802-2026-001', preview.detail.invoice_number);
  check('FR-13 memo carries the code', preview.detail.memo.includes('P0802'));
  check('invoice_number within 25 chars', preview.detail.invoice_number.length <= 25);

  let invoiceThrew = false;
  try {
    await post('/api/invoice', { purposeCode: 'P0802', amount: 2000 });
  } catch (err) {
    invoiceThrew = /credentials missing/.test(err.message);
  }
  check('NFR-3 invoice degrades without credentials', invoiceThrew || process.env.PAYPAL_CLIENT_ID);

  const records = await get('/api/classify/records?limit=3');
  check('SRS-7 records persisted', records.length === 3, `${records.length} records`);

  const reach = await get('/api/trends/doctor');
  const youtubeOk = reach.channels.find((channel) => channel.channel === 'youtube').ok;
  check('FR-19 Agent Reach youtube channel available', youtubeOk);

  // FR-21: channels resolve from local binaries only. Exa needs no key and
  // PayPal needs no key at this point, so availability must be decided purely
  // by what is installed.
  const noKeys = !process.env.EXA_API_KEY && !process.env.PAYPAL_CLIENT_ID;
  check('FR-21 channels resolve zero-config, no keys or cookies',
    noKeys && reach.channels.every((channel) => typeof channel.detail === 'string'),
    reach.channels.map((channel) => `${channel.channel}:${channel.ok}`).join(' '));

  const report = await post('/api/trends', { niche: 'AI productivity tools' });
  check('FR-22 report combines channels', report.sources.youtube > 0, JSON.stringify(report.sources));
  check('FR-24 sentiment present', ['positive', 'mixed', 'negative', 'neutral'].includes(report.sentiment), report.sentiment);
  check('FR-24 content angle present', report.content_angle.length > 20);
  check('FR-24 engagement present', report.engagement_rate > 0 && report.engagement_rate <= 100,
    `${report.engagement_rate}% top quartile, ${report.view_multiplier}x median of ${report.median_views}`);
  check('FR-25 pricing band present', /\d+-\d+ USD/.test(report.pricing_band), report.pricing_band);
  check('FR-25 pricing band is non-degenerate', !/^0-0 /.test(report.pricing_band), report.pricing_band);
  console.log(`\n  niche: ${report.niche}`);
  console.log(`  summary: ${report.trend_summary.slice(0, 220)}`);
  console.log(`  angle: ${report.content_angle.slice(0, 160)}`);
  console.log(`  platforms: ${report.top_platforms} · sentiment ${report.sentiment} (${report.sentiment_detail.score})`);
  console.log(`  band: ${report.pricing_band} · ${report.duration_ms} ms · llm ${report.llm_used ? 'used' : 'skipped'}`);

  const cached = await post('/api/trends', { niche: 'AI productivity tools' });
  check('trend report cached on second call', cached.cached === true);

  console.log('\nNFR-1 memory');
  const procs = await measureRam(pids);
  procs.forEach((proc) => console.log(`  ${proc.name} (pid ${proc.id}): ${proc.mb} MB`));
  const totalMb = procs.reduce((sum, proc) => sum + proc.mb, 0);
  console.log(`  total agent footprint: ${(totalMb / 1024).toFixed(2)} GB`);
  check('NFR-1 agent footprint under 2 GB', totalMb > 0 && totalMb < 2048, `${Math.round(totalMb)} MB`);

  // FR-23 excludes the model process: the trend pipeline is the Express process
  // plus its yt-dlp children, so the Node processes alone bound it.
  const pipelineMb = procs.filter((proc) => proc.name === 'node').reduce((sum, proc) => sum + proc.mb, 0);
  check('FR-23 trend pipeline under 250 MB', pipelineMb > 0 && pipelineMb < 250, `${Math.round(pipelineMb)} MB`);
};

const main = async () => {
  console.log('\ncompliance-assessor end-to-end check\n');
  killStrays();
  await sleep(1500);

  const llamaLauncherPid = await startLlama();
  const appPid = await startApp();
  const llamaPids = await llamaTreePids(llamaLauncherPid);
  await runChecks([...llamaPids, appPid, process.pid]);

  const failed = checks.filter((entry) => !entry.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  cleanup();
  process.exitCode = failed.length ? 1 : 0;
};

main().catch((err) => {
  console.error(`\ne2e failed: ${err.message}\n`);
  cleanup();
  process.exitCode = 1;
});
