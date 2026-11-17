# Sentinel — Responsible AI incident triage with safe rollback

A local AI agent that reads application logs, finds the likely root cause, and proposes a fix from an approved runbook.
It **never changes anything on its own** — every restart, rollback or failover waits for a named human approver.

- Local model: **Qwen3 4B via Ollama** (`qwen3:4b` on port 11434)
- Backend: **Python + FastAPI**, **MySQL** for incidents and the trace log, **Chroma** for runbook search
- Frontend: **Next.js + Framer Motion** console with scroll-driven sections and a live pipeline view
- Data: **60 synthetic incidents** with a hidden answer key, **10 approved runbooks** (+1 unapproved draft)

---

## How it works

```
 Incident logs + metrics + change history
              │
   ┌──────────▼──────────┐
   │ 1 Ingest            │  only the "agent view" — no answer key, no hidden simulator state
   │ 2 Sanitize & guard  │  redact secrets/emails, strip prompt-injection lines
   │ 3 Signals           │  rule engine: regex hits + metric/timeline rules
   │ 4 Retrieve          │  Chroma search over APPROVED runbooks only
   │ 5 Reason (Qwen)     │  JSON-schema-constrained output, fallback if model is down
   │ 6 Rank              │  ensemble = 0.50 Qwen + 0.25 runbook match + 0.25 rules → top-3
   │ 7 Plan              │  Qwen picks WHICH allowed action; targets/versions bound from data
   │ 8 Policy            │  whitelist, runbook, blast radius, N-1 versions, kill switch, confidence
   └──────────┬──────────┘
              ▼
   ██ HUMAN APPROVAL GATE ██   1 approver (high risk) · 2 different approvers (critical / injection)
              ▼
   Execute → snapshot → apply → health checks → keep  OR  auto-rollback to snapshot
              ▼
   Hash-chained trace log (every step, tamper-evident)
```

## Responsible AI controls

| Control | What it does | Where |
|---|---|---|
| Human-in-the-loop | No state change runs without approval records in the DB | `workflow.execute` |
| Role-based authorization | viewer / responder / approver; responders can't approve | `auth.py` |
| Two-person rule | Critical actions (DB failover) need 2 *different* approvers | `catalog.py`, `workflow.decide` |
| Re-check at execution | Approvals, roles, policy, kill switch re-verified from the DB right before running | `workflow.authorize_execution` |
| Action whitelist | Only 9 known actions exist; anything else is blocked | `catalog.py`, `policy.py` |
| Blast radius | Target must be the affected service or its own dependency | `policy._target_ok` |
| Safe parameters | Rollback only to N-1; scaling bounded to 3x and max 12 | `policy._params_ok` |
| Approved runbooks only | Drafts are never indexed, and approval is re-checked at query time | `rag.py` |
| Prompt-injection defense | Instruction-like log lines removed; incident escalated to 2 approvers | `sanitize.py`, `policy.py` |
| Secret redaction | Passwords, tokens, keys, emails never reach the model or the UI | `sanitize.py` |
| Abstention | Low-confidence ranking → no change proposed, human takes over | `policy.py` (confidence) |
| Safe failure | Model down → labelled fallback ranking; crash → incident handed to a human | `agent.py`, `workflow.py` |
| Safe rollback | Snapshot → apply → verify → automatic restore on failure | `simulator.py` |
| Kill switch | One toggle freezes every change instantly | top bar, `policy.py` |
| Audit trail | SHA-256 hash chain; editing or deleting any row is detected | `audit.py` |

---

## Run it with Docker (easiest)

**You need:** Docker Desktop, and Ollama running with the model pulled.

```bash
ollama pull qwen3:4b          # you already have this
ollama serve                  # if it isn't already running on 11434

cd sentinel
cp .env.example .env          # optional, defaults work
docker compose up --build
```

- Open **http://localhost:3000**
- Open **http://localhost:8080** to browse the MySQL database visually in Adminer
- Sign in as any demo user, password **`sentinel`**
- First start downloads the small embedding model (~80 MB) in the background; the API starts immediately, and interrupted downloads resume automatically
- API docs: **http://localhost:8000/docs**

> **Linux only:** Ollama listens on 127.0.0.1 by default, so containers can't reach it.
> Start it with `OLLAMA_HOST=0.0.0.0 ollama serve`. (Docker Desktop on Windows/macOS works as-is.)

### Browse the database visually

After starting Docker Compose, open **http://localhost:8080** and use:

| Field | Value |
|---|---|
| System | MySQL |
| Server | `mysql` |
| Username | `sentinel` |
| Password | `sentinel` |
| Database | `sentinel` |

Adminer runs only on your local machine through port 8080 and uses the internal
Docker service name `mysql` to connect to the database.

## Run it without Docker

**1. MySQL** — either use Docker just for the database:
```bash
docker compose up -d mysql            # MySQL on localhost:3307
```
or a local MySQL 8:
```sql
CREATE DATABASE sentinel;
CREATE USER 'sentinel'@'localhost' IDENTIFIED BY 'sentinel';
GRANT ALL ON sentinel.* TO 'sentinel'@'localhost';
```
(then use port 3306 in `DATABASE_URL` below)

**2. Backend** (Python 3.11+)
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Windows PowerShell:
$env:DATABASE_URL="mysql+pymysql://sentinel:sentinel@localhost:3307/sentinel"
# macOS/Linux:
export DATABASE_URL="mysql+pymysql://sentinel:sentinel@localhost:3307/sentinel"

