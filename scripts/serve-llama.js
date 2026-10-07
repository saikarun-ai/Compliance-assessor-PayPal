'use strict';

/**
 * Launches the local llama.cpp server.
 *
 *   npm run llama          foreground, Ctrl+C to stop
 *   npm run llama -- --detach   background, keeps running after this exits
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const { resolveCommand, resolveModel, buildArgs } = require('../lib/llamaBin');

const detach = process.argv.includes('--detach');

const main = () => {
  const resolved = resolveCommand();
  if (!resolved) {
    console.error('No llama.cpp binary found.');
    console.error('Download llama-b*-bin-win-cpu-x64.zip from github.com/ggml-org/llama.cpp/releases');
    console.error('and unzip it into tools/llama-bin/');
    process.exitCode = 1;
    return;
  }

  const model = resolveModel();
  if (!fs.existsSync(model)) {
    console.error(`Model not found: ${model}`);
    console.error('Set LLAMA_MODEL_PATH in .env to a local GGUF file.');
    process.exitCode = 1;
    return;
  }

  const args = buildArgs(resolved.prefix);
  const url = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8081';

  console.log(`model    ${model}`);
  console.log(`binary   ${resolved.command}`);
  console.log(`endpoint ${url}`);

  const child = spawn(resolved.command, args, {
    cwd: resolved.dir,
    detached: detach,
    stdio: detach ? 'ignore' : 'inherit',
    windowsHide: true,
  });

  if (detach) {
    child.unref();
    console.log('Started detached. Check: curl ' + url + '/health');
  }

  child.on('error', (err) => {
    console.error(`failed to launch llama.cpp: ${err.message}`);
    process.exitCode = 1;
  });
};

main();
