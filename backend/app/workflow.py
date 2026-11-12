"""DB-bound workflow: triage runs, approvals, guarded execution, resets.

Every state change is committed together with an audit event.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import agent, audit, policy, simulator
from .auth import User, get_user
from .catalog import ACTIONS
from .config import settings
from .db import SessionLocal, iso, utcnow
from .models import Action, Approval, Incident, Setting, TriageRun
from .sanitize import redact

OPEN_ACTION_STATES = ("pending_approval", "approved")


class WorkflowError(Exception):
    def __init__(self, status: int, message: str, checks: list | None = None):
        super().__init__(message)
        self.status, self.message, self.checks = status, message, checks or []


# ------------------------------------------------------------------ views
def agent_view(inc: Incident) -> dict:
    """The ONLY incident data the agent may see: no ground truth, no hidden simulator state."""
    return {"id": inc.id, "title": inc.title, "service": inc.service, "severity": inc.severity,
            "detected_at": iso(inc.detected_at), "logs": inc.logs, "metrics": inc.metrics,
            "context": inc.context, "env": simulator.public_env(inc.env_state)}


def kill_switch(db: Session) -> bool:
    row = db.get(Setting, "kill_switch")
    return bool(row and row.value == "on")


def set_kill_switch(db: Session, on: bool, user: User) -> bool:
    row = db.get(Setting, "kill_switch") or Setting(key="kill_switch", value="off")
    row.value = "on" if on else "off"
    db.add(row)
    audit.record(db, user.username, "killswitch.on" if on else "killswitch.off", payload={"by": user.name})
    return on


def _supersede_open(db: Session, incident_id: str, except_id: int | None = None) -> int:
    rows = db.execute(select(Action).where(Action.incident_id == incident_id,
                                           Action.status.in_(OPEN_ACTION_STATES))).scalars().all()
    for a in rows:
        if a.id != except_id:
            a.status = "superseded"
    return len(rows)


# ------------------------------------------------------------------ triage
def triage_stream(incident_id: str, user: User, use_llm: bool = True):
    db = SessionLocal()
    inc = None
    try:
        inc = db.get(Incident, incident_id)
        if not inc:
            yield {"type": "error", "message": f"Incident {incident_id} not found"}
            return
        if inc.status in ("executing", "resolved"):
            yield {"type": "error", "message": f"Incident is {inc.status}; reset it first to re-run triage"}
            return
        _supersede_open(db, inc.id)
        inc.status = "triaging"
        inc.triage_started_at = inc.triage_started_at or utcnow()
        audit.record(db, user.username, "triage.started", inc.id, payload={"use_llm": use_llm})

        gen = agent.analyze_iter(agent_view(inc), use_llm=use_llm, kill_switch=kill_switch(db))
        while True:
            try:
                yield {"type": "stage", **next(gen)}
            except StopIteration as stop:
                result = stop.value
                break

        yield {"type": "stage", "stage": "gate", "title": "Human approval gate", "status": "running", "data": {}, "ms": None}
        run = TriageRun(incident_id=inc.id, actor=user.username, model=result["model"], llm_ok=result["llm_ok"],
                        status="abstained" if result["abstained"] else "completed",
                        total_ms=result["total_ms"], llm_ms=result["llm_ms"], summary=result["summary"],
                        top3=result["top3"], trace=result.pop("trace"), result=result, finished_at=utcnow())
        db.add(run)
        db.flush()

        created = []
        for p in result["plan"]:
            pol = p["policy"]
            status = {"blocked": "blocked", "auto_allowed": "auto_executed",
                      "requires_approval": "pending_approval"}[pol["decision"]]
            a = Action(incident_id=inc.id, triage_run_id=run.id, action_type=p["action_type"], target=p["target"],
                       params=p["params"], rationale=p["rationale"], runbook_id=p["runbook_id"], risk=pol["risk"],
                       required_approvals=pol["required_approvals"], status=status, policy=pol)
            if status == "auto_executed":
                a.execution = simulator.diagnostics(agent_view(inc), result)
                a.executed_at, a.executed_by = utcnow(), "agent (read-only)"
            db.add(a)
            created.append(a)
        db.flush()
        pending = [a for a in created if a.status == "pending_approval"]
        inc.status = "awaiting_approval" if pending else "needs_human"

        audit.record(db, "agent", "triage.completed", inc.id, payload={
            "run_id": run.id, "model": run.model, "llm_ok": run.llm_ok, "total_ms": run.total_ms,
            "top3": [(r["root_cause"], r["score"]) for r in run.top3], "abstained": result["abstained"],
            "redactions": result["sanitize"]["redactions"], "injections": len(result["sanitize"]["injections"])})
        for a in created:
            event = {"blocked": "action.blocked_by_policy", "auto_executed": "action.auto_executed_read_only",
                     "pending_approval": "action.proposed"}[a.status]
            audit.record(db, "agent", event, inc.id, a.id, payload={
                "action": a.action_type, "target": a.target, "params": a.params, "risk": a.risk,
                "required_approvals": a.required_approvals,
                "failed_checks": [c["name"] for c in a.policy["checks"] if c["hard"] and not c["passed"]]})

        yield {"type": "stage", "stage": "gate", "title": "Human approval gate",
               "status": "waiting" if pending else "warn",
               "data": {"pending": [action_dict(db, a) for a in pending],
                        "blocked": sum(a.status == "blocked" for a in created),
                        "auto_executed": sum(a.status == "auto_executed" for a in created),
                        "incident_status": inc.status}, "ms": 0}
        yield {"type": "complete", "incident_id": inc.id, "run_id": run.id, "status": inc.status}
    except GeneratorExit:   # client disconnected mid-run: hand over to a human, don't leave it 'triaging'
        db.rollback()
        if inc is not None and db.get(Incident, incident_id).status == "triaging":
            db.get(Incident, incident_id).status = "needs_human"
            audit.record(db, "system", "triage.aborted", incident_id, payload={"reason": "client disconnected"})
        raise
    except Exception as e:  # safe failure: never leave an incident half-triaged
        db.rollback()
        if inc is not None:
            inc = db.get(Incident, incident_id)
            inc.status = "needs_human"
            audit.record(db, "system", "triage.failed", incident_id, payload={"error": str(e)[:500]})
        yield {"type": "error", "message": f"Triage failed safely, handed to a human: {e}"}
    finally:
        db.close()


# ------------------------------------------------------------------ approvals
def decide(db: Session, action_id: int, user: User, decision: str, reason: str) -> dict:
    if not user.can("approver"):
        audit.record(db, user.username, "approval.denied_role", action_id=action_id, payload={"role": user.role})
        raise WorkflowError(403, f"{user.name} ({user.role}) is not allowed to approve actions")
    a = db.get(Action, action_id)
    if not a:
        raise WorkflowError(404, "Action not found")
    if a.status != "pending_approval":
        raise WorkflowError(409, f"Action is '{a.status}', not awaiting approval")
    if decision not in ("approve", "reject"):
        raise WorkflowError(422, "decision must be 'approve' or 'reject'")
    if decision == "reject" and len(reason.strip()) < 5:
        raise WorkflowError(422, "A reason (5+ characters) is required to reject")
    already = db.execute(select(Approval).where(Approval.action_id == a.id, Approval.approver == user.username)).scalar()
    if already:
        audit.record(db, user.username, "approval.duplicate_blocked", a.incident_id, a.id)
        raise WorkflowError(409, "You already voted on this action; a second approver must be a different person")

    db.add(Approval(action_id=a.id, approver=user.username, decision=decision, reason=reason.strip()))
    db.flush()
    inc = db.get(Incident, a.incident_id)
    if decision == "reject":
        a.status = "rejected"
        if not db.execute(select(Action).where(Action.incident_id == inc.id, Action.status.in_(OPEN_ACTION_STATES))).first():
            inc.status = "needs_human"
        audit.record(db, user.username, "action.rejected", inc.id, a.id, payload={"reason": reason.strip()})
    else:
        votes = db.execute(select(func.count()).select_from(Approval).where(
            Approval.action_id == a.id, Approval.decision == "approve")).scalar()
        if votes >= a.required_approvals:
            a.status = "approved"
        audit.record(db, user.username, "action.approved" if a.status == "approved" else "action.approval_recorded",
                     inc.id, a.id, payload={"votes": votes, "required": a.required_approvals, "comment": reason.strip()})
    return action_dict(db, a)


# ------------------------------------------------------------------ execution
def authorize_execution(db: Session, a: Action, inc: Incident) -> list[dict]:
    """Defense in depth: re-verify everything from the database at execution time."""
    votes = db.execute(select(Approval).where(Approval.action_id == a.id)).scalars().all()
    approvers = sorted({v.approver for v in votes if v.decision == "approve"})
    spec = ACTIONS.get(a.action_type)
    needed = max(a.required_approvals, spec["approvals"]) if spec else 99
    ks = kill_switch(db)
    checks = [
        {"name": "status", "passed": a.status == "approved", "detail": f"Action status is '{a.status}'"},
        {"name": "approvals", "passed": len(approvers) >= needed,
         "detail": f"{len(approvers)}/{needed} distinct approvals ({', '.join(approvers) or 'none'})"},
        {"name": "approver_roles", "passed": all((u := get_user(x)) and u.can("approver") for x in approvers),
         "detail": "All approvals come from users with the approver role"},
        {"name": "no_rejection", "passed": not any(v.decision == "reject" for v in votes), "detail": "No reviewer rejected it"},
        {"name": "incident_state", "passed": inc.status not in ("resolved", "executing", "triaging"),
         "detail": f"Incident is '{inc.status}'"},
    ]
    run = db.get(TriageRun, a.triage_run_id) if a.triage_run_id else None
    top3 = [r["root_cause"] for r in run.top3] if run else []
    pol = policy.evaluate({"action_type": a.action_type, "target": a.target, "params": a.params,
                           "runbook_id": a.runbook_id}, agent_view(inc), top3, ks,
                          bool(run and run.result.get("sanitize", {}).get("injections")),
                          run.top3[0]["score"] if run else None)
    checks += [{"name": f"policy.{c['name']}", "passed": c["passed"], "detail": c["detail"]}
               for c in pol["checks"] if c["hard"]]
    return checks


def execute(db: Session, action_id: int, user: User) -> dict:
    a = db.get(Action, action_id)
    if not a:
        raise WorkflowError(404, "Action not found")
    inc = db.get(Incident, a.incident_id)
    if not user.can("responder"):
        audit.record(db, user.username, "execution.blocked", inc.id, a.id, payload={"failed": ["role"]})
        raise WorkflowError(403, f"{user.name} ({user.role}) cannot execute actions")
    checks = authorize_execution(db, a, inc)
    failed = [c for c in checks if not c["passed"]]
    if failed:
        audit.record(db, user.username, "execution.blocked", inc.id, a.id,
                     payload={"failed": [f"{c['name']}: {c['detail']}" for c in failed]})
        raise WorkflowError(409, "Execution blocked by safety checks", failed)

    approvers = sorted({v.approver for v in db.execute(select(Approval).where(
        Approval.action_id == a.id, Approval.decision == "approve")).scalars()})
    a.status, inc.status = "executing", "executing"
    audit.record(db, user.username, "execution.started", inc.id, a.id,
                 payload={"action": a.action_type, "target": a.target, "params": a.params, "approvers": approvers})

    before = simulator.public_env(inc.env_state)
    try:
        res = simulator.run(inc.env_state, a.action_type, a.target, a.params, inc.ground_truth,
                            delay=settings.exec_step_delay_s)
    except Exception as e:  # executor crash -> state untouched
        res = {"ok": False, "outcome": "executor_error", "env": inc.env_state, "reason": str(e),
               "steps": [{"t": 0, "msg": f"Executor error: {e}. No change applied.", "status": "error"}]}

    now = utcnow()
    inc.env_state = res["env"]
    a.executed_at, a.executed_by = now, user.username
    a.execution = {"outcome": res["outcome"], "reason": res.get("reason"), "steps": res["steps"],
                   "before": before, "after": simulator.public_env(res["env"]), "approvers": approvers,
                   "authorization": checks}
    if res["ok"]:
        a.status, inc.status, inc.resolved_at = "succeeded", "resolved", now
        _supersede_open(db, inc.id, except_id=a.id)
        audit.record(db, user.username, "execution.succeeded", inc.id, a.id, payload={"after": a.execution["after"]})
        mttr = (now - (inc.triage_started_at or now)).total_seconds() / 60
        audit.record(db, "system", "incident.resolved", inc.id, a.id, payload={"mttr_min": round(mttr, 2)})
    else:
        a.status, inc.status = "rolled_back", "needs_human"
        audit.record(db, "system", "execution.failed", inc.id, a.id,
                     payload={"outcome": res["outcome"], "reason": res.get("reason")})
        audit.record(db, "system", "rollback.completed", inc.id, a.id, payload={"restored": a.execution["after"]})
    return action_dict(db, a)


def reset_incident(db: Session, incident_id: str, user: User) -> None:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise WorkflowError(404, "Incident not found")
    _supersede_open(db, inc.id)
    inc.status, inc.env_state = "open", dict(inc.initial_env)
    inc.triage_started_at = inc.resolved_at = None
    audit.record(db, user.username, "incident.reset", inc.id)


# ------------------------------------------------------------------ serializers
def action_dict(db: Session, a: Action) -> dict:
    votes = db.execute(select(Approval).where(Approval.action_id == a.id).order_by(Approval.id)).scalars().all()
    spec = ACTIONS.get(a.action_type, {})
    return {"id": a.id, "incident_id": a.incident_id, "triage_run_id": a.triage_run_id,
            "action_type": a.action_type, "label": spec.get("label", a.action_type), "target": a.target,
            "params": a.params, "rationale": a.rationale, "runbook_id": a.runbook_id, "risk": a.risk,
            "required_approvals": a.required_approvals, "status": a.status, "policy": a.policy,
            "execution": a.execution, "created_at": iso(a.created_at), "executed_at": iso(a.executed_at),
            "executed_by": a.executed_by,
            "approvals": [{"approver": v.approver, "name": (get_user(v.approver).name if get_user(v.approver) else v.approver),
                           "decision": v.decision, "reason": v.reason, "at": iso(v.created_at)} for v in votes]}


def incident_summary(inc: Incident) -> dict:
    return {"id": inc.id, "title": inc.title, "service": inc.service, "severity": inc.severity, "status": inc.status,
            "difficulty": inc.difficulty, "adversarial": inc.adversarial, "detected_at": iso(inc.detected_at),
            "resolved_at": iso(inc.resolved_at)}


def incident_detail(db: Session, inc: Incident, reveal: bool = False) -> dict:
    run = db.execute(select(TriageRun).where(TriageRun.incident_id == inc.id).order_by(TriageRun.id.desc()).limit(1)).scalar()
    actions = db.execute(select(Action).where(Action.incident_id == inc.id).order_by(Action.id.desc())).scalars().all()
    d = incident_summary(inc) | {
        "logs": redact(inc.logs)[0],                  # secrets never leave the backend
        "metrics": inc.metrics, "context": inc.context,
        "env": simulator.public_env(inc.env_state), "baseline_mttr_min": inc.baseline_mttr_min,
        "triage_started_at": iso(inc.triage_started_at),
        "latest_run": None if not run else {
            "id": run.id, "status": run.status, "model": run.model, "llm_ok": run.llm_ok, "total_ms": run.total_ms,
            "llm_ms": run.llm_ms, "summary": run.summary, "top3": run.top3, "trace": run.trace,
            "started_at": iso(run.started_at), "finished_at": iso(run.finished_at)},
        "actions": [action_dict(db, a) for a in actions],
    }
    if reveal:
        d["ground_truth"] = inc.ground_truth
    return d
