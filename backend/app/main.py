"""Sentinel API — FastAPI."""
import json
import logging
import statistics
import threading

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from . import audit, evaluation, llm, rag, workflow
from .auth import USERS, User, current_user, issue_token, login, require
from .catalog import ACTIONS, ROOT_CAUSES
from .config import settings
from .db import SessionLocal, get_db, iso, utcnow
from .models import Action, AuditEvent, EvalRun, Incident, TriageRun

app = FastAPI(title="Sentinel — Responsible Incident Triage Agent", version="1.0.0")
logger = logging.getLogger(__name__)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


def _index_runbooks():
    try:
        result = rag.build_index()
        logger.info("Indexed %s approved runbooks; skipped unapproved: %s",
                    result["indexed"], result["skipped_unapproved"])
    except Exception:
        logger.exception("Background runbook indexing failed")


@app.on_event("startup")
def start_runbook_indexing():
    threading.Thread(target=_index_runbooks, name="runbook-index", daemon=True).start()


@app.exception_handler(workflow.WorkflowError)
def _wf_error(_: Request, e: workflow.WorkflowError):
    return JSONResponse(status_code=e.status, content={"detail": e.message, "checks": e.checks})


# ------------------------------------------------------------------ schemas
class LoginIn(BaseModel):
    username: str
    password: str


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    reason: str = ""


class ToggleIn(BaseModel):
    on: bool


class EvalIn(BaseModel):
    use_llm: bool = True
    limit: int | None = Field(default=None, ge=1, le=500)


# ------------------------------------------------------------------ system
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"database": db_ok, "llm": llm.health(), "runbooks_indexed": rag.index_size(),
            "kill_switch": workflow.kill_switch(db) if db_ok else None}


@app.get("/api/catalog")
def catalog_info():
    return {"root_causes": ROOT_CAUSES, "actions": ACTIONS}


@app.post("/api/auth/login")
def do_login(body: LoginIn):
    user = login(body.username.strip().lower(), body.password)
    if not user:
        raise HTTPException(401, "Invalid username or password")
    return {"token": issue_token(user.username), "user": user.public()}


@app.get("/api/auth/users")
def demo_users():
    return [{"username": k, **v} for k, v in USERS.items()]


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return user.public()


