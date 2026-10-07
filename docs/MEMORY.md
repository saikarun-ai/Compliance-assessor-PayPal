# Memory Log

> Append-only. Update after every significant decision.

## Project Identity

- Name: Compliance Assessor
- Event: PayPal AI Hackathon 2026
- Deadline: Nov 12, 2026
- Local: http://localhost:3000
- LLM: http://localhost:8081 (8080 is owned by Oracle TNSLSNR on this machine)
- Repo: (set on first push)
- Demo video: `demo/compliance-assessor-demo.mp4` (7:00, AI-narrated via Windows SAPI "Zira", 16 slides)
- Live site: https://compliance-assessor.netlify.app/ (README, after all steps completed)

## Key Decisions

### 2026-10-06: llama.cpp over Ollama
Lower RAM (~1.5GB vs ~2GB). No daemon overhead.

### 2026-10-06: Qwen2.5 1.5B over Llama 3.2 1B
More reliable tool-calling JSON output.

### 2026-10-06: Vanilla HTML/CSS/JS
React adds ~150MB + build complexity. Single page suffices.

### 2026-10-06: Dropped Vercel
Serverless can't reach localhost. Local-only is cleaner.

### 2026-10-06: Agent Reach YouTube + Exa only
Zero-config, ~150-250MB. Reddit/XHS need browsers.

### 2026-10-06: Purpose Code in invoice_number
Format: `{CODE}-{YYYY}-{SEQ}` e.g. `P0802-2026-001` (25-char limit respected).

### 2026-10-06: gemma-3-1b-it-Q4_K_M replaces Qwen2.5 1.5B
Qwen2.5 1.5B is not present on this machine. Available local GGUFs:
gemma-3-1b-it (0.9GB, tool-calling OK) / DeepSeek-R1-Distill-Qwen-1.5B-Q6_K_L
(1.6GB, reasoning tokens break JSON) / Phi-3-mini-q4 (2.2GB, too heavy for 4GB).
Chose gemma-3-1b: smallest footprint with usable function calling.

### 2026-10-06: Rule engine is authoritative, LLM is a second opinion
A 1B model cannot be trusted to compute EDF deadlines or spot non-export
platform income. `lib/rules.js` decides; `lib/llama.js` is allowed to override
only with a valid code from the table. Guarantees the 6 SRS-10 cases pass with
llama.cpp switched off.

### 2026-10-06: Dropped axios and dotenv
Node 24 has global `fetch` and `--env-file`. One dependency total (express).

## Environment Facts (this machine)

- Windows 11 native, PowerShell 5.1, i5-12500, 15.7GB RAM (5.8GB free at build time)
- Node v24.16.0, npm 11.13.0, Python 3.13.15 + Pillow 12.3.0 (demo renderer)
- `agent-reach` + `yt-dlp 2026.08.19` installed; `rss` channel OK
- `mcporter` installed globally (0.14.2); `exa` server NOT registered (needs `EXA_API_KEY` + `mcporter add`)
- `git` not on PATH
- `llama-server` binaries only at `C:\Users\Admin\AppData\Local\Temp\opencode\llama-bin` (deleted between runs) — set `LLAMA_BIN_DIR`
- `npm audit`: 0 vulnerabilities / 68 packages (only dependency: express)
- ffmpeg via `imageio-ffmpeg` (no ffprobe); SAPI voices David/Zira

## Measured Numbers (docs quote these)

- Total working-set with llama up: 1166 MB (llama 1047 + express ~53–66) — under the 2 GB E2E assertion / 3.6 GB SRS limit
- Trend pipeline (Node procs only): 119 MB — under the FR-23 250 MB budget
- Classification (llm+rules): avg 4598 ms, worst 5056 ms — under the 8 s NFR-2 budget
- Trend report: first call 31313 ms (llm used), cached 24 h after
- E2E checks executed: 30/30 · Invoice (mock PayPal): 19/19 · Unit (verify): 6/6 · npm audit: 0 vulns

## Technical Quirks

### llama.cpp
- Port 8081 (8080 owned by Oracle TNSLSNR); env precedence verified: OS env wins over `.env`
- `--ctx-size 2048` keeps KV cache <500MB
- `--threads 4` for this i5-12500
- `POST /v1/chat/completions` with `response_format: { type: 'json_object' }`
- Ollama-style `/api/chat` also accepted; `/completion` used as last resort

### PayPal Sandbox
- OAuth token expires 8h; cache in memory
- Invoice must be DRAFT before send
- `invoice_number` max 25 chars
- Base: https://api-m.sandbox.paypal.com
- `approval_url` must match `/^https:\/\/[a-z0-9.-]*paypal\.com\//i` (server + client)
- Invoice-numbering FR-12 fix: `issued_invoices` ledger in `lib/store.js`; `nextSequence()` scans BOTH `compliance_records` and `issued_invoices` (standalone invoices kept duplicating `P0802-2026-001`)

### Agent Reach
- yt-dlp writes to /tmp/ by default
- Auto-subs have rolling duplication — dedupe by video id
- Exa: `mcporter call exa.web_search_exa`
- `agent-reach doctor --json` for status
- SAFE_BIN allowlist `/^[A-Za-z0-9._-]{1,64}$/` rejects crafted `YT_DLP_BIN`/`MCPORTER_BIN`
- Windows: `.cmd` shims need `windowsVerbatimArguments: true` + doubled quotes; `resolveExecutable()` probes PATHEXT extensions before the bare name

### Purpose Codes
- P0802: Software consultancy
- P0807: Off-site software exports
- P1006: Business consulting
- P1007: Advertising (influencers)
- P1401: Compensation of employees
- Platform revenue: non-export

## Open Questions

- [x] Does gemma-3-1b hold JSON format for all 6 cases? — yes, `npm run verify` 6/6 (tokenized personality, impatient/flexible)
- [ ] Exa rate limit during demo? — server not registered; YouTube-only fallback is the plan
- [ ] Sandbox downtime during judging? — mock server covers the flow locally

## Key Exchanges

**Q: Is PayPal integration helpful?**
A: Partially. Client familiarity feature, not compliance solution.

**Q: Better idea?**
A: Yes — Filing Agent that auto-generates EDF data. Assessor becomes a feature.

**Q: 4GB laptops?**
A: Yes, llama.cpp + small Q4_K_M. Drop Ollama, Open WebUI, Red Hat.

**Q: Agent Reach?**
A: YouTube + Exa only. Zero-config, ~150-250MB.

## Next Session Checklist

Read in order:
1. MEMORY.md (this)
2. TASKS.md
3. RULES.md
4. ARCHITECTURE.md
5. DESIGN.md
6. PRD.md
7. SRS.md

Then check:
- [x] llama-server :8081 running? (binaries in temp dir; `npm run llama` or `setup` script)
- [x] `agent-reach doctor` OK?
- [x] PayPal credentials valid? (no live creds; mock covers flow)
- [x] Next unchecked TASKS.md item?
