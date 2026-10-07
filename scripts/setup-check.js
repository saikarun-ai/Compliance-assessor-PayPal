'use strict';

/**
 * Configuration readiness report used by setup.bat / setup.sh / setup.ps1.
 *
 * Everything here is read-only. It reports what is present and what each
 * missing piece costs, because the app degrades rather than fails (NFR-3) and a
 * silent degradation is confusing during a demo.
 *
 *   node scripts/setup-check.js
 *
 * Exit 0 = fully ready. Exit 1 = running with reduced capability.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { resolveCommand, resolveModel } = require('../lib/llamaBin');

const ROOT = path.join(__dirname, '..');
const rows = [];
const mark = (state, label, detail) => rows.push({ state, label, detail });

const checkModelAndBinaries = () => {
  const model = resolveModel();
  const resolved = resolveCommand();

  if (model && fs.existsSync(model)) {
    const mb = Math.round(fs.statSync(model).size / 1048576);
    mark('ok', 'GGUF model', `${path.basename(model)} (${mb} MB)`);
  } else {
    mark('warn', 'GGUF model', `not found: ${model || 'LLAMA_MODEL_PATH unset'}`);
  }

  if (resolved) {
    mark('ok', 'llama.cpp binary', resolved.command);
  } else {
    mark('warn', 'llama.cpp binary',
      'not found - unzip a llama-b*-bin-win-cpu-x64.zip into tools/llama-bin/ or set LLAMA_BIN_DIR');
  }
};

const checkChannels = async () => {
  // Required by FR-19.
  const { execFile } = require('node:child_process');
  const ytDlp = process.env.YT_DLP_BIN || 'yt-dlp';
  const hasYtDlp = await new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], { timeout: 8000, windowsHide: true },
      (err) => resolve(!err));
  });
  if (hasYtDlp) mark('ok', 'yt-dlp (YouTube)', 'installed');
  else mark('warn', 'yt-dlp (YouTube)', 'missing - trend reports lose the YouTube channel (FR-19)');

  // Optional by design (FR-20, FR-21).
  try {
    const agentReach = require('../lib/agentReach');
    const doctor = await agentReach.doctor();
    doctor.channels.forEach((channel) => {
      if (channel.ok) mark('ok', `channel: ${channel.channel}`, channel.detail);
      else mark('info', `channel: ${channel.channel}`, channel.detail);
    });
  } catch (err) {
    mark('warn', 'Agent Reach', err.message);
  }
  return ytDlp;
};

const checkPaypal = () => {
  const configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  if (configured) mark('ok', 'PayPal Sandbox', 'credentials present - live invoices enabled');
  else mark('info', 'PayPal Sandbox', 'no credentials - invoicing disabled, preview still works');
};

const checkNetwork = () => {
  mark('ok', 'Express server port', String(process.env.PORT || 3000));
  mark('ok', 'llama.cpp endpoint', process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8081');
  mark('ok', 'Free RAM', `${Math.round(os.freemem() / 1073741824)} GB of ${Math.round(os.totalmem() / 1073741824)} GB`);
};

const icon = { ok: '[ok]  ', info: '[info]', warn: '[warn]' };

const main = async () => {
  checkModelAndBinaries();
  await checkChannels();
  checkPaypal();
  checkNetwork();

  rows.forEach((row) => {
    console.log(`  ${icon[row.state]}  ${row.label.padEnd(24)} ${row.detail}`);
  });

  const degraded = rows.some((row) => row.state === 'warn');
  console.log('');
  console.log(degraded
    ? '  status: ready, with reduced capability (see [warn] rows above)'
    : '  status: fully ready');
  process.exitCode = degraded ? 1 : 0;
};

main().catch((err) => {
  console.error(`  setup check failed: ${err.message}`);
  process.exitCode = 1;
});