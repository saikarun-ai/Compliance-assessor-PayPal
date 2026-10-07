'use strict';

/**
 * Agent Reach wrappers: YouTube (yt-dlp) + Exa (mcporter) + RSS.
 * YouTube is the only required channel; Exa and RSS are optional and their
 * absence degrades the report instead of failing the request (FR-21, NFR-3).
 */

const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const logger = require('./logger');

const ENABLED = String(process.env.AGENT_REACH_ENABLED || 'true').toLowerCase() !== 'false';
const YT_LIMIT = Number(process.env.AGENT_REACH_YT_LIMIT || 12);
const EXA_LIMIT = Number(process.env.AGENT_REACH_EXA_LIMIT || 5);
const SUB_LIMIT = Number(process.env.AGENT_REACH_SUB_LIMIT || 3);
const BIN = { ytDlp: process.env.YT_DLP_BIN || 'yt-dlp', mcporter: process.env.MCPORTER_BIN || 'mcporter' };
const SUB_DIR = path.join(os.tmpdir(), 'compliance-assessor-subs');

// Binary names come from the environment and get interpolated into a shell probe
// below, so they are restricted to a plain identifier. Without this, a crafted
// YT_DLP_BIN value could append a PowerShell command.
const SAFE_BIN = /^[A-Za-z0-9._-]{1,64}$/;

const isFile = (candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch (err) {
    return false;
  }
};

/**
 * Resolve a bare command name to a path execFile can actually launch.
 *
 * On Windows a globally installed CLI is normally a shim - `mcporter.cmd`,
 * `mcporter.ps1` - and execFile does not consult PATHEXT, so spawning the bare
 * name `mcporter` fails with ENOENT even though PowerShell's Get-Command finds
 * it. Probing PATH with the PATHEXT suffixes fixes that, and is a no-op on
 * POSIX where the name is already exact.
 */
const resolveExecutable = (bin) => {
  if (bin.includes('/') || bin.includes('\\')) return isFile(bin) ? bin : null;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  // On Windows the PATHEXT shims must win: npm also drops a bare POSIX shim
  // named `mcporter` next to `mcporter.cmd`, and the extensionless file cannot
  // be executed by execFile. Prefer .COM/.EXE/.BAT/.CMD, fall back to the name.
  const candidates = exts.length
    ? [...exts.map((ext) => `${bin}${ext}`), bin]
    : [bin];
  for (const dir of dirs) {
    for (const name of candidates) {
      const full = path.join(dir, name);
      if (isFile(full)) return full;
    }
  }
  return null;
};

const binCache = new Map();
const bin = (name) => {
  if (!binCache.has(name)) binCache.set(name, resolveExecutable(name));
  return binCache.get(name);
};

/**
 * cmd.exe quoting. Node refuses to spawn .cmd/.bat without a shell, and npm
 * installs global CLIs as .cmd shims, so this path is unavoidable on Windows.
 * Quoting makes & | < > ^ literal, but %VAR% still expands inside quotes and a
 * newline would start a second command - so both are rejected outright.
 */
const CMD_FORBIDDEN = /[%`\r\n\u2028\u2029]/;

const quoteCmdArg = (arg) => `"${String(arg).replace(/"/g, '""')}"`;

const spawnViaCmd = (exePath, args, timeoutMs) => new Promise((resolve) => {
  const comspec = process.env.ComSpec || 'cmd.exe';
  const line = [exePath, ...args].map(quoteCmdArg).join(' ');
  // cmd /s strips the outer pair of quotes when the whole line is quoted, so
  // the line needs its own wrapping pair to survive intact.
  const commandLine = `"${line}"`;
  execFile(comspec, ['/d', '/s', '/c', commandLine],
    { timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: true },
    (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : null });
    });
});

