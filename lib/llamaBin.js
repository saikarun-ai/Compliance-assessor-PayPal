'use strict';

/**
 * Resolves the local llama.cpp binary so every entry point (npm run llama,
 * npm run e2e, the README) launches inference the same way.
 */

const fs = require('node:fs');
const path = require('node:path');

const BIN_DIRS = [
  process.env.LLAMA_BIN_DIR,
  path.join(__dirname, '..', 'tools', 'llama-bin'),
  path.join(__dirname, '..', 'tools', 'llama.cpp'),
].filter(Boolean);

const DEFAULT_MODEL = 'D:\\Gen AI Applications\\LLMS\\gemma-3-1b-it-Q4_K_M.gguf';

/**
 * Some llama.cpp Windows builds ship llama-server.exe as a ~9KB stub while
 * `llama.exe serve` is the same HTTP server. Prefer the dedicated binary and
 * fall back to the unified one.
 */
const resolveCommand = () => {
  for (const dir of BIN_DIRS) {
    const serverExe = path.join(dir, 'llama-server.exe');
    if (fs.existsSync(serverExe)) return { command: serverExe, prefix: [], dir };
    const unifiedExe = path.join(dir, 'llama.exe');
    if (fs.existsSync(unifiedExe)) return { command: unifiedExe, prefix: ['serve'], dir };
  }
  return null;
};

const resolveModel = () => process.env.LLAMA_MODEL_PATH || DEFAULT_MODEL;

const buildArgs = (prefix) => {
  const url = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8081';
  const port = new URL(url).port || '8081';
  return [
    ...prefix,
    '-m', resolveModel(),
    '--ctx-size', process.env.LLAMA_CTX_SIZE || '2048',
    '--threads', process.env.LLAMA_THREADS || '4',
    '--host', '127.0.0.1',
    '--port', port,
    '-ngl', '0',
  ];
};

module.exports = { BIN_DIRS, DEFAULT_MODEL, resolveCommand, resolveModel, buildArgs };
