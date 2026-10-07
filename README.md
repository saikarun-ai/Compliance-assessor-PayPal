# Compliance Assessor

A local-first AI agent that classifies cross-border payments against **RBI
Purpose Code** guidelines, computes **EDF filing deadlines**, creates **PayPal
Sandbox invoices** that carry the classification, and generates real-time
**influencer trend reports** — entirely airgapped, CPU-only, on a 4 GB laptop.

> Built for the **PayPal AI Hackathon 2026**. Deadline: Nov 12, 2026.
> This README is organised around the **ISO/IEC/IEEE 29150:2018** system life
> cycle process categories (system definition → design → realization →
> integration → verification → validation → operation → support → retirement →
> technical management).

---

## 1. System Definition

### 1.1 Purpose

Inbound cross-border money (freelance fees, SaaS exports, brand deals,
salaries) must be reported with an RBI Purpose Code, and services earning
above the exemption threshold need an **EDF (Export Declaration Form)** by a
deadline that differs by category. Doing this manually is error-prone and
auditable. Compliance Assessor turns a chat message into a deterministic,
registry-coded compliance decision plus a ready-to-send invoice.

Two user classes (see `docs/SRS.md` §2.2):

| User | Primary need | Agent Reach role |
|---|---|---|
| Freelancer / Startup | Compliance + invoicing | Optional |
| Influencer | Revenue + growth + compliance | Core (trend reports) |

### 1.2 Scope

- **Functional requirements:** 26 (classification, EDF deadlines, invoicing,
  web UI, trend intelligence) — `docs/SRS.md` §5.
- **Non-functional requirements:** 5 (RAM ≤ 3.6 GB, latency < 8 s, graceful
  degradation, no secrets in VCS, wrapped external calls) — `docs/SRS.md` §5.5.
- **Non-goals:** no real EDF filing, no PA-CB settlement, no multiuser,
  no mobile, no cloud LLM (`docs/SRS.md` §12).

### 1.3 Standards and references

- Requirements: **ISO/IEC/IEEE 29148:2018** — evaluated in
  `docs/IEEE-29148-EVALUATION.md` (clause-structured) and
  `docs/REQUIREMENTS-EVALUATION.md` (scorecard, 29/31 fully verified).
