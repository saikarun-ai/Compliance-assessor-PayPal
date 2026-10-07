# SRS — Compliance Assessor

Software Requirements Specification for the **Compliance Assessor**: an airgapped,
AI-powered agent that classifies cross-border payments under RBI Purpose Code
guidelines, creates PayPal Sandbox invoices carrying that classification, and
generates influencer trend reports via Agent Reach.

Version 3.1 · PayPal AI Hackathon 2026 · Target hardware: 4GB RAM, CPU-only.

---

## SRS-1. Introduction

### SRS-1.1 Purpose

This SRS defines the functional and non-functional requirements for a
**Compliance Assessor** — an AI agent serving two user groups:

1. **Freelancers & Startups** — classify cross-border payment transactions under
   RBI Purpose Code guidelines and create PayPal Sandbox invoices.
2. **Influencers** — generate real-time social media trend reports using Agent
   Reach for data-driven content decisions and brand deal pricing, while keeping
   the same compliance and invoicing capabilities.

### SRS-1.2 Scope

The system:
- Accepts natural-language service descriptions.
- Classify transactions with RBI Purpose Codes (P0802, P0807, P1006, P1007, P1401).
- Determine EDF filing requirements and deadlines.
- Create PayPal Sandbox invoices with embedded compliance metadata.
- Generate real-time trend reports via YouTube + Exa web search.
- Run fully airgapped on **4GB RAM**, CPU-only (no cloud LLM).
- Provide a single self-contained webpage for demonstration.

### SRS-1.3 Deployment Philosophy

Local-first execution over cloud deployment. Judges may clone the repository and
run locally, or watch the recorded demo video. No Vercel/Netlify deployment.

### SRS-1.4 Regulatory Context

- RBI Purpose Codes are mandatory for all cross-border remittances.
- P0802 — Software Consultancy.
- P0807 — Off-Site Software Exports.
- P1006 — Business Consultancy.
- P1007 — Advertising / Market Research (influencer brand deals).
- P1401 — Compensation of Employees.
- Platform-side revenue (e.g. YouTube AdSense payouts) is a **non-export of
  services** in RBI terms, therefore **no EDF filing**.

---

## SRS-2. Overall Description

### SRS-2.1 Product Perspective

A local-first AI application sitting between the user and PayPal's payment
infrastructure. It does not move or hold funds. It produces structured
compliance outputs and, for influencers, augments them with real-time trend
intelligence.

### SRS-2.2 User Classes

| User Type | Description | Primary Need | Agent Reach Role |
|-----------|-------------|--------------|------------------|
| **Freelancer** | Developers, designers, consultants | Compliance + Invoicing | Optional |
| **Startup** | SaaS, small exporters | Compliance + Invoicing | Optional |
| **Influencer** | Content creators, brand deals | Revenue + Growth + Compliance | **Core** |

### SRS-2.3 Design Constraints

| Constraint | Description |
|------------|-------------|
| PayPal API limitation | No native RBI Purpose Code field; code must be encoded in `invoice_number` |
| Hardware floor | 4GB RAM, CPU-only |
| Model size | 1B–2B GGUF at Q4_K_M |
| Tool calling | Model must support function calling |
| Airgapped | No cloud LLM APIs |
| RAM budget | Agent Reach limited to YouTube + Exa |

### SRS-2.4 Assumptions

- llama.cpp available locally (`llama-server`).
- PayPal Sandbox credentials (free).
- GGUF model available locally.
- Dedicated burner accounts for Agent Reach channels.

---

## SRS-3. Hardware Requirements

### SRS-3.1 Minimum Hardware (4GB Target)

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 4 GB | 8 GB |
| Disk | 6 GB free | 10 GB free |
| CPU | 2 cores | 4+ cores |
| GPU | Not required | Not required |

### SRS-3.2 Memory Allocation (4GB System)

| Component | RAM |
|-----------|-----|
| OS | ~1.0 GB |
| Browser | ~300 MB |
| Node.js | ~50 MB |
| llama.cpp | ~1.5 GB |
| Agent Reach | ~200 MB |
| **Total** | **~3.05 GB** |

### SRS-3.3 Disk Space

| Item | Size |
|------|------|
| llama.cpp binary | ~50 MB |
| GGUF (1B–1.5B Q4_K_M) | ~0.8–1.6 GB |
| Agent Reach | ~200 MB |
| node_modules | ~50 MB |
| Demo video | ~200 MB |
| **Total** | **~2.2 GB** |

