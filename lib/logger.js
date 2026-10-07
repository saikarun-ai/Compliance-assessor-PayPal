'use strict';

/**
 * Timestamped console logging. RULES.md: log with timestamp, no secrets.
 */

const REDACT_KEYS = ['client_secret', 'access_token', 'paypal_client_secret'];

const log = (level, ...args) => {
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[${ts}] ${level.toUpperCase()} ${args.join(' ')}`);
};

const redact = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  return Object.entries(payload).reduce((acc, [key, value]) => {
    acc[key] = REDACT_KEYS.includes(key.toLowerCase()) ? '***' : value;
    return acc;
  }, {});
};

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  redact,
};
