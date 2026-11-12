---
id: RB-007
title: Slow downstream dependency — enable circuit breaker
root_cause: downstream_dependency_timeout
version: 2
approved: true
approved_by: Bob Mehta (On-call SRE)
approved_on: 2026-08-11
target: service
primary_action: enable_circuit_breaker
allowed_actions: [collect_diagnostics, enable_circuit_breaker]
---
## Symptoms
- "upstream timed out", "504 Gateway Timeout", "context deadline exceeded" when calling another HTTP service.
- Retries pile up, client thread pools for that dependency are exhausted.
- This service's own CPU and memory are normal; latency is dominated by the dependency.

## Diagnosis
1. Identify which dependency the timeouts point to.
2. Confirm it is an HTTP service dependency (not the database or cache).

## Remediation
- Enable the circuit breaker on calls to the slow dependency so the service fails fast and serves degraded responses.
- Requires one human approval. Page the owning team of the dependency.

## Verification
- p99 latency recovers; error responses are fast and bounded.

## Do NOT
- Do not raise timeouts or retry counts — it makes the pile-up worse.
