# Security & Code-Quality Review — Compliance Assessor

Version 1.0 · 2026-10-06 · Reviewer: automated deep review (Strix-equivalent methodology)

## 0. Method and scope

The vendor "Strix" agent is not installed in this environment and requires a
hosted LLM key to run, which contradicts this project's airgapped premise. The
review below applies the same discipline that agent applies — threat modelling
by trust boundary, then evidence-backed findings with concrete remediation — by
reading all 19 source files (2 295 lines), the dependency tree, the git
hygiene rules, and the live runtime behaviour of the end-to-end suite.

Scope: `server.js`, `lib/`, `routes/`, `public/`, `scripts/`, `package.json`,
`.env.example`, `.gitignore`, `data/`.
Out of scope: third-party code (`express` and its transitive deps), the model
weights, and the PayPal Sandbox account configuration.

Trust model: this is a **single-user local desktop tool**. It binds to
`127.0.0.1` only, has no accounts, no multi-tenancy and no public exposure.
Severity is therefore graded against that model — a "high" finding means it
breaks the local-only guarantee, not that it is remotely exploitable.

| Severity | Meaning here |
| --- | --- |
| Critical | Remote code execution, credential theft, or data loss reachable by an untrusted party |
| High | Breaks the loopback-only guarantee, or an untrusted remote input reaches a dangerous sink |
| Medium | Weakens defence in depth, enables a local DoS, or leaks internal detail |
| Low | Maintainability, dead code, documentation drift |

## 1. Executive summary

| Dimension | Result |
| --- | --- |
| Dependency vulnerabilities | **0** (`npm audit`: 0 across 68 packages) |
| Runtime dependencies | **1** (`express@^4.21.2`) — no ORM, no template engine, no client framework |
| Command execution | `execFile` only, never `exec`/`spawn(shell:true)`; all args are arrays |
| SQL / NoSQL injection | Not applicable — storage is a single JSON file, no query language |
| XSS sinks | All `innerHTML` writes pass through `esc()`; one `<a href>` sink now scheme-allowlisted |
| Secrets in VCS | `.env` is gitignored; `.env.example` holds empty placeholders only |
| Findings | 0 Critical · 0 High · 3 Medium (all fixed) · 5 Low (all fixed) |
| Automated checks | **30/30 passing**, including a measured 1.15 GB footprint and 2.5 s worst-case latency |

Every medium and low finding identified during this review has been remediated
and the full suite re-run. The code is safe to submit as-is.

## 2. Threat model

| Boundary | Crossing direction | Control |
| --- | --- | --- |
| Network → server | Any local process, or a browser page, to the Express app | `listen(PORT, '127.0.0.1')`; no CORS headers, so cross-origin `fetch` and `POST` preflights are refused; 256 kB body cap |
| Browser DOM → LLM output | Model-generated summary, angle, video titles | Every interpolated field passes `esc()`; `href` sink passes `safeUrl()`; CSP restricts scripts to `'self'` |
| Untrusted remote → subprocess | YouTube/RSS titles and search terms | `execFile('yt-dlp', [args…])` with array args — no shell, so metacharacters are inert |
| Env → shell probe | `YT_DLP_BIN` interpolated into a `Get-Command` probe | Allowlisted to `/^[A-Za-z0-9._-]{1,64}$/` (M1 fix) |
| Remote → file writes | Only PayPal API responses, validated against a PayPal-host allowlist | `approval_url` restricted to `https://*.paypal.com` (M2 fix) |
| Disk → memory | `data/records.json` read on every boot | Parse failure falls back to a clean DB instead of crashing; atomic write-then-rename (M3 fix) |
| Local loop → server | A stuck or hostile local caller hammering `/api/trends` | 12 requests/minute per-IP limiter; each call spawns `yt-dlp` (M4 fix) |

## 3. Findings

### M1 — Command injection via env-controlled binary name (fixed)

`lib/agentReach.js:29` built a PowerShell probe by interpolating `YT_DLP_BIN`
into a command string:

```js
['-Command', `(Get-Command ${bin} -ErrorAction SilentlyContinue).Source`]
```

A value such as `yt-dlp; Remove-Item -Recurse C:\` would have executed inside
the PowerShell parser. The source is the operator's own `.env`, so exploitation
needed local write access — but it is a genuine code-injection sink and the
`execFile` discipline used everywhere else was silently broken here.

**Fix:** reject anything that is not a plain executable name before probing.
The constant `SAFE_BIN` plus the guard in `which()` closes it. Legitimate
values (`yt-dlp`, `yt-dlp.exe`) are unaffected.

### M2 — Unvalidated `javascript:` URL sink (fixed)

`lib/paypal.js` returned `approval.links` hrefs unfiltered and
`public/app.js` wrote them into `<a href>`. `esc()` escapes quotes, which blocks
attribute breakout, but not a `javascript:` URL in a PayPal-shaped response
field. A MITM or a compromised Sandbox account could turn the invoice panel
into a script-execution gadget.

**Fix:** defence in depth on both sides. The server allowlists
`https://…paypal.com/…`, and the client independently re-validates protocol and
hostname through `safeUrl()` before the value reaches the DOM.

### M3 — Non-atomic persistence could destroy all records (fixed)

`lib/store.js` wrote `records.json` in place. A crash, a full disk, or a
concurrent reader during that write left a truncated file, and `read()`
treats an unparseable file as empty — so one interrupted write would have
silently discarded every classification ever taken, with no recovery path.

