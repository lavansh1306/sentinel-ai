---
id: RB-005
title: Traffic spike / CPU saturation — scale out replicas
root_cause: traffic_spike
version: 3
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-09-01
target: service
primary_action: scale_replicas
allowed_actions: [collect_diagnostics, scale_replicas]
---
## Symptoms
- Requests per second far above normal (2x or more).
- CPU above 90%, CPU throttling, growing request queue depth.
- Clients receive 429 Too Many Requests; latency rises with load.
- Autoscaler is already at its maximum replica count.

## Diagnosis
1. Confirm traffic is legitimate (not an attack) by checking client distribution.
2. Confirm the bottleneck is CPU in this service, not a slow dependency.

## Remediation
- Scale replicas up. Allowed range: above current, at most 3x current, never above 12.
- Requires one human approval.

## Verification
- CPU falls below 70%, queue depth and 429s return to normal.

## Do NOT
- Do not restart pods under load — it removes capacity.
