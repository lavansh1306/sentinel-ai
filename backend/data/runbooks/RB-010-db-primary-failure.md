---
id: RB-010
title: Database primary failure — promote replica (failover)
root_cause: database_primary_failure
version: 5
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-10-03
target: database
primary_action: failover_database
allowed_actions: [collect_diagnostics, failover_database]
---
## Symptoms
- "could not connect to primary", "running with the --read-only option", "no primary elected".
- All writes fail; reads from replicas may still work.
- Database primary health checks failing.

## Diagnosis
1. Confirm the primary is unreachable or read-only from more than one client.
2. Check replica lag — only promote a replica that is caught up.

## Remediation
- Promote the most up-to-date replica to primary and repoint the service.
- CRITICAL action: requires TWO distinct human approvers (two-person rule).

## Verification
- Writes succeed; new primary health checks pass; replication re-established.

## Do NOT
- Never drop or rebuild the old primary's data from this runbook.
