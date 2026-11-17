---
id: RB-003
title: Database connection pool exhaustion — release leaked connections
root_cause: db_connection_pool_exhaustion
version: 2
approved: true
approved_by: Bob Mehta (On-call SRE)
approved_on: 2026-07-21
target: service
primary_action: restart_service
allowed_actions: [collect_diagnostics, restart_service]
---
## Symptoms
- "Connection is not available, request timed out", "Timeout waiting for connection from pool", "pool exhausted".
- Pool metrics show active = max, idle = 0, and many waiting threads.
- Application latency is very high but application CPU is low.
- The database itself is healthy (accepting connections, normal CPU, no failover).

## Diagnosis
1. Confirm the database is healthy — if the primary is down, use RB-010 instead.
2. Check for connections held by long transactions or leaked by an error path.

## Remediation
- Rolling restart of the application service to release leaked connections.
- Requires one human approval.

## Verification
- Pool idle connections recover, p99 latency returns to normal.

## Do NOT
- Do not raise the database max_connections — it can overload the database.
- Do not fail over the database; it is not the problem.