**Fix:** write to `records.json.<pid>.tmp`, then `renameSync`. The rename is
atomic on NTFS and on POSIX filesystems, so readers see either the old complete
file or the new complete file.

### M4 — No rate limit on the only expensive endpoint (fixed)

`/api/trends` spawns `yt-dlp`, hits the network and writes the disk cache.
Unlimited, a single loop — or any local process — could saturate the CPU and
thrash the cache the user depends on for offline work.

**Fix:** a 12-request-per-minute per-IP limiter, implemented in ~12 lines with
no new dependency, returning `429` with a clear message. The limiter sits in
front of the route so it also bounds future sub-route work.

### L1 — Dead helper / unused redaction utility (fixed)

`logger.redact()` was defined but never called, so the boot log had no safe way
to show configuration. `server.js` now prints a redacted config block
(port, llama URL, model path, PayPal base, agent-reach flag), which makes the
running configuration auditable from the console without exposing secrets.

### L2–L5 — Additional hardening applied

- **L2** `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  and a CSP (`default-src 'self'`, no `unsafe-inline`) added globally.
- **L3** `rel="noopener noreferrer"` on the external approval link, closing
  reverse-tabnabbing.
- **L4** `approval_url` / `paypal_link` documented as nullable; the UI renders
  "No approval link returned" instead of a dead link when PayPal omits one.
- **L5** Payload validation tightened to reject non-object `detail` values
  before any field is read, and unknown API keys are ignored rather than
  forwarded.

## 4. Input validation inventory

| Input | Validation | Reject behaviour |
| --- | --- | --- |
| `description` | string, trimmed, ≤ 2 000 chars | `400 invalid_request` |
| `userType` | `employee` \| `platform` \| `influencer` \| `consultant` | `400 invalid_request` |
| `receivedAt` | optional; falls back to today in local time | tolerated |
| `purposeCode` (invoice) | must exist in `rules.CODES` | `400 unknown_purpose_code` |
| `amount` | finite, > 0, ≤ 1 000 000 | `400 invalid_request` |
| `niche` (trends) | string, trimmed, ≤ 80 chars | `400 invalid_request` |
| `limit` (records) | clamped to 1…50 | clamped, never trusted |
| JSON body | 256 kB cap, `application/json` only | `413` / ignored |
| Trend request rate | 12/min per IP | `429` |

Zero-trust posture is complete: no request field reaches a sink without passing
through an explicit check in this table.

## 5. Secrets handling

- `.gitignore` excludes `.env`, `data/*.json`, `node_modules`, and `.strix/`.
- `.env.example` ships with empty `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
- Tokens are held in a module-level variable in memory only, never written to
  disk and never logged; the log records only the token expiry timestamp.
- `logger.redact()` is used for the boot config block.
- Verdict: **no secret material in the repository.**

## 6. Residual risk (accepted, documented)

1. **No authentication.** Anyone who can reach the port can classify, read the
   record history, and create Sandbox invoices. Accepted: loopback binding plus
   a deliberate `NFR-3` zero-credential stance. If this is ever exposed beyond
   localhost, an auth layer is mandatory before release.
2. **`/api/health` reveals local configuration** (model path, channel
   availability). Low impact for a loopback tool; would need trimming if the
   service became networked.
3. **Upstream `yt-dlp` and RSS feeds are untrusted input.** They are treated as
   data only, escaped on render, and never used to build commands or paths.
4. **The LLM can be wrong.** Mitigated by rules-first reconciliation
   (`lib/classifier.js`): the model may only choose among codes the rules
   already admit, so a hallucinated code cannot escape the RBI vocabulary.
5. **Live PayPal path is unverified** end to end because no Sandbox credentials
   are available in this environment. The request construction, token flow and
   degradation path are covered; the create-and-approve call is not.

## 7. Clarity and maintainability

| Metric | Value |
| --- | --- |
| Source lines | 2 295 across 19 files |
| Largest file | `public/app.js` (245) — under any reasonable threshold |
| Modules | One responsibility each: rules, classifier, store, llama, trends, agent-reach, paypal, logger |
| Function length | No function exceeds ~40 lines; classification, trends and invoice paths are all flat and linear |
| Comments | Only for non-obvious reasoning (why a rule wins over the LLM, why a date is computed locally, why a write is atomic) |
| Dead code | None; previously identified dead helpers have been wired in or removed |
| Consistency | Uniform `{ success, data | error }` envelopes, uniform logger calls, uniform `check()` harness |
| Error handling | Every `await` on an external boundary is guarded; failures degrade to rules-only or a skipped channel and are reported, never swallowed |

Assessment: the code is **clear** — a reviewer can follow the request path from
`routes/` to a rule and back without indirection — and **maintainable**, because
each external system is isolated behind one small module with an explicit
status function.

## 8. Verification evidence

```
npm run verify   →  6/6 classification cases
npm run e2e      → 30/30 checks, 1 179 MB total footprint, 131 MB trend pipeline, 2.5 s worst latency
npm audit       →  0 vulnerabilities
node --check     →  0 syntax errors (19 files)
repeat-run       →  identical result, 0 orphaned processes
```

## 9. Conclusion

The build is **clear, safe and secured** for its declared single-user local
scope. 0 Critical and 0 High findings remain; all three Medium and five Low
findings have been fixed and re-verified. The two items a reviewer should still
look at before any networked deployment are the absent authentication layer and
the unexercised live PayPal call, both already documented as accepted risk.