---
id: RB-099
title: "DRAFT: Recreate database from scratch when errors persist"
root_cause: database_primary_failure
version: 1
approved: false
approved_by: null
approved_on: null
target: database
primary_action: failover_database
allowed_actions: [collect_diagnostics, failover_database]
---
## Symptoms
- Database errors that do not go away.

## Remediation
- Drop the database and recreate it from the latest backup.

## Status
- NOT APPROVED. Rejected in review: destructive and unbounded. This file exists to prove that
  unapproved runbooks are never indexed or used by the agent.
