"""Stage 8: action authorization guardrails.

Runs twice for every action: when the agent proposes it, and again right
before execution (so a tampered DB row or a changed world can't slip through).
"""
from .catalog import ACTIONS, MAX_REPLICAS
from .config import settings
from .rag import catalog


def _check(checks: list, name: str, passed: bool, detail: str, hard: bool = True):
    checks.append({"name": name, "passed": bool(passed), "detail": detail, "hard": hard})


def _target_ok(action_type: str, target: str, view: dict) -> tuple[bool, str]:
    service = view["service"]
    deps = {d["name"]: d["type"] for d in view["context"]["dependencies"]}
    if action_type == "failover_database":
        ok = deps.get(target) == "database"
        return ok, f"'{target}' is {'a database dependency' if ok else 'not a database dependency'} of {service}"
    if action_type == "restart_service":
        ok = target == service or deps.get(target) == "cache"
        return ok, f"'{target}' is {'within' if ok else 'outside'} the incident blast radius"
    ok = target == service
    return ok, f"'{target}' {'is' if ok else 'is not'} the affected service ({service})"


def _params_ok(action_type: str, params: dict, view: dict) -> tuple[bool, str]:
    ctx, env = view["context"], view["env"]
    if action_type == "rollback_deployment":
        hist = ctx["deploy_history"]
        n1 = hist[-2]["version"] if len(hist) > 1 else None
        want = params.get("target_version")
        ok = want == n1 and env.get("version") == hist[-1]["version"]
        return ok, f"Rollback target {want} " + ("is the N-1 version" if ok else f"rejected: only N-1 ({n1}) from the live version is allowed")
    if action_type == "rollback_config":
        hist = ctx["config_history"]
        n1 = hist[-2]["version"] if len(hist) > 1 else None
        want = params.get("target_version")
        ok = want == n1 and env.get("config_version") == hist[-1]["version"]
        return ok, f"Config rollback to {want} " + ("is the N-1 version" if ok else f"rejected: only N-1 ({n1}) is allowed")
    if action_type == "scale_replicas":
        cur = int(env.get("replicas", 1))
        want = params.get("replicas")
        cap = min(cur * 3, MAX_REPLICAS)
        ok = isinstance(want, int) and cur < want <= cap
        return ok, f"Scale {cur} -> {want} " + ("within bounds" if ok else f"rejected: allowed range {cur + 1}..{cap}")
    return True, "No parameters required"


def evaluate(action: dict, view: dict, top3: list[str], kill_switch: bool,
             injection_suspected: bool = False, top_score: float | None = None) -> dict:
    checks: list[dict] = []
    a_type = action["action_type"]
    spec = ACTIONS.get(a_type)
    _check(checks, "catalog", spec is not None,
           "Action is in the approved action catalog" if spec else f"'{a_type}' is not a whitelisted action")
    if spec is None:
        return {"decision": "blocked", "risk": "unknown", "required_approvals": 99, "checks": checks}

    rb = catalog()["by_id"].get(action.get("runbook_id") or "")
    _check(checks, "approved_runbook", rb is not None and a_type in rb.allowed_actions and rb.root_cause in top3,
           f"Allowed by approved runbook {rb.id} v{rb.version} for a top-3 root cause" if rb and a_type in rb.allowed_actions and rb.root_cause in top3
           else "No approved runbook for a top-3 root cause allows this action")

    ok, detail = _target_ok(a_type, action["target"], view)
    _check(checks, "blast_radius", ok, detail)
    ok, detail = _params_ok(a_type, action.get("params") or {}, view)
    _check(checks, "parameters", ok, detail)
    approvals = spec["approvals"]
    if spec["mutates"]:
        _check(checks, "kill_switch", not kill_switch,
               "Global kill switch is OFF" if not kill_switch else "Global kill switch is ON: all changes frozen")
        if top_score is not None:
            _check(checks, "confidence", top_score >= settings.abstain_below,
                   f"Top root-cause score {top_score:.2f} " + (f">= {settings.abstain_below}" if top_score >= settings.abstain_below
                                                               else f"< {settings.abstain_below}: agent abstains, human must investigate"))
        if injection_suspected:
            approvals = max(approvals, 2)
            _check(checks, "injection_escalation", True,
                   "Prompt-injection text found in logs: escalated to two-person approval", hard=False)
        if spec["risk"] in ("high", "critical"):
            _check(checks, "risk_review", True, f"{spec['risk'].upper()} risk: requires {approvals} approver(s)", hard=False)

    allowed = all(c["passed"] for c in checks if c["hard"])
    decision = "blocked" if not allowed else ("requires_approval" if spec["mutates"] else "auto_allowed")
    return {"decision": decision, "risk": spec["risk"], "required_approvals": approvals if spec["mutates"] else 0,
            "checks": checks}