@app.get("/api/stats")
def stats(db: Session = Depends(get_db), _: User = Depends(current_user)):
    by_status = dict(db.execute(select(Incident.status, func.count()).group_by(Incident.status)).all())
    resolved = db.execute(select(Incident).where(Incident.resolved_at.is_not(None))).scalars().all()
    mttrs = [(i.resolved_at - i.triage_started_at).total_seconds() / 60 for i in resolved if i.triage_started_at]
    runs = db.execute(select(TriageRun.total_ms, TriageRun.llm_ok).order_by(TriageRun.id.desc()).limit(200)).all()
    executed = db.execute(select(Action).where(Action.status.in_(("succeeded", "rolled_back")))).scalars().all()
    unauthorized = sum(1 for a in executed if not a.execution or len(a.execution.get("approvers", [])) <
                       max(a.required_approvals, ACTIONS.get(a.action_type, {}).get("approvals", 99)))
    blocked = db.execute(select(func.count()).select_from(AuditEvent).where(AuditEvent.event == "execution.blocked")).scalar()
    lat = sorted(r[0] for r in runs)
    return {
        "incidents": {"total": sum(by_status.values()), "by_status": by_status},
        "pending_approvals": db.execute(select(func.count()).select_from(Action).where(Action.status == "pending_approval")).scalar(),
        "mttr_min": round(statistics.mean(mttrs), 2) if mttrs else None,
        "resolved": len(resolved),
        "executions": len(executed),
        "rolled_back": sum(a.status == "rolled_back" for a in executed),
        "unauthorized_executions": unauthorized,
        "unauthorized_rate": round(unauthorized / len(executed), 4) if executed else 0.0,
        "blocked_attempts": blocked,
        "triage_runs": len(runs),
        "triage_p50_ms": lat[len(lat) // 2] if lat else None,
        "triage_p95_ms": lat[min(len(lat) - 1, int(len(lat) * 0.95))] if lat else None,
        "llm_fallback_rate": round(sum(not r[1] for r in runs) / len(runs), 3) if runs else None,
        "kill_switch": workflow.kill_switch(db),
    }


# ------------------------------------------------------------------ incidents
@app.get("/api/incidents")
def list_incidents(status: str | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(Incident).order_by(Incident.detected_at.desc())
    if status:
        q = q.where(Incident.status == status)
    return [workflow.incident_summary(i) for i in db.execute(q).scalars()]


@app.get("/api/incidents/{incident_id}")
def get_incident(incident_id: str, reveal: bool = False, db: Session = Depends(get_db), _: User = Depends(current_user)):
    inc = db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return workflow.incident_detail(db, inc, reveal=reveal)


@app.post("/api/incidents/{incident_id}/triage")
def triage(incident_id: str, use_llm: bool = True, user: User = Depends(require("responder"))):
    def sse():
        for ev in workflow.triage_stream(incident_id, user, use_llm):
            yield f"event: {ev['type']}\ndata: {json.dumps(ev, default=str)}\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/incidents/{incident_id}/reset")
def reset(incident_id: str, db: Session = Depends(get_db), user: User = Depends(require("approver"))):
    workflow.reset_incident(db, incident_id, user)
    return {"ok": True}


# ------------------------------------------------------------------ actions
@app.get("/api/actions")
def list_actions(status: str | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(Action).order_by(Action.id.desc()).limit(200)
    if status:
        q = q.where(Action.status == status)
    out = []
    for a in db.execute(q).scalars():
        d = workflow.action_dict(db, a)
        inc = db.get(Incident, a.incident_id)
        d["incident"] = workflow.incident_summary(inc)
        out.append(d)
    return out


@app.post("/api/actions/{action_id}/decision")
def decide(action_id: int, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return workflow.decide(db, action_id, user, body.decision, body.reason)


@app.post("/api/actions/{action_id}/execute")
def execute(action_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return workflow.execute(db, action_id, user)


# ------------------------------------------------------------------ runbooks, audit, settings
@app.get("/api/runbooks")
def runbooks(_: User = Depends(current_user)):
    return [b.public(full=True) for b in rag.catalog()["all"]]


@app.get("/api/audit")
def audit_log(incident_id: str | None = None, limit: int = 200, db: Session = Depends(get_db),
              _: User = Depends(current_user)):
    q = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(limit, 1000))
    if incident_id:
        q = q.where(AuditEvent.incident_id == incident_id)
    return [audit.to_dict(e) for e in db.execute(q).scalars()]


@app.get("/api/audit/verify")
def audit_verify(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return audit.verify(db)


@app.get("/api/settings/kill-switch")
def get_ks(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return {"on": workflow.kill_switch(db)}


@app.post("/api/settings/kill-switch")
def set_ks(body: ToggleIn, db: Session = Depends(get_db), user: User = Depends(require("approver"))):
    return {"on": workflow.set_kill_switch(db, body.on, user)}


# ------------------------------------------------------------------ evaluation
_eval_lock = threading.Lock()


def _eval_job(run_id: int, use_llm: bool, limit: int | None):
    db = SessionLocal()
    try:
        run = db.get(EvalRun, run_id)

        def progress(i, n):
            run.progress, run.total = i, n
            db.commit()

        result = evaluation.run_evaluation(db, use_llm=use_llm, limit=limit, progress=progress)
        evaluation.write_report(result, run_id)
        run.metrics, run.per_incident = result["metrics"], result["per_incident"]
        run.status, run.finished_at = "completed", utcnow()
        audit.record(db, "system", "evaluation.completed", payload={
            "run_id": run_id, "top3": result["metrics"]["accuracy"]["top3"],
            "unauthorized_rate": result["metrics"]["safety"]["unauthorized_action_rate"]})
    except Exception as e:
        db.rollback()
        run = db.get(EvalRun, run_id)
        run.status, run.error, run.finished_at = "failed", str(e)[:2000], utcnow()
        db.commit()
    finally:
        db.close()
        _eval_lock.release()


@app.post("/api/eval/run")
def start_eval(body: EvalIn, db: Session = Depends(get_db), user: User = Depends(require("approver"))):
    if not _eval_lock.acquire(blocking=False):
        raise HTTPException(409, "An evaluation is already running")
    run = EvalRun(status="running", use_llm=body.use_llm, total=body.limit or 0)
    db.add(run)
    db.commit()
    audit.record(db, user.username, "evaluation.started", payload={"run_id": run.id, "use_llm": body.use_llm})
    threading.Thread(target=_eval_job, args=(run.id, body.use_llm, body.limit), daemon=True).start()
    return {"id": run.id}


def _eval_dict(r: EvalRun, full: bool) -> dict:
    d = {"id": r.id, "status": r.status, "use_llm": r.use_llm, "progress": r.progress, "total": r.total,
         "error": r.error, "started_at": iso(r.started_at), "finished_at": iso(r.finished_at), "metrics": r.metrics}
    if full:
        d["per_incident"] = r.per_incident
    return d


@app.get("/api/eval/latest")
def latest_eval(db: Session = Depends(get_db), _: User = Depends(current_user)):
    r = db.execute(select(EvalRun).order_by(EvalRun.id.desc()).limit(1)).scalar()
    return _eval_dict(r, True) if r else None


@app.get("/api/eval/runs")
def eval_runs(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return [_eval_dict(r, False) for r in db.execute(select(EvalRun).order_by(EvalRun.id.desc()).limit(20)).scalars()]
