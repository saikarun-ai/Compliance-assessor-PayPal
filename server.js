'use strict';

/**
 * Compliance Assessor — local-first server.
 * Airgapped: the only outbound calls are PayPal Sandbox and the Agent Reach
 * channels. Inference stays on localhost:8080 (llama.cpp).
 */

const path = require('node:path');
const express = require('express');

const llama = require('./lib/llama');
const paypal = require('./lib/paypal');
const agentReach = require('./lib/agentReach');
const rules = require('./lib/rules');
const logger = require('./lib/logger');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '256kb' }));

// No CORS headers on purpose: the UI is same-origin, and omitting them keeps
// other websites from driving the local server. The default same-origin policy
// also blocks cross-site JSON POSTs, which is why CSRF tokens are unnecessary.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/classify', require('./routes/classify'));
app.use('/api/invoice', require('./routes/invoice'));

// /api/trends spawns yt-dlp and can reach the network. Even on localhost that
// deserves a ceiling, otherwise a stuck client loops the disk cache away.
const RATE_LIMIT = { windowMs: 60000, max: 12, hits: new Map() };

const rateLimit = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || 'local';
  const hits = (RATE_LIMIT.hits.get(key) || []).filter((time) => now - time < RATE_LIMIT.windowMs);
  if (hits.length >= RATE_LIMIT.max) {
    logger.warn(`rate limit hit for ${key} on ${req.originalUrl}`);
    res.status(429).json({ success: false, error: 'too many trend requests, retry in a minute' });
    return;
  }
  hits.push(now);
  RATE_LIMIT.hits.set(key, hits);
  next();
};

app.use('/api/trends', rateLimit, require('./routes/trends'));

/** Readiness of every optional dependency, so judges can see what is wired up. */
app.get('/api/health', async (req, res) => {
  const [llamaStatus, reachStatus] = await Promise.all([llama.status(), agentReach.doctor()]);
  res.json({
    success: true,
    data: {
      service: 'compliance-assessor',
      version: '3.1.0',
      mode: llamaStatus.available ? 'llm+rules' : 'rules-only',
      llama: llamaStatus,
      paypal: paypal.status(),
      agent_reach: { enabled: agentReach.ENABLED, channels: reachStatus.channels },
      purpose_codes: rules.listCodes().map((code) => code.code),
      uptime_s: Math.round(process.uptime()),
    },
  });
});

// FR-15: single self-contained page.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: `no route for ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  logger.error(`unhandled: ${err.message}`);
  res.status(500).json({ success: false, error: err.message });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', async () => {
    logger.info(`Compliance Assessor listening on http://localhost:${PORT}`);
    const llm = await llama.status();
    const reach = await agentReach.doctor();
    logger.info(`config ${JSON.stringify(logger.redact({
      port: PORT,
      llama_url: llm.url,
      llama_model: llm.model,
      paypal_base: paypal.status().base_url,
      agent_reach: agentReach.ENABLED,
    }))}`);
    logger.info(`llama.cpp: ${llm.available ? `up at ${llm.url}` : 'DOWN — running rules-only'}`);
    logger.info(`paypal: ${paypal.isConfigured() ? 'configured' : 'no credentials (invoice disabled)'}`);
    reach.channels.forEach((channel) => logger.info(`agent-reach ${channel.channel}: ${channel.ok ? 'OK' : `missing (${channel.detail})`}`));
  });
}

module.exports = app;
