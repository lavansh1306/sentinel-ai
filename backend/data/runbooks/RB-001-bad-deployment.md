---
id: RB-001
title: Faulty deployment — roll back to last known good version
root_cause: bad_deployment
version: 4
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-09-14
target: service
primary_action: rollback_deployment
allowed_actions: [collect_diagnostics, rollback_deployment]
---
## Symptoms
- Error rate (HTTP 5xx) jumps sharply within minutes after a new version rolls out.
- New pods fail readiness probes or enter CrashLoopBackOff.
- Stack traces reference the new version (NullPointerException, TypeError, schema or deserialization mismatch).
- Older version (if still running) shows a normal error rate.

## Diagnosis
1. Compare the deploy timestamp with the start of the error spike. A gap under 20 minutes is a strong signal.
2. Check whether errors are concentrated on pods running the new version.
3. Rule out shared dependencies (database, cache) — if they are healthy, the code change is the prime suspect.

## Remediation
- Roll back ONLY to the immediately previous version (N-1). Never skip versions.
- Requires one human approval. Roll out gradually and watch the error rate.

## Verification
- Error rate returns to baseline within 5 minutes; readiness probes pass on all pods.

## Do NOT
- Do not restart pods repeatedly — the bad code will come back.
- Do not roll back database migrations from this runbook.