- System life cycle: **ISO/IEC/IEEE 29150:2018** (this README's structure)
  and ISO/IEC/IEEE 15288 process vocabulary.
- Security: `docs/SECURITY-REVIEW.md` — MITRE/CWE-style review, 0 open findings.
- RBI Purpose Codes / FEMA — `docs/RULES.md`.

---

## 2. System Design

### 2.1 Architecture

```
┌────────────────────────────────────────────────────────────────┐
│               Local machine (4 GB RAM, CPU-only)               │
│                                                                │
│   Browser :3000 ──▶ Express server ──▶ llama.cpp :8081 (GGUF)  │
│                            │                                   │
│                    ┌───────┴────────┐                          │
│                    ▼                ▼                          │
│              PayPal Sandbox   Agent Reach                      │
│              (invoicing)      · YouTube (yt-dlp)               │
│                                · Exa search (optional)         │
│                                · RSS (bonus)                   │
└────────────────────────────────────────────────────────────────┘
```

Rule engine in `lib/rules.js` is **authoritative**; the 1B-parameter local LLM
(`gemma-3-1b-it-Q4_K_M.gguf`) is a *second opinion* limited to valid codes, so
the six acceptance cases pass even with the model switched off (`docs/MEMORY.md`).

### 2.2 Purpose codes

| Code | Meaning | EDF deadline |
|---|---|---|
| P0802 | Software consultancy | month-end + 30 days |
| P0807 | Off-site software exports | month-end + 30 days |
| P1006 | Business consulting | on/before receipt |
| P1007 | Advertising / brand deals | on/before receipt |
| P1401 | Compensation of employees | on/before receipt |
| NON_EXPORT | Platform / ad revenue | no EDF |

### 2.3 Repository layout

```
server.js            Express bootstrap, security headers, rate limiting
lib/                 rules, classifier, llama, paypal, agentReach, store, logger
routes/              classify.js, invoice.js, trends.js
public/              single-page chat UI (index.html, style.css, app.js)
scripts/             verify, e2e, mock-paypal, setup-check, health-check, …
run/.bat/.sh/.ps1    setup · run · health · test · stop for each shell
demo/                narrated 7-minute demo video + renderer
docs/                SRS, PRD, RULES, ARCHITECTURE, evaluation docs, memory
data/                local records + trend cache (gitignored)
```

---

## 3. Realization

### 3.1 Prerequisites

- **Node.js ≥ 20.6** (verified on Node 24, Windows 11 native PowerShell)
- **llama.cpp** `llama-server` (CPU build) — or skip it: the app degrades to
  rules-only and `/api/health` says so
- A GGUF model, e.g. `gemma-3-1b-it-Q4_K_M.gguf` (~769 MB)
- Optional: **yt-dlp** (YouTube channel), **mcporter** + Exa server (search
  channel), **PayPal Sandbox credentials** (invoicing; preview works without)

### 3.2 Install & configure

```bash
npm install
cp .env.example .env     # then edit: port, model path, LLAMA_BIN_DIR, PayPal
```

Key variables (`docs/SRS.md` §4.5): `LLAMA_SERVER_URL=http://127.0.0.1:8081`
(8080 is often taken by Oracle TNSLSNR), `LLAMA_MODEL_PATH`,
`LLAMA_BIN_DIR`, `PAYPAL_CLIENT_ID`/`SECRET`, `PORT`.

### 3.3 One-command scripts

Each shell has a matching script; pick per platform:

| Task | Windows | macOS/Linux |
|---|---|---|
| Setup & health check | `setup.bat` | `./setup.sh` |
| Start (auto-starts llama if present) | `run.bat` | `./run.sh` |
| Health | `health.bat` | `./health.sh` |
| Full test suite | `test.bat` | `./test.sh` |
| Stop everything | `stop.bat` | `./stop.sh` |

`run.*` also accepts a `rules-only` flag to start without the model.

---

## 4. Integration & Verification

`npm test` runs the whole suite: `verify` && `verify:invoice` && `e2e`.

| Suite | What it proves | Result |
|---|---|---|
| `npm run verify` | six SRS-10 classification acceptance cases | **6/6** |
| `npm run verify:invoice` | PayPal OAuth → draft invoice → approval link via a local mock Sandbox (incl. negative cases) | **19/19** |
| `npm run e2e` | every FR + NFR (30 checks), boots real llama.cpp | **30/30** |
| `npm audit` | supply-chain | **0 vulnerabilities / 68 packages** |

Measured on the demo machine (i5-12500, 16 GB, CPU-only):

| Metric | Limit | Measured |
|---|---|---|
| Total agent footprint (llama up) | 3.6 GB | **1.14 GB** |
| Trend pipeline (Node procs) | 250 MB | **119 MB** |
| Classification latency | 8 000 ms | **5 056 ms** worst |
| Trend report (first call) | — | ~31 s (cached 24 h after) |

E2E runs against an isolated temp data dir so invoice sequence and record-count
assertions are deterministic run-over-run.

---

## 5. Validation

The `docs/SRS.md` §10 acceptance table (six inputs → expected codes) is the
agreed validation contract and passes 6/6. Per-requirement evidence is in
`docs/REQUIREMENTS-EVALUATION.md` §3 (forward + backward trace).

**Known environment blockers** (labelled `PARTIAL`, never inflated; see
`docs/TASKS.md`):

- Live PayPal Sandbox call — no credentials were issued; a byte-accurate local
  mock covers the full OAuth → invoice → approval-link surface (19/19).
- FR-18 rendered invoice card — no browser-automation harness; covered by static
  review + payload assertions.
- FR-20 Exa search — `mcporter` installed but needs an Exa API key/registration;
  the report skips the channel gracefully (asserted in E2E).

---

## 6. Operation

```bash
npm start              # or run.bat / ./run.sh
# open http://localhost:3000
```

Try:

> **Freelancer** — *"I built a React dashboard for a US client for $2000"*
> → P0802, EDF Nov 30, PayPal invoice link.

> **Influencer** — niche *"AI productivity tools"*
> → trend summary, sentiment, content angle, engagement, pricing band
> (e.g. $455–878) from YouTube + RSS.

Endpoints: `POST /api/classify`, `POST /api/invoice`, `POST /api/invoice/preview`,
`POST /api/trends`, `GET /api/trends/doctor`, `GET /api/health`.

---

## 7. Support & Maintenance

- **Logs:** structured JSON with timestamps on stdout; PII/credentials are
  redacted (`lib/logger.js`, NFR-5).
- **Local LLM fallback:** model down ⇒ rules-only mode, surfaced in
  `/api/health` and in every classification (`decided_by`).
- **Cache:** trend reports cached to disk for 24 h (`TREND_CACHE_HOURS`),
  PayPal OAuth token cached in memory for its 8 h lifetime.
- **Config:** all knobs are `.env` variables — no code edit needed to point at a
  different model, port, or PayPal environment.
- **Re-running:** `stop.bat`/`./stop.sh` kills the whole process tree
  (Windows needs `taskkill /T` because `llama-server.exe` re-parents).
- **Maintainer notes:** `docs/MEMORY.md` (decisions + machine facts), run
  `npm test` after any change.

---

## 8. Retirement & Cleanup

- Nothing is deployed; deletion = deleting the folder + `data/`. No cloud state.
- `.env` includes local credentials — it is gitignored and left behind on
  purpose (`NFR-4`). Never commit `.env`.

---

## 9. Technical Management (Quality, Risk, Configuration)

| Area | Evidence |
|---|---|
| Requirements quality | `docs/REQUIREMENTS-EVALUATION.md` (9-characteristic matrix, all Y) |
| Traceability | §3 of the same doc — 31/31 forward + backward, no orphans |
| Security | `docs/SECURITY-REVIEW.md` — fixed command-injection allowlist (SAFE_BIN), CSP/security headers, per-IP rate limit on `/api/trends`, atomic store writes, PayPal `approval_url` host allowlist, log redaction |
| Configuration mgmt | versioned packages (`package-lock.json`), `.env.example` mirrors all runtime knobs |
| Risk | environment blockers documented in `docs/TASKS.md` `Blockers` table with workarounds |
| Demo asset | narrated walkthrough of every module: `demo/compliance-assessor-demo.mp4` (7:00, AI voice, 16 slides) |

---

## 10. Live Demo

After all steps above are completed, the project is browsable online at:

### https://compliance-assessor.netlify.app/

*Note: the hosted site is a static showcase of the single-page UI and docs.
The full app (classification, invoicing, trend reports) runs locally against
the local LLM and PayPal Sandbox as described above — the Netlify URL
complements the repo but does not replace the local, airgapped deployment.*

---

## Appendix — docs index

| File | Content |
|---|---|
| `docs/SRS.md` | Software requirements specification (26 FR + 5 NFR, acceptance table) |
| `docs/PRD.md` | Product requirements / business context |
| `docs/RULES.md` | RBI purpose-code and EDF rule table (single source of truth) |
| `docs/ARCHITECTURE.md` | Component/process architecture |
| `docs/DESIGN.md` | UI/UX and interaction notes |
| `docs/REQUIREMENTS-EVALUATION.md` | 29148 scorecard, traceability, metrics |
| `docs/IEEE-29148-EVALUATION.md` | Clause-map evaluation vs ISO/IEC/IEEE 29148 |
| `docs/SECURITY-REVIEW.md` | Security review + all fixes |
| `docs/TASKS.md` | Task tracker, blockers, remaining items |
| `docs/MEMORY.md` | Decisions log + machine facts + measured numbers |
| `demo/generate.py` + `demo/compliance-assessor-demo.mp4` | Demo video renderer + output |

License: MIT.