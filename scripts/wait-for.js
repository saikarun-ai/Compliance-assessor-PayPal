'use strict';

/**
 * Block until an HTTP endpoint answers, or the timeout expires.
 *
 * Shared by run.bat / run.sh / run.ps1 so none of them needs a bespoke polling
 * loop (or the quoting mess that comes with one in batch).
 *
 *   node scripts/wait-for.js http://127.0.0.1:8081/health 180 "llama.cpp"
 *
 * Always exits 0: the caller decides whether a timeout is fatal, because a
 * missing model degrades to rules-only rather than failing the boot (NFR-3).
 */

const url = process.argv[2];
const timeoutSec = Number(process.argv[3] || 180);
const label = process.argv[4] || url;

if (!url) {
  console.error('usage: wait-for.js <url> [timeoutSeconds] [label]');
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`  ${label} ready`);
        return;
      }
    } catch (err) {
      /* not listening yet */
    }
    await sleep(2000);
  }
  console.log(`  ${label} not ready after ${timeoutSec}s - continuing without it`);
};

main();