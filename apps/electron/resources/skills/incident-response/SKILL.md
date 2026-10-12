---
name: incident-response
description: Diagnose service and environment failures, execute scoped remediation, and verify recovery using the actual failing route, node, logs and requested outcomes.
---

# Incident response

Capture the symptom, affected request or operation, timestamp and time zone, node, version and original error. Trace the real route through the relevant client, service, dependency and resource. Separate request-level failures from background activity; inspect identity, configuration and affinity where they influence the failing path.

During diagnosis, gather scoped evidence without changing the affected system. Compare the observed behavior with a concrete expected outcome and identify a supported cause and impact. Use only configured or explicitly supplied remote endpoints and credentials; do not invent a jump host or expose secrets in commands or logs.

For remediation, operate within assigned authorization and exclusive service resources. Confirm the current state and recovery method, make the necessary change and retain actual commands, exit states, artifacts and checkpoints. A transport failure may leave a partial side effect: inspect before replaying a deployment, transfer, migration or external action.

Verify recovery independently on the original failing path and relevant nodes. Check the requested result, version, artifacts and collateral effects; process health or an unrelated HTTP 200 alone does not prove the incident is resolved. Preserve partial recovery evidence and specific unresolved blockers.

A Super Agent diagnostician, operator or verifier follows its assigned phase; diagnosis and verification do not expand into unassigned remediation. Cross-scenario support performs only the orchestrator's bounded phase and returns evidence for acceptance.
