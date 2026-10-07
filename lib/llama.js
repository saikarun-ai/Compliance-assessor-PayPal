'use strict';

/**
 * Minimal llama.cpp client.
 *
 * Tries the OpenAI-compatible /v1/chat/completions endpoint first (supports
 * response_format json_object), then the Ollama-compatible /api/chat, then the
 * raw /completion endpoint. Every path is wrapped so callers can degrade to
 * rules-only when llama-server is not running.
 */

const logger = require('./logger');

const BASE_URL = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 60000);
const MAX_TOKENS = Number(process.env.LLAMA_MAX_TOKENS || 400);

let cachedHealth = { ok: false, checkedAt: 0 };
const HEALTH_TTL_MS = 15000;

const withTimeout = async (url, options, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const postJson = async (path, body) => {
  const res = await withTimeout(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`llama.cpp ${path} responded ${res.status}`);
  return res.json();
};

const callChatCompletions = async (system, user) => {
  const data = await postJson('/v1/chat/completions', {
    model: 'local',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    max_tokens: MAX_TOKENS,
    stream: false,
    response_format: { type: 'json_object' },
  });
  return data?.choices?.[0]?.message?.content || '';
};

const callOllamaChat = async (system, user) => {
  const data = await postJson('/api/chat', {
    model: 'local',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    format: 'json',
    stream: false,
    options: { temperature: 0.1, num_predict: MAX_TOKENS },
  });
  return data?.message?.content || data?.response || '';
};

const callCompletion = async (system, user) => {
  const data = await postJson('/completion', {
    prompt: `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`,
    n_predict: MAX_TOKENS,
    temperature: 0.1,
    stream: false,
  });
  return data?.content || '';
};

const ATTEMPTS = [
  { name: 'chat-completions', run: callChatCompletions },
  { name: 'ollama-chat', run: callOllamaChat },
  { name: 'completion', run: callCompletion },
];

/** Run a chat prompt through whichever llama.cpp endpoint is live. */
const chat = async (system, user) => {
  const failures = [];
  for (const attempt of ATTEMPTS) {
    try {
      const text = await attempt.run(system, user);
      if (text && text.trim()) {
        cachedHealth = { ok: true, checkedAt: Date.now(), endpoint: attempt.name };
        return { text, endpoint: attempt.name };
      }
      failures.push(`${attempt.name}: empty response`);
    } catch (err) {
      failures.push(`${attempt.name}: ${err.message}`);
    }
  }
  cachedHealth = { ok: false, checkedAt: Date.now(), error: failures.join(' | ') };
  throw new Error(`llama.cpp unavailable at ${BASE_URL} (${failures.join('; ')})`);
};

/** Pull the first JSON object out of a model response. */
const extractJson = (text) => {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    logger.warn(`extractJson failed: ${err.message}`);
    return null;
  }
};

const chatJson = async (system, user) => {
  const { text, endpoint } = await chat(system, user);
  const parsed = extractJson(text);
  if (!parsed) throw new Error('llama.cpp returned unparseable JSON');
  return { data: parsed, endpoint, raw: text };
};

const isAvailable = async () => {
  if (Date.now() - cachedHealth.checkedAt < HEALTH_TTL_MS) return cachedHealth.ok;
  try {
    const res = await withTimeout(`${BASE_URL}/health`, { method: 'GET' }, 3000);
    cachedHealth = { ok: res.ok, checkedAt: Date.now() };
  } catch (err) {
    cachedHealth = { ok: false, checkedAt: Date.now(), error: err.message };
  }
  return cachedHealth.ok;
};

const status = async () => {
  const ok = await isAvailable();
  let model = process.env.LLAMA_MODEL_PATH || '(unset)';
  try {
    const res = await withTimeout(`${BASE_URL}/v1/models`, { method: 'GET' }, 3000);
    if (res.ok) {
      const data = await res.json();
      model = data?.data?.[0]?.id || model;
    }
  } catch (err) {
    /* /v1/models is optional */
  }
  return { url: BASE_URL, available: ok, endpoint: cachedHealth.endpoint || null, model };
};

module.exports = { chat, chatJson, extractJson, isAvailable, status, BASE_URL };
