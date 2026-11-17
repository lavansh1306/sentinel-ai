"""Simulated production environment (the only place changes are 'applied').

Every change: snapshot -> apply -> health checks -> keep, or auto-rollback to
the snapshot on failure. The hidden fault decides whether the change helped.
"""
import copy
import time

from .catalog import ACTIONS

HIDDEN_ENV_KEYS = {"active_fault", "execution_fault", "healthy"}


def public_env(env: dict) -> dict:
    return {k: v for k, v in env.items() if k not in HIDDEN_ENV_KEYS}


def fixes_fault(action_type: str, target: str, params: dict, gt: dict) -> bool:
    if action_type != gt["action"] or target != gt["target"]:
        return False
    want = gt.get("params") or {}
    if "target_version" in want:
        return params.get("target_version") == want["target_version"]
    if "min_replicas" in want:
        return int(params.get("replicas") or 0) >= want["min_replicas"]
    return True


def diagnostics(view: dict, result: dict) -> dict:
    """Read-only action: nothing changes."""
    m = view["metrics"]
    return {"outcome": "read_only", "steps": [{"msg": "Collected state snapshot, metric summary and error counts", "status": "ok"}],
            "snapshot": {"env": view["env"], "error_rate_now": m["error_rate_pct"][-1], "p99_now_ms": m["p99_latency_ms"][-1],
                         "cpu_now": m["cpu_pct"][-1], "mem_now": m["mem_pct"][-1], "disk_now": m["disk_pct"][-1],
                         "log_stats": result["signals"]["stats"]}}


def run(env: dict, action_type: str, target: str, params: dict, gt: dict, delay: float = 0.0) -> dict:
    t0 = time.perf_counter()
    steps = []

    def step(msg, status="ok"):
        steps.append({"t": round(time.perf_counter() - t0, 2), "msg": msg, "status": status})
        if delay:
            time.sleep(delay)

    snapshot = copy.deepcopy(env)
    new = copy.deepcopy(env)
    label = ACTIONS[action_type]["label"]
    step(f"Snapshot saved: version {env['version']}, config {env['config_version']}, replicas {env['replicas']}, "
         f"db primary {env['db_primary']}")
    step(f"Applying '{label}' to {target} {params or ''}".strip())

    if action_type == "rollback_deployment":
        new["version"] = params["target_version"]
    elif action_type == "rollback_config":
        new["config_version"] = params["target_version"]
    elif action_type == "scale_replicas":
        new["replicas"] = params["replicas"]
    elif action_type == "enable_circuit_breaker":
        new["circuit_breaker"] = True
    elif action_type == "failover_database":
        new["db_primary"] = f"{target}-1"

    correct = fixes_fault(action_type, target, params, gt)
    if correct and env.get("execution_fault"):
        step(f"ERROR: {env['execution_fault']}", "error")
        step("Change failed mid-way, restoring snapshot", "warn")
        step("Snapshot restored, service state unchanged", "ok")
        return {"ok": False, "outcome": "execution_failed", "env": snapshot, "steps": steps,
                "reason": env["execution_fault"]}

    if correct:
        new["active_fault"] = None
        new["healthy"] = True
    step("Running post-change health checks (3 probes)")
    if new.get("healthy"):
        step("Health checks passed: error rate and latency back to baseline", "ok")
        return {"ok": True, "outcome": "resolved", "env": new, "steps": steps}

    step("Health checks FAILED: symptoms persist after the change", "error")
    step("Verification failed, auto-rolling back to snapshot", "warn")
    step("Rollback complete, previous state restored", "ok")
    return {"ok": False, "outcome": "verification_failed", "env": snapshot, "steps": steps,
            "reason": "change did not fix the incident"}