---

## SRS-4. Software Requirements

### SRS-4.1 Operating System

Ubuntu 22.04/24.04 (primary), macOS 13+, Windows 10/11 via WSL2 or native
PowerShell (verified on native Windows — Node 24, i5-12500).

### SRS-4.2 Core Runtime

llama.cpp (latest), Node.js 20/22+ LTS, Python 3.10+ (for yt-dlp / Agent Reach).

### SRS-4.3 AI Model

Local models available on this machine (folder `D:\Gen AI Applications\LLMS`):

| Model | RAM (Q4) | Tool Calling | Verdict |
|-------|----------|--------------|---------|
| **gemma-3-1b-it-Q4_K_M** | ~0.9 GB | Yes | **Selected** — best 4GB headroom |
| DeepSeek-R1-Distill-Qwen-1.5B-Q6_K_L | ~1.6 GB | Weak | Rejected — reasoning tokens hurt JSON reliability |
| Phi-3-mini-4k-instruct-q4 | ~2.2 GB | Yes | Rejected — too tight on a 4GB box |
| ggml-model-i2_s / imgmodel_* | — | No | Rejected — test or image models |

Model choice is enforced by `lib/classifier.js`: the LLM proposes a code, the
deterministic rule engine validates it. A misclassification or a dead LLM
degrades to rules-only, never to a crash (see SRS-5.1 NFR-3).

### SRS-4.4 Agent Reach Channels

| Channel | Backend | RAM | Auth | Status on this machine |
|---------|---------|-----|------|-------------------------|
| YouTube | yt-dlp | ~100–150 MB | None | OK (yt-dlp 2026.08.19) |
| Exa Search | mcporter | ~50–100 MB | None | Not installed — graceful skip |
| RSS | feedparser | ~20 MB | None | OK (bonus channel) |

### SRS-4.5 Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| LLAMA_SERVER_URL | Yes | `http://localhost:8080` |
| LLAMA_MODEL_PATH | Yes | — |
| PAYPAL_CLIENT_ID | Yes | — |
| PAYPAL_CLIENT_SECRET | Yes | — |
| PAYPAL_BASE_URL | No | `https://api-m.sandbox.paypal.com` |
| AGENT_REACH_ENABLED | No | `true` |
| PORT | No | `3000` |

---

## SRS-5. Functional Requirements

### SRS-5.1 Assessor Classification

| ID | Requirement |
|----|-------------|
| FR-1 | Accept natural-language service description |
| FR-2 | Classify `employee` as P1401 |
| FR-3 | Classify `platform` income as non-export (no EDF) |
| FR-4 | Map software to P0802 or P0807 |
| FR-5 | Map influencer/brand deals to P1007 |
| FR-6 | Map consulting to P1006 |
| FR-7 | Output `edf_required` and `edf_deadline_type` |
| FR-8 | Software: 30-day deadline from month-end |
| FR-9 | Non-software: on/before payment receipt |

### SRS-5.2 PayPal Integration

| ID | Requirement |
|----|-------------|
| FR-10 | OAuth 2.0 Sandbox authentication |
| FR-11 | Create draft invoices |
| FR-12 | Embed Purpose Code in `invoice_number` (e.g. `P0802-2026-001`) |
| FR-13 | Store Purpose Code in `detail.memo` |
| FR-14 | Return invoice approval link |

### SRS-5.3 Web Interface

| ID | Requirement |
|----|-------------|
| FR-15 | Single page on `localhost:3000` |
| FR-16 | Chat-style input |
| FR-17 | Display classification results |
| FR-18 | Display PayPal invoice link |

### SRS-5.4 Influencer Trend Intelligence

| ID | Requirement |
|----|-------------|
| FR-19 | Use Agent Reach YouTube channel (yt-dlp) |
| FR-20 | Use Agent Reach Exa web search |
| FR-21 | Channels zero-config (no browser, no cookie jar) |
| FR-22 | Combine YouTube + Exa for report generation |
| FR-23 | Trend pipeline ≤ 250 MB RAM |
| FR-24 | Report includes platforms, sentiment, angle, engagement |
| FR-25 | Suggest brand deal pricing bands |
| FR-26 | No external API fees |

### SRS-5.5 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Total RAM ≤ 3.6 GB with llama.cpp running |
| NFR-2 | Classification response < 8 s |
| NFR-3 | Graceful degradation when llama.cpp, Exa, or PayPal are unavailable |
| NFR-4 | No credentials in source control |
| NFR-5 | All external calls wrapped in try/catch and logged with timestamps |

