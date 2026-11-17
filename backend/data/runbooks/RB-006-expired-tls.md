---
id: RB-006
title: Expired TLS certificate — renew and reload
root_cause: expired_tls_certificate
version: 2
approved: true
approved_by: Alice Rao (SRE Lead)
approved_on: 2026-05-19
target: service
primary_action: renew_certificate
allowed_actions: [collect_diagnostics, renew_certificate]
---
## Symptoms
- "x509: certificate has expired", "CERTIFICATE_VERIFY_FAILED", "tls: bad certificate".
- TLS handshake failures start at an exact clock time and affect almost all traffic at once.
- No deploy or config change around the start time; CPU and memory are normal.

## Diagnosis
1. Read the certificate expiry date and compare with the error start time.
2. Check whether the automatic renewal job failed.

## Remediation
- Issue a renewed certificate from the internal CA and hot-reload it.
- Requires one human approval.

## Verification
- Handshake errors stop; new certificate expiry is at least 30 days away.

## Do NOT
- Do not disable certificate verification as a workaround.
