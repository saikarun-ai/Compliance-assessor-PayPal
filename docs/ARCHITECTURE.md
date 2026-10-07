# Architecture

## Tech Stack

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| Inference | llama.cpp | Latest | CPU-only, GGUF, 4GB-friendly |
| Model | gemma-3-1b-it-Q4_K_M | — | Only local GGUF with reliable tool-calling under 1GB |
| Backend | Node.js + Express | 20+ LTS | ~50MB RAM |
| HTTP client | Node global `fetch` | Built-in | Zero extra deps (RULES: no packages >5MB) |
| Env loading | `node --env-file=.env` | Built-in | No dotenv dependency |
| Frontend | Vanilla HTML/CSS/JS | — | Zero build step |
| Trends | Agent Reach + yt-dlp | Latest | Zero-config YouTube, Exa when present |
| Payments | PayPal REST v2 | Sandbox | Invoicing API |
| Storage | JSON file | — | No external DB |

## Folder Structure

```
compliance-assessor/
├── docs/
│   ├── SRS.md
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── RULES.md
│   ├── DESIGN.md
│   ├── TASKS.md
│   └── MEMORY.md
├── server.js
├── routes/
│   ├── classify.js
│   ├── invoice.js
│   └── trends.js
├── lib/
│   ├── llama.js
│   ├── paypal.js
│   ├── agentReach.js
│   ├── classifier.js
│   ├── rules.js
│   ├── trends.js
│   ├── store.js
│   └── logger.js
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/
│   └── verify-classification.js
├── data/records.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Data Flow

**Freelancer:** user types → `POST /api/classify` → rule engine (+ llama.cpp
vote) → P0802 → `POST /api/invoice` → PayPal Sandbox → invoice approval link.

**Influencer:** user selects niche → `POST /api/trends` → yt-dlp + Exa →
llama.cpp synthesis → trend report → optional invoice.

## Classification Decision Path

```
description
  → lib/rules.js keyword engine  (deterministic, always runs)
  → lib/llama.js structured call (if llama-server is up)
  → lib/classifier.js reconcile:
        invalid code from LLM  → fall back to rule code
        non-export + EDF rule  → EDF is NEVER taken from the LLM
        otherwise              → LLM code wins if it is in the code table
```

EDF deadlines are computed in code from the purpose code, never from the model,
because a wrong filing date is worse than a wrong label.

## Resource Budget (4GB)

| Process | RAM |
|---------|-----|
| OS | ~1.0 GB |
| Browser | ~300 MB |
| Node.js | ~50 MB |
| llama.cpp | ~1.5 GB |
| Agent Reach | ~200 MB |
| **Total** | **~3.05 GB** |

## API Surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | llama.cpp + PayPal + Agent Reach readiness |
| POST | `/api/classify` | FR-1..FR-9 |
| POST | `/api/invoice` | FR-10..FR-14 |
| POST | `/api/trends` | FR-19..FR-26 |
| GET | `/api/records` | Stored compliance records |
| GET | `/api/codes` | Purpose code reference table |

All responses use `{ success, data, error }` per RULES.md.
