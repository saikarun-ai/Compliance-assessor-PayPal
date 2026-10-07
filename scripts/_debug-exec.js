'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');

const target = process.env.APPDATA + '\\npm\\mcporter.cmd';
const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;

const run = (label, args, opts) => new Promise((resolve) => {
  execFile('cmd.exe', args, { timeout: 20000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
    console.log(`${label}: ${err ? 'ERR ' + err.message.slice(0, 160) : 'OK'}`);
    if (stdout) console.log(`  out=${JSON.stringify(stdout.slice(0, 120))}`);
    if (stderr) console.log(`  err=${JSON.stringify(stderr.slice(0, 160))}`);
    resolve();
  });
});

const main = async () => {
  const line = [target, 'list'].map(quote).join(' ');
  const wrapped = `"${line}"`;
  const spaced = `"${['C:\\Program Files\\mcporter\\mcporter.cmd', 'list'].map(quote).join(' ')}"`;

  await run('1 no verbatim (current)', ['/d', '/s', '/c', wrapped], {});
  await run('2 verbatim wrapped       ', ['/d', '/s', '/c', wrapped], { windowsVerbatimArguments: true });
  await run('3 verbatim separate argv ', ['/d', '/s', '/c', target, 'list'], { windowsVerbatimArguments: true });
  await run('4 verbatim spaced path   ', ['/d', '/s', '/c', `"${['C:\\Program Files\\x\\mcporter.cmd', 'list'].map(quote).join(' ')}"`],
    { windowsVerbatimArguments: true });
  console.log('spaced path exists:', fs.existsSync('C:\\Program Files\\x\\mcporter.cmd'), '(expected false)');
};

main();