const exec = (command, args, timeoutMs = 45000) => {
  const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  if (!isCmdShim) {
    return new Promise((resolve) => {
      execFile(command, args, { timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : null });
        });
    });
  }
  const unsafe = args.find((arg) => CMD_FORBIDDEN.test(String(arg)));
  if (unsafe !== undefined) {
    return Promise.resolve({ ok: false, stdout: '', stderr: '',
      error: `refusing to pass shell-unsafe argument to ${path.basename(command)}` });
  }
  return spawnViaCmd(command, args, timeoutMs);
};

const which = async (name) => {
  if (!SAFE_BIN.test(name)) {
    logger.warn(`refusing to probe unsafe binary name: ${String(name).slice(0, 40)}`);
    return false;
  }
  if (bin(name)) return true;
  const probe = process.platform === 'win32' ? 'powershell' : 'sh';
  const args = process.platform === 'win32' ? ['-Command', `(Get-Command ${name} -ErrorAction SilentlyContinue).Source`]
    : ['-c', `command -v ${name}`];
  const res = await exec(probe, args, 8000);
  return res.ok && res.stdout.trim().length > 0;
};

/** FR-19: yt-dlp flat playlist metadata, no media downloaded. */
const searchYouTube = async (niche) => {
  if (!ENABLED) return { ok: false, channel: 'youtube', reason: 'AGENT_REACH_ENABLED=false', items: [] };
  const limit = Math.max(1, YT_LIMIT);
  const args = [
    `ytsearch${limit}:${niche}`,
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    '--no-playlist-reverse',
  ];
  const res = await exec(bin(BIN.ytDlp), args);
  if (!res.ok) {
    logger.warn(`youtube search failed: ${res.error || res.stderr.slice(0, 200)}`);
    return { ok: false, channel: 'youtube', reason: res.error || res.stderr.slice(0, 200), items: [] };
  }

  const items = res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((item) => item.id && item.id !== 'NA')
    .map((item) => ({
      video_id: item.id,
      title: item.title || '',
      channel: item.channel || item.uploader || '',
      views: Number(item.view_count) || 0,
      duration: Number(item.duration) || 0,
      url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    }))
    .sort((a, b) => b.views - a.views);

  logger.info(`youtube: ${items.length} results for "${niche}"`);
  return { ok: true, channel: 'youtube', items };
};

