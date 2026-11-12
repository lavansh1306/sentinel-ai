---
id: RB-004
title: Disk full — rotate and compress logs
root_cause: disk_full
version: 2
approved: true
approved_by: Bob Mehta (On-call SRE)
approved_on: 2026-06-30
target: service
primary_action: rotate_logs
allowed_actions: [collect_diagnostics, rotate_logs]
---
## Symptoms
- "No space left on device", "ENOSPC", writes or log flushes failing.
- Disk usage above 95% on the data or log volume.
- Requests that write (uploads, logs, temp files) fail; reads may still work.

## Diagnosis
1. Check disk usage per volume and find the largest directories.
2. Usually caused by unrotated application logs or temp files.

## Remediation
- Rotate and compress logs, delete rotated archives older than the retention window.
- Requires one human approval.

## Verification
- Disk usage falls below 80% and write errors stop.

## Do NOT
- Never delete database files, WAL/binlogs or anything outside the log directory.
