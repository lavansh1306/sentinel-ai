"""Single source of truth for root-cause categories and the action whitelist.

The agent can only ever propose actions listed in ACTIONS. Anything else is
rejected by the policy engine before a human even sees it.
"""

ROOT_CAUSES: dict[str, dict] = {
    "bad_deployment": {
        "label": "Faulty deployment",
        "desc": "A newly deployed version introduced errors; errors start right after the rollout.",
    },
    "memory_leak": {
        "label": "Memory leak",
        "desc": "Process memory climbs steadily until long GC pauses or OOM kills.",
    },
    "db_connection_pool_exhaustion": {
        "label": "DB connection pool exhausted",
        "desc": "The app's DB pool has no free connections; requests wait and time out while the DB itself is healthy.",
    },
    "disk_full": {
        "label": "Disk full",
        "desc": "A volume ran out of space; writes and log flushes fail.",
    },
    "traffic_spike": {
        "label": "Traffic spike / CPU saturation",
        "desc": "Load exceeds capacity; CPU saturated, request queues grow, 429s appear.",
    },
    "expired_tls_certificate": {
        "label": "Expired TLS certificate",
        "desc": "A certificate expired; TLS handshakes fail abruptly at a clock time.",
    },
    "downstream_dependency_timeout": {
        "label": "Downstream dependency timeout",
        "desc": "A called HTTP dependency is slow; calls time out and retries pile up.",
    },
    "bad_config_change": {
        "label": "Bad configuration change",
        "desc": "A recent config push is invalid or harmful; errors start right after it.",
    },
    "cache_failure": {
        "label": "Cache cluster failure",
        "desc": "The cache is unreachable; reads fall through to the database.",
    },
    "database_primary_failure": {
        "label": "Database primary failure",
        "desc": "The primary DB node is down or read-only; writes fail.",
    },
}

# risk: read_only < low < medium < high < critical
# approvals: distinct human approvers needed before execution
# est_minutes: simulated time for the change to roll out (used for simulated MTTR)
ACTIONS: dict[str, dict] = {
    "collect_diagnostics": {"label": "Collect diagnostics", "risk": "read_only", "approvals": 0, "mutates": False, "est_minutes": 0.5},
    "restart_service": {"label": "Restart service", "risk": "medium", "approvals": 1, "mutates": True, "est_minutes": 3},
    "rollback_deployment": {"label": "Roll back deployment", "risk": "high", "approvals": 1, "mutates": True, "est_minutes": 5},
    "scale_replicas": {"label": "Scale replicas", "risk": "medium", "approvals": 1, "mutates": True, "est_minutes": 3},
    "rotate_logs": {"label": "Rotate & compress logs", "risk": "low", "approvals": 1, "mutates": True, "est_minutes": 2},
    "renew_certificate": {"label": "Renew TLS certificate", "risk": "medium", "approvals": 1, "mutates": True, "est_minutes": 4},
    "enable_circuit_breaker": {"label": "Enable circuit breaker", "risk": "medium", "approvals": 1, "mutates": True, "est_minutes": 1},
    "rollback_config": {"label": "Roll back config", "risk": "high", "approvals": 1, "mutates": True, "est_minutes": 3},
    "failover_database": {"label": "Fail over database", "risk": "critical", "approvals": 2, "mutates": True, "est_minutes": 6},
}

MAX_REPLICAS = 12

CATEGORY_IDS = list(ROOT_CAUSES)
ACTION_IDS = list(ACTIONS)
