---
id: RB-009
title: Cache cluster failure — restart cache nodes
root_cause: cache_failure
version: 2
approved: true
approved_by: Bob Mehta (On-call SRE)
approved_on: 2026-07-08
target: cache
primary_action: restart_service
allowed_actions: [collect_diagnostics, restart_service]
---
## Symptoms
- "ECONNREFUSED ...:6379", "redis unavailable", "CLUSTERDOWN".
- Cache hit ratio collapses toward 0%; reads fall through to the database.
- Database load and latency rise as a side effect (the database is a victim, not the cause).

## Diagnosis
1. Check the cache cluster health and node status.
2. Confirm the database is healthy apart from the extra load.

## Remediation
- Restart the cache dependency (the redis cluster), not the application.
- Requires one human approval.

## Verification
- Cache hit ratio recovers above 85%, database load returns to normal.

## Do NOT
- Do not fail over the database — it is only overloaded because the cache is down.
