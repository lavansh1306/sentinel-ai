"""Stage 3: deterministic signal extraction (no LLM).

Regex hits over sanitized log lines + simple metric/timeline rules.
These scores are one of three inputs to the final ranking, and they keep the
agent useful when the LLM is down.
"""
import re
from datetime import datetime

from .catalog import CATEGORY_IDS
from .sanitize import Sanitized

PATTERNS: dict[str, list[str]] = {
    "bad_deployment": [r"NullPointerException|TypeError|AttributeError", r"CrashLoopBackOff",
                       r"readiness probe failed", r"deserializ\w* failed|unknown field",
                       r"error rate for version="],
    "memory_leak": [r"OOMKilled", r"OutOfMemoryError|heap out of memory|Cannot allocate memory"],
    "db_connection_pool_exhaustion": [r"Connection is not available", r"pool exhausted",
                                      r"waiting for connection from pool"],
    "disk_full": [r"no space left on device|ENOSPC", r"disk usage 9\d%|disk usage 100%"],
    "traffic_spike": [r"queue depth \d+ exceeds", r"CPU throttling", r"429 Too Many Requests",
                      r"HPA at max replicas"],
    "expired_tls_certificate": [r"certificate (has )?expired", r"CERTIFICATE_VERIFY_FAILED", r"x509"],
    "downstream_dependency_timeout": [r"upstream \S+ timed out", r"504 Gateway Timeout", r"context deadline exceeded"],
    "bad_config_change": [r"ConfigError", r"failed to parse config|unknown config key",
                          r"invalid configuration", r"missing required key"],
    "cache_failure": [r"ECONNREFUSED [\d.]+:6379", r"CLUSTERDOWN|redis \S+ unavailable",
                      r"cache miss ratio 100%"],
    "database_primary_failure": [r"could not connect to primary", r"--read-only option",
                                 r"no primary elected|quorum lost"],
}
_COMPILED = {c: [re.compile(p, re.I) for p in ps] for c, ps in PATTERNS.items()}
CHANGE_WINDOW_MIN = 20


def _ts(s: str) -> datetime:
    return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")


def _jumped(series: list[float]) -> bool:
    base = max(sum(series[:4]) / 4, 0.5)
    return max(series[-4:]) >= base * 5


def metric_findings(view: dict) -> list[tuple[str, int, str]]:
    m, ctx = view["metrics"], view["context"]
    detected = _ts(view["detected_at"])
    found = []
    mem, cpu, rps, disk, err = m["mem_pct"], m["cpu_pct"], m["rps"], m["disk_pct"], m["error_rate_pct"]
    if mem[-1] - mem[0] >= 20 and mem[-1] >= 85:
        found.append(("memory_leak", 2, f"Memory rose steadily {mem[0]:.0f}% -> {mem[-1]:.0f}% over 24 min"))
    if rps[-1] >= 2 * rps[0] and max(cpu[-3:]) >= 90:
        found.append(("traffic_spike", 2, f"RPS {rps[0]:.0f} -> {rps[-1]:.0f} with CPU at {max(cpu[-3:]):.0f}%"))
    if disk[-1] >= 95:
        found.append(("disk_full", 2, f"Disk usage at {disk[-1]:.1f}%"))
    for key, cat, label in (("deploy_history", "bad_deployment", "Deploy"),
                            ("config_history", "bad_config_change", "Config change")):
        last = ctx[key][-1]
        mins = (detected - _ts(last["at"])).total_seconds() / 60
        if 0 <= mins <= CHANGE_WINDOW_MIN and _jumped(err):
            found.append((cat, 1, f"{label} {last['version']} {mins:.0f} min before detection, then error spike"))
    return found


def extract(view: dict, logs: Sanitized) -> dict:
    hits = {c: 0 for c in CATEGORY_IDS}
    evidence: dict[str, list[str]] = {c: [] for c in CATEGORY_IDS}
    for ln in logs.lines:
        for cat, rxs in _COMPILED.items():
            if any(rx.search(ln.msg) for rx in rxs):
                hits[cat] += 1
                if len(evidence[cat]) < 3 and ln.msg not in evidence[cat]:
                    evidence[cat].append(ln.msg)
    scores = {c: min(hits[c], 6) for c in CATEGORY_IDS}
    findings = metric_findings(view)
    for cat, weight, text in findings:
        scores[cat] += weight * 2
        evidence[cat].insert(0, text)

    errors = [ln for ln in logs.lines if ln.level in ("ERROR", "FATAL")]
    warns = [ln for ln in logs.lines if ln.level == "WARN"]
    return {
        "scores": scores,
        "log_hits": hits,
        "metric_findings": [{"category": c, "weight": w, "text": t} for c, w, t in findings],
        "evidence": {c: e for c, e in evidence.items() if e},
        "stats": {"lines": len(logs.lines), "errors": len(errors), "warnings": len(warns)},
    }