---

## SRS-6. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Local Machine (4GB RAM, CPU-Only)              │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │ Browser  │───▶│ Node.js  │───▶│  llama.cpp Server    │  │
│  │ :3000    │    │ Server   │    │  :8080 (1B Q4_K_M)   │  │
│  └──────────┘    └────┬─────┘    └──────────────────────┘  │
│                       │                                      │
│         ┌─────────────┴─────────────┐                       │
│         ▼                           ▼                       │
│  ┌──────────────┐          ┌──────────────────┐            │
│  │ PayPal       │          │  Agent Reach     │            │
│  │ Sandbox API  │          │  - yt-dlp        │            │
│  │              │          │  - Exa (optional)│            │
│  └──────────────┘          └──────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## SRS-7. Data Model

`data/records.json` holds both shapes under `compliance_records` and
`trend_reports` (SQL equivalents for reference):

```sql
CREATE TABLE compliance_records (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,
  description TEXT NOT NULL,
  purpose_code TEXT NOT NULL,
  edf_required BOOLEAN NOT NULL,
  edf_deadline TEXT,
  paypal_invoice_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trend_reports (
  id TEXT PRIMARY KEY,
  niche TEXT NOT NULL,
  trend_summary TEXT,
  top_platforms TEXT,
  sentiment TEXT,
  content_angle TEXT,
  pricing_band TEXT,
  raw_data TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## SRS-8. Installation

### 8.1 llama.cpp

```bash
# Windows (prebuilt CPU binary)
# Linux / macOS
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make
./llama-server -m models/gemma-3-1b-it-Q4_K_M.gguf \
  --ctx-size 2048 --threads 2 --port 8080
```

### 8.2 Agent Reach

```bash
agent-reach install --env=auto
agent-reach doctor --json
# Expected: youtube OK, exa_search OK
```

### 8.3 Project

```bash
git clone https://github.com/your-repo/compliance-assessor.git
cd compliance-assessor
npm install
cp .env.example .env
npm start
```

---

## SRS-9. Demo Script

**Freelancer:** "I built a React dashboard for a US client for $2000"
→ P0802, EDF Nov 30, PayPal invoice link.

**Influencer:** niche "AI productivity tools"
→ Trend summary, sentiment, content angle, pricing band $800–$1,200.

---

## SRS-10. Verification

| Input | Expected |
|-------|----------|
| Software dev for US client | P0802 |
| SaaS revenue from EU | P0807 |
| Brand sponsorship UK | P1007 |
| Business consulting Dubai | P1006 |
| YouTube ad revenue | Non-export |
| Remote salary US | P1401 |

---

## SRS-11. Hackathon Checklist

| Requirement | Status |
|-------------|--------|
| PayPal integration | Sandbox Invoicing |
| AI integration | llama.cpp + GGUF |
| Working prototype | Local web app |
| Influencer component | Agent Reach |
| Deadline | Nov 12, 2026 |

---

## SRS-12. Limitations

- No real EDF filing.
- No PA-CB fund settlement.
- Sandbox PayPal only.
- No mobile app.
- No cloud deployment.
- No Reddit / Xiaohongshu channels.
- No streaming inference.

---

## SRS-13. Security

| Concern | Mitigation |
|---------|-----------|
| PayPal credentials | `.env`, gitignored, never logged |
| Agent Reach cookies | Dedicated burner accounts |
| Account ban risk | Documented by Agent Reach; read-only channel usage |
| Local data | `data/` stored locally only |
| Network | llama.cpp binds `127.0.0.1` only |

---

## SRS-14. References

- PayPal AI Hackathon: https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/
- Agent Reach: https://github.com/Panniantong/agent-reach
- llama.cpp: https://github.com/ggerganov/llama.cpp
- RBI Master Direction on Exports of Goods and Services (purpose codes, Form A1)

---

## SRS-15. Appendix: Command Reference

```bash
# YouTube
yt-dlp "ytsearch20:AI productivity tools" --get-title,view_count
yt-dlp --write-auto-sub --skip-download -o "/tmp/%(id)s" "URL"

# Exa
mcporter call exa.web_search_exa query="influencer marketing 2026" numResults=5

# Diagnostics
agent-reach doctor --json
agent-reach doctor --channel youtube
```
