---
id: RB-002
title: Memory leak — capture heap and perform rolling restart
root_cause: memory_leak
version: 3
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-08-02
target: service
primary_action: restart_service
allowed_actions: [collect_diagnostics, restart_service]
---
## Symptoms
- Memory usage climbs steadily over tens of minutes or hours without dropping.
- Long garbage-collection pauses ("GC pause", "GC overhead limit exceeded").
- Containers are OOMKilled and restart; "OutOfMemoryError" or "heap out of memory" in logs.
- Latency degrades gradually rather than all at once.

## Diagnosis
1. Look at the memory trend: a straight upward slope is a leak, a sudden step is not.
2. Confirm restarts with reason OOMKilled.
3. If a deploy happened recently but memory was already climbing before it, the deploy is not the cause.

## Remediation
- Collect a heap dump first (collect_diagnostics), then do a rolling restart of the service.
- Requires one human approval. Restart one pod at a time.

## Verification
- Memory drops to its normal baseline and GC pauses disappear.

## Do NOT
- Do not raise memory limits as a permanent fix. Open a bug for the leak.
