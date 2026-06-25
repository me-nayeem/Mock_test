# QueueStorm Warmup — Mock Preliminary Workflow

> **Hackathon:** SUST CSE Carnival 2026 — Codex Community Hackathon (Mock Preliminary Round)
> **Task:** CRM Ticket Classifier microservice (`GET /health`, `POST /sort-ticket`)
> **Window:** 1-hour rehearsal round

---

## 1. Problem Recap

Read one free-text customer complaint from a CRM ticket and return a structured
classification with:

| Field | Type | Source |
|---|---|---|
| `ticket_id` | string (echo) | request |
| `case_type` | enum | wrong_transfer \| payment_failed \| refund_request \| phishing_or_social_engineering \| other |
| `severity` | enum | low \| medium \| high \| critical |
| `department` | enum | customer_support \| dispute_resolution \| payments_ops \| fraud_risk |
| `agent_summary` | string (1–2 neutral sentences) | generated |
| `human_review_required` | boolean | derived: `severity==='critical' \|\| case_type==='phishing_*'` |
| `confidence` | float 0–1 | derived |

Hard rule: `agent_summary` must **never** ask for PIN / OTP / password / card number.
The grader auto-fails any response that does.

---

## 2. Tech Stack — Final Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js (ESM) | Already set in `package.json` (`"type":"module"`) |
| HTTP framework | **Express 5** | Familiar ecosystem, already installed |
| Validation | **zod 4** | Strict request/response schemas, already installed |
| Config | `dotenv` | Already installed; secrets out of repo |
| Classifier | **Track C (hybrid: rules → Gemini)** | Deterministic on easy cases, LLM only for ambiguous ones |
| LLM | **Gemini** (`gemini-2.0-flash`) via `@google/generative-ai` | Free tier, fast, structured JSON output via `responseSchema` |
| Cache | **In-process LRU** (`lru-cache` npm) | Zero infra, swap to Upstash later via single module |
| Deploy | **Render native Node service** | One-click GitHub deploy, free HTTPS, no Docker |

### Why NOT Docker for this project
- Native Node service deploys in ~30s vs Docker's longer cold start.
- Docker doesn't solve state — Redis would still need a managed service.
- Render free tier doesn't persist Docker container filesystem anyway.
- 1-hour window rewards speed of iteration, not infrastructure complexity.

---

## 3. Project Layout

```
backend/
├── package.json
├── .env.example                # PORT, GEMINI_API_KEY (optional), CACHE_TTL_S
├── .gitignore                  # node_modules, .env, .puku
├── Dockerfile                  # OPTIONAL — only for local parity / EC2
├── README.md                   # Runbook: local + Render deploy
├── workflow.md                 # ← this file
├── src/
│   ├── server.js               # Express bootstrap, middleware, routes, error handler
│   ├── config.js               # env loading + defaults
│   ├── routes/
│   │   ├── health.js           # GET /health
│   │   └── tickets.js          # POST /sort-ticket
│   ├── services/
│   │   ├── classifier.js       # Orchestrator: rules → fallback → safety → response
│   │   ├── rulesEngine.js      # Track A: keyword/phrase scoring
│   │   ├── llmClient.js        # Track B: Gemini call + JSON parse
│   │   ├── safetyFilter.js     # Output scrubber for PIN/OTP/password/card
│   │   ├── languageDetect.js   # bn / en / mixed detection
│   │   └── cache.js            # LRU get/set wrapper (swap to Upstash later)
│   ├── data/
│   │   └── keywords.json       # case_type → {phrases[], weight, severity, department}
│   ├── schemas/
│   │   ├── request.schema.js   # zod schema for POST /sort-ticket body
│   │   └── response.schema.js  # zod schema for response
│   └── utils/
│       ├── confidence.js       # score → 0..1 confidence helper
│       └── logger.js           # tiny request logger
└── tests/
    ├── samples.test.js         # 5 spec sample cases
    └── safety.test.js          # PIN/OTP leak regression
```

---

## 4. Request Flow — `POST /sort-ticket`

```
client
  │
  ▼
helmet + cors + json body parser
  │
  ▼
zod validate request body            ── fail → 400 with field errors
  │
  ▼
cache.get(ticket_id)                 ── hit → return cached response (200)
  │
  ▼
languageDetect(message)              ── bn / en / mixed
  │
  ▼
rulesEngine.score(message, locale)   ── {case_type, severity, department, hits, score}
  │
  ▼
if score.confidence < 0.6 AND GEMINI_API_KEY set
  │
  ▼
llmClient.classify(message, locale) ── zod-validate response shape
  │
  ▼
merge result (rules overrides on safety fields)
  │
  ▼
safetyFilter.scrub(agent_summary)    ── fail → rewrite to safe boilerplate, force human_review
  │
  ▼
human_review_required = (severity==='critical' || case_type==='phishing_*')
  │
  ▼
zod validate response                ── fail → 500 (should not happen)
  │
  ▼
cache.set(ticket_id, response, TTL)
  │
  ▼
200 JSON
```

---

## 5. Track C Logic — Rules vs LLM