/** MEMORY.md: auto-subs have rolling duplication — dedupe by transcript text. */
const dedupeLines = (lines) => {
  const seen = new Set();
  return lines.filter((line) => {
    const key = line.trim().toLowerCase();
    if (key.length < 12 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Extract auto-generated subtitles for the top videos; RSS words become the fallback corpus. */
const fetchSubtitles = async (videos) => {
  if (!videos.length) return { ok: true, channel: 'subtitles', transcripts: [] };
  if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });

  const transcripts = [];
  for (const video of videos.slice(0, SUB_LIMIT)) {
    const res = await exec(bin(BIN.ytDlp), [
      '--write-auto-sub', '--write-sub', '--sub-lang', 'en.*', '--skip-download',
      '--no-warnings', '-o', path.join(SUB_DIR, '%(id)s'),
      video.url,
    ]);
    if (!res.ok) {
      logger.warn(`subtitles unavailable for ${video.video_id}`);
      continue;
    }
    const files = fs.existsSync(SUB_DIR)
      ? fs.readdirSync(SUB_DIR).filter((name) => name.startsWith(video.video_id) && name.endsWith('.vtt'))
      : [];
    if (!files.length) continue;
    const body = fs.readFileSync(path.join(SUB_DIR, files[0]), 'utf8');
    const lines = dedupeLines(
      body.split('\n')
        .map((line) => line.replace(/^WEBVTT.*$/, '').replace(/\d\d:\d\d:\d\d\.\d+ --> .*$/, ''))
        .map((line) => line.replace(/<[^>]+>/g, '').trim())
        .filter((line) => /[a-z]{3,}/i.test(line)),
    );
    transcripts.push({
      video_id: video.video_id,
      title: video.title,
      words: lines.join(' ').slice(0, 4000),
    });
    fs.unlinkSync(path.join(SUB_DIR, files[0]));
  }

  logger.info(`subtitles: ${transcripts.length}/${Math.min(videos.length, SUB_LIMIT)} extracted`);
  return { ok: transcripts.length > 0, channel: 'subtitles', transcripts };
};

/**
 * FR-20 availability. `which(mcporter)` is not enough: mcporter ships the CLI
 * but the Exa server has to be registered separately, so an installed binary
 * with no configured server would report a false positive to /api/health.
 */
const exaReady = async () => {
  const mcporter = bin(BIN.mcporter);
  if (!mcporter) {
    return { ok: false, detail: 'mcporter missing - optional' };
  }
  const res = await exec(mcporter, ['list'], 20000);
  if (!res.ok) {
    return { ok: false, detail: `mcporter list failed: ${(res.error || res.stderr).slice(0, 80)}` };
  }
  const registered = /\bexa\b/i.test(res.stdout);
  return registered
    ? { ok: true, detail: BIN.mcporter }
    : { ok: false, detail: 'mcporter installed, exa server not registered (optional)' };
};

/** FR-20: Exa web search through mcporter. */
const searchExa = async (niche) => {
  if (!ENABLED) return { ok: false, channel: 'exa', reason: 'AGENT_REACH_ENABLED=false', items: [] };
  const readiness = await exaReady();
  if (!readiness.ok) return { ok: false, channel: 'exa', reason: readiness.detail, items: [] };
  const res = await exec(bin(BIN.mcporter), [
    'call', 'exa.web_search_exa', `query=${niche} trends 2026`, `numResults=${EXA_LIMIT}`,
  ]);
  if (!res.ok) {
    logger.warn(`exa search failed: ${res.error || res.stderr.slice(0, 200)}`);
    return { ok: false, channel: 'exa', reason: res.error || res.stderr.slice(0, 200), items: [] };
  }
  const items = res.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 20 && !line.startsWith('{'))
    .slice(0, EXA_LIMIT)
    .map((line) => ({ snippet: line.slice(0, 400) }));
  return { ok: items.length > 0, channel: 'exa', items, raw: res.stdout.slice(0, 2000) };
};

/** Bonus zero-config channel confirmed by `agent-reach doctor`. */
const fetchRss = async (niche) => {
  if (!ENABLED) return { ok: false, channel: 'rss', reason: 'AGENT_REACH_ENABLED=false', items: [] };
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${niche} trends`)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'compliance-assessor/3.1' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    // The feed repeats its own header as the first item; drop those, they are
    // not articles.
    const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
      .map((match) => match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim())
      .filter((title) => title && !/google news$/i.test(title))
      .slice(0, 8);
    if (!titles.length) return { ok: false, channel: 'rss', reason: 'feed returned no titles', items: [] };
    return { ok: true, channel: 'rss', items: titles.map((title) => ({ title })) };
  } catch (err) {
    logger.warn(`rss fetch failed: ${err.message}`);
    return { ok: false, channel: 'rss', reason: err.message, items: [] };
  }
};

/** Readiness probe mirroring `agent-reach doctor --json`. */
const doctor = async () => {
  const youtubeOk = await which(BIN.ytDlp);
  const exa = await exaReady();
  let reachDoctor = null;
  const reachBin = bin('agent-reach');
  if (reachBin) {
    const res = await exec(reachBin, ['doctor', '--json'], 20000);
    if (res.ok) {
      try {
        reachDoctor = JSON.parse(res.stdout);
      } catch (err) {
        reachDoctor = null;
      }
    }
  }
  return {
    enabled: ENABLED,
    channels: [
      { channel: 'youtube', ok: youtubeOk, auth: 'none', detail: youtubeOk ? BIN.ytDlp : 'yt-dlp missing' },
      { channel: 'exa_search', ok: exa.ok, auth: 'none', detail: exa.detail },
      { channel: 'rss', ok: true, auth: 'none', detail: 'fetch/feedparser' },
    ],
    agent_reach_doctor: reachDoctor,
  };
};

module.exports = {
  ENABLED,
  searchYouTube,
  fetchSubtitles,
  searchExa,
  fetchRss,
  doctor,
  SUB_DIR,
};
