---
id: RB-008
title: Bad configuration change — roll back config
root_cause: bad_config_change
version: 3
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-09-22
target: service
primary_action: rollback_config
allowed_actions: [collect_diagnostics, rollback_config]
---
## Symptoms
- "ConfigError", "invalid configuration", "missing required key", "unknown config key", "failed to parse config".
- Errors start within minutes after a configuration push, with no code deploy at that time.
- Feature flags behaving unexpectedly or set to invalid values.

## Diagnosis
1. Compare the config change timestamp with the start of errors.
2. Diff the current config version against the previous one.

## Remediation
- Roll back to the immediately previous config version (N-1) only.
- Requires one human approval.

## Verification
- Config parses cleanly on all pods and error rate returns to baseline.

## Do NOT
- Do not roll back the code deployment for a config problem.