### Track A (rules) — always runs first
- Tokenize, lowercase, strip punctuation, keep Unicode for Bangla.
- For each `case_type`, scan weighted phrase list from `data/keywords.json`.
- Score = `Σ(weight × phrase_hits)`.
- Pick top-scoring `case_type`; tie-break by severity priority.
- Map `case_type → severity → department` per the spec table.
- `confidence = topScore / (topScore + secondScore + α)` with floor 0.05.

### Track B (Gemini fallback)
- Only invoked when `confidence < 0.6` **and** `GEMINI_API_KEY` is present.
- Prompt includes: enum definitions, severity mapping, the safety rule.
- Use Gemini **structured output** (`responseMimeType: "application/json"` + `responseSchema`) — guarantees parseable JSON matching our enum exactly.
- Server-side **re-validate** with zod — never trust raw LLM output.
- If Gemini fails or returns invalid → fall back to rules result with `confidence` clamped to 0.3 (forces `human_review_required`).

### Track C merging rules
- Rules result is the **default** for `case_type`, `severity`, `department`.
- LLM result overrides **only** when `confidence` ≥ 0.75 AND value is a valid enum.
- Final `confidence` = max(rulesConfidence, llmConfidence).
- Final `agent_summary` = rules' summary if confidence ≥ 0.7, else LLM's summary (LLM writes better prose).

---

## 6. Safety Rule — Two Layers

### Layer 1: Output scrubber (`safetyFilter.js`)
Regex against generated `agent_summary`:
```
/(pin|otp|password|card\s*number|সার্ভিস\s*পিন|পাসওয়ার্ড|পিন)/i
```
If matched → replace with neutral boilerplate:
> "Customer's request was reviewed. Do not share your PIN, OTP, password, or card number with anyone — bKash will never ask for them."

Then force `human_review_required = true` and `confidence = min(confidence, 0.4)`.

### Layer 2: Regression test (`tests/safety.test.js`)
Loads a curated list of leaky prompt-injection messages and asserts:
- `agent_summary` never contains PIN/OTP/password/card.
- `human_review_required` is true for all phishing prompts.

---

## 7. Gemini Integration Plan

| Item | Value |
|---|---|
| SDK | `@google/generative-ai` (official) |
| Model | `gemini-2.0-flash` |
| Env var | `GEMINI_API_KEY` |
| Output mode | Structured JSON via `responseSchema` (zod-generated) |
| Timeout | 8s (well under 30s endpoint limit) |
| Retries | 1 retry on 5xx / network, no retry on 4xx |
| Quota | Free tier — track in logger; degrade gracefully if quota hit |

**Why structured output:** Gemini's `responseSchema` enforces our enums at the model
level, so we get valid JSON that almost passes zod without manual parsing.

---

## 8. Caching Strategy

| Key | `ticket_id` |
|---|---|
| Value | Full response object |
| TTL | 600s (10 min) — adjustable via `CACHE_TTL_S` env |
| Max entries | 500 |
| Backend | `lru-cache` (in-process) |
| Future swap | Single `cache.js` interface — `get/set/del` — Upstash adapter is one file |

Cache is checked **after** zod validation but **before** any expensive work, so
duplicate `ticket_id` requests return in <5ms.

---

## 9. Deployment Plan (Render)

1. Push repo to GitHub (public, per spec).
2. Render → New → **Web Service** → connect repo.
3. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Env vars in Render dashboard:
   - `PORT` (Render sets automatically)
   - `GEMINI_API_KEY` (optional — service runs in rules-only mode without it)
5. Deploy → copy public HTTPS URL → submit via Google Form.

**README runbook** will document local + Render paths so organizers can `git clone && npm i && npm start` if our live URL dies.

---

## 10. Definition of Done

- [ ] `GET /health` returns `{"status":"ok","uptime":...}` in <100ms.
- [ ] `POST /sort-ticket` handles all 5 spec sample cases with expected `case_type` + `severity`.
- [ ] Rules path p50 latency < 100ms.
- [ ] Gemini fallback path p95 latency < 5s.
- [ ] Safety test passes — no `agent_summary` ever asks for PIN/OTP/password/card.
- [ ] zod validation rejects malformed requests with 400 + helpful errors.
- [ ] Duplicate `ticket_id` returns cached response in <10ms.
- [ ] No secrets in repo (`.env` in `.gitignore`, `.env.example` provided).
- [ ] README runbook complete.
- [ ] Deployed on Render HTTPS, `/health` responds from public URL.
- [ ] `workflow.md` committed.

---

## 11. Out of Scope (1-hour window)

- Persistent DB (spec doesn't need one — single-shot classifier).
- Auth (not in spec).
- Rate limiting beyond Render's free-tier edge.
- Internationalization beyond bn/en/mixed detection.
- Observability beyond a simple request logger.

---

## 12. Next Step

Green-light from you → I'll scaffold the file tree (`mkdir`, `package.json` scripts,
`.env.example`, `.gitignore`) and implement in this order:
1. `server.js` + `/health` + zod schemas
2. `rulesEngine.js` + `keywords.json` (covers Track A fully)
3. `safetyFilter.js` + `tests/safety.test.js`
4. `llmClient.js` (Gemini integration)
5. `classifier.js` orchestrator (Track C merge)
6. `cache.js` (LRU wrapper)
7. `tests/samples.test.js` (5 spec cases)
8. `README.md` runbook
9. Render deploy
