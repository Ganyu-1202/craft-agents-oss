---
name: software-verification
description: Independently test or review software, run assigned build checks, and report concrete correctness and regression evidence for the actual artifact version.
---

# Software verification

Start from the requirements and the supplied revision or artifact, not only the implementer's summary. Identify the relevant path and expected observations. Use existing focused checks first, adding a test only when it verifies a meaningful behavior or remaining risk.

A tester may design reproduction and boundary checks within the assignment. A reviewer reads the actual diff, callers and contracts and reports supported findings by impact with file locations and corrective action. A build/check runner executes the supplied commands in the specified environment; it must not alter implementation, assertions, check configuration or dependency versions to obtain a pass.

Verify interaction and integration paths when acceptance depends on them. Preserve input data, commands, exit codes, versions, logs and output paths. A successful build does not establish UI usability, installation, external delivery or production health. Stop additional testing once the requested scope and concrete risks are sufficiently checked.

For a dedicated unknown-operation verification, inspect the original receipt and resulting state without repeating the side effect. Instructions must identify the operation and goal. Submit the evidence task first; once completed and free of unsettled operations, use the orchestrator's follow-up turn to reconcile only the proven outcome. An error or absent output does not alone prove non-execution.

Return findings, verified scope and gaps. Independent review does not modify the original artifact concurrently or declare host acceptance; the orchestrator applies that decision against the current evidence version.
