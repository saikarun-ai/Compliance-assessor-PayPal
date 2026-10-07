# Tasks

## Phase 0: Setup (Day 1)

- [x] Install llama.cpp (`llama-server` binary)
- [x] Select local GGUF — `gemma-3-1b-it-Q4_K_M.gguf` (Qwen2.5 1.5B unavailable)
- [x] Start llama-server :8081 (8080 is taken by Oracle TNSLSNR on this machine)
- [x] Verify structured JSON output (`npm run verify` → 6/6)
- [x] Install Agent Reach (`agent-reach doctor` → YouTube OK)
- [x] Install `mcporter` globally (Exa: server not registered — needs `EXA_API_KEY` + `mcporter add`; degrades gracefully)
- [x] PayPal Developer account (Sandbox downblocker mocked — see verify:invoice)
- [x] Obtain Sandbox credentials (blocked: no live creds issued; mock server covers the flow)
- [x] `npm init` + install express

## Phase 1: Backend (Day 2–3)

- [x] server.js with Express
- [x] Static files from public/
- [x] lib/logger.js
- [x] lib/llama.js
- [x] lib/rules.js
- [x] lib/classifier.js
- [x] lib/store.js
- [x] routes/classify.js
- [x] scripts/verify-classification.js — 6 cases
- [x] lib/paypal.js
- [x] routes/invoice.js
- [x] Test Sandbox invoice (blocked: no credentials) — replaced by `scripts/mock-paypal.js` + `scripts/verify-invoice.js` (19/19), incl. the FR-12 sequence-increment bug it caught and fixed
- [x] invoice_number format: `P0802-2026-001`

## Phase 2: Agent Reach (Day 3–4)

- [x] lib/agentReach.js
- [x] YouTube search wrapper (yt-dlp)
- [x] Subtitle extraction + dedupe
- [x] Exa wrapper (mcporter, optional)
- [x] lib/trends.js — synthesis + pricing bands
- [x] routes/trends.js
- [x] 24h disk cache for reports
- [x] Verify RAM < 3.6 GB with llama.cpp running (1180 MB total: llama 1048 + server ~72 + runner 59)

## Phase 3: Frontend (Day 4–5)

- [x] public/index.html
- [x] public/style.css
- [x] public/app.js
- [x] User type selector
- [x] Chat input + send
- [x] Result card rendering
- [x] PayPal link display
- [x] Trend report display

## Phase 4: Polish (Day 5–6)

- [x] Error handling envelope
- [x] Loading states
- [x] EDF color coding
- [x] llama.cpp fallback
- [x] Test 6 cases (see README)
- [x] Test influencer flow
- [x] No console errors

## Phase 5: Docs & Demo (Day 6–7)

- [x] README.md (written last, per ISO/IEC/IEEE 29150 structured)
- [x] .env.example (port 8081 + LLAMA_BIN_DIR)
- [x] Demo video (`demo/compliance-assessor-demo.mp4`, 7:00, AI-narrated, 16 slides)
- [x] Run scripts: `setup` / `run` / `health` / `test` / `stop` (`.bat` / `.sh` / `.ps1`)
- [x] E2E suite (`scripts/e2e.js`) — 30/30 incl. FR-15/17/21/23 + NFR-1/NFR-2
- [x] Security review (`docs/SECURITY-REVIEW.md`) + fixes (SAFE_BIN allowlist, CSP, rate limit, atomic writes, approval_url allowlist, log redaction)
- [x] IEEE 29148 evaluation (`docs/IEEE-29148-EVALUATION.md`)
- [ ] Upload to video host
- [ ] Devpost submission
- [ ] Submit before Nov 12

## Backlog

- [ ] Reddit channel (needs 8GB)
- [ ] Xiaohongshu
- [ ] PA-CB integration
- [ ] Real EDF filing
- [ ] Multi-user
- [ ] Mobile

## Blockers

| Blocker | Workaround |
|---------|-----------|
| Small-model misclassification | Rule engine is authoritative; LLM only validates |
| Sandbox rate limits | Cache OAuth token in memory for 8h |
| Exa free limits / missing mcporter | YouTube-only report + 24h disk cache (mcporter installed; server not registered) |
| No live PayPal Sandbox credentials | `mock:paypal` + `verify:invoice` cover token + invoice flows (19/19) |
| No llama-server during judging | Rules-only mode, `/api/health` says so |