python -m scripts.seed                 # tables + 60 incidents + runbook index
uvicorn app.main:app --port 8000
```

**3. Frontend** (Node 20+)
```bash
cd frontend
npm install
npm run dev                            # http://localhost:3000
```

---

## Demo users

| User | Role | Can do |
|---|---|---|
| Alice Rao | approver | approve/reject, kill switch, reset incidents, run evaluation |
| Bob Mehta | approver | same as Alice (needed for the two-person rule) |
| Carol Iyer | responder | run triage, execute an already-approved change |
| Dave Singh | viewer | read only |

## 5-minute demo script

1. **Sign in as Carol.** Open the queue, pick **INC-1046** (marked *injection test*), press **Run triage**.
   Watch the board light up stage by stage. *Sanitize* turns amber: an injected instruction was removed.
2. Open the **Approval gate**. The fix needs **2 approvers** because of the injection. Carol can't approve.
3. **Sign in as Alice → Approve.** Try approving again — blocked (same person twice).
4. **Sign in as Bob → Approve → Execute change.** See snapshot → apply → health checks → resolved.
5. **Rollback demo:** triage **INC-1019**, approve, execute. This incident is rigged so the change fails
   mid-way; the system restores the snapshot automatically and hands the incident to a human.
6. **Kill switch:** as Alice, *Freeze all changes*, then try to execute anything — blocked.
7. **Trace log → Verify chain.** Every step above is there, hash-linked.
8. **Evaluation → Run evaluation** (or `python -m scripts.run_eval`).

Other useful incidents: **INC-1014** (TLS renewal fails mid-change), **INC-1023** (critical DB failover, two-person rule + failure).
The **Show answer key** button reveals ground truth for checking — it is never sent to the agent.

---

## Evaluation

```bash
cd backend
python -m scripts.run_eval             # full run with Qwen (about 10–20 min on CPU)
python -m scripts.run_eval --no-llm    # rules + runbooks only, seconds
python -m scripts.run_eval --limit 10  # quick smoke test
```
Writes **`backend/reports/evaluation_report.md`** (+ JSON). The console's Evaluation section shows the same results.

| Metric | Definition |
|---|---|
| Top-3 root-cause accuracy | Ground-truth cause is in the agent's top-3 list |
| Safe-action precision | Of changes sent for approval, the share that are correct (right action, target, parameters — proven by the simulator healing the incident) |
| Mean time to resolution | Simulated: triage time + human review (120 s default) + action rollout. If the agent is wrong, abstains, or the fix fails, the incident's manual baseline time is added |
| Unauthorized-action rate | Changes executed without valid authorization ÷ 12 red-team attacks (zero approvals, viewer executes, responder approves, same approver twice, tampered DB rows, kill switch, non-whitelisted action, out-of-scope target, arbitrary rollback version, rejected action, unapproved runbook) + 1 control that must succeed |
| Response latency | Wall-clock p50 / p95 of the full pipeline and of the Qwen call |

Also reported: accuracy by difficulty and by root cause, an **ablation** (Qwen alone vs runbooks alone vs rules alone vs ensemble),
prompt-injection detection, secret leaks to the model, auto-rollback correctness, and audit-chain tamper detection.

---

## Project structure

```
backend/
  app/
    main.py         API routes (FastAPI)
    agent.py        8-stage triage pipeline, prompt, ensemble ranking, planner
    sanitize.py     secret redaction + prompt-injection removal
    signals.py      rule engine (regex + metric/timeline rules)
    rag.py          runbook loader + Chroma retrieval (approved only)
    llm.py          Ollama client (JSON-schema output, retry, health)
    policy.py       action authorization guardrails
    workflow.py     triage stream, approvals, guarded execution, resets
    simulator.py    simulated environment: snapshot / apply / verify / rollback
    audit.py        hash-chained trace log + verification
    evaluation.py   metrics, ablation, red-team tests, report writer
    catalog.py      root causes + action whitelist (single source of truth)
    auth.py         demo RBAC with signed tokens
    models.py, db.py, config.py
  data/
    runbooks/*.md           10 approved runbooks + 1 unapproved draft
    generate_incidents.py   deterministic generator (seed 42)
    incidents.json          the 60 incidents
  scripts/seed.py, scripts/run_eval.py
frontend/
  components/Console.tsx    page shell
  components/LineRail.tsx   scroll-linked line map (the "train")
  components/Section.tsx    scroll-driven page transitions
  components/sections/*     Overview, Queue, Triage (mimic board), Gate, Execution, Trace, Evaluation
  lib/api.ts, lib/store.tsx
```

## Troubleshooting

- **"Model offline: fallback ranking"** in the top bar → Ollama isn't reachable. Check `curl http://localhost:11434/api/tags`.
  Triage still works (clearly labelled fallback), which is the safe-failure path.
- **Slow CPU / timeouts** → set `LLM_TIMEOUT_S=300`.
- **Port 3307 / 8000 / 3000 busy** → change the left side of the port mapping in `docker-compose.yml`.
- **Start fresh** → `python -m scripts.seed --reset` (or `docker compose down -v`).

## Honest limitations

- Incidents are synthetic and the environment is simulated — no real infrastructure is touched.
- The rule engine and the incident generator were written together, so rule-signal accuracy is optimistic;
  the ablation table shows how much each part contributes on its own.
- Demo login uses one shared password; replace `auth.py` with SSO before any real use.
