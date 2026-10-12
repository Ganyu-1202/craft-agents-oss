---
name: task-orchestration
description: Route authorized work to Super Agent workers by their bound skills, framework, model and availability, then manage dependencies and evidence-based acceptance across scenarios.
---

# Task orchestration

Read the current intent and team state. Match the task to each worker's `skillCatalog` descriptions, assigned skill slugs, role, framework limitations, authorized sources and scheduling state. Skills are instructions, not proof of model competence or available tools. Prefer a specialist when present; otherwise assign a bounded cross-scenario task to a supporting worker with a matching skill. Split difficult work into verifiable stages and ask the interaction node for decisions that cannot be inferred.

Examples of routing:

- Implementation and debugging: `software-development`; independent testing and review: `software-verification` and `evidence-review`.
- Literature and current facts: `web-research` with `browser-automation`; experiments, numerical or domain analysis: `research-methods` and `structured-data`.
- Office files and reports: `document-workflows`; visual artifacts: `previews-and-diagrams`, `pages-authoring`, `canvas-editing` or `theme-package-design`.
- Service diagnosis, remediation and recovery: `incident-response` and `remote-operations`.
- Everyday writing, learning, planning and errands: `everyday-assistance`; desktop interaction: `windows-desktop-control`.
- Information and memory: `knowledge-organization`; product integration/configuration packages: the relevant authoring skill; delivery and handoff: `messaging-and-collaboration`.

Create stable task IDs with concrete inputs, ownership, outputs and acceptance criteria. Parallelize independent work; put exclusive write paths in `resources`. Keep one writer per artifact and use `dependsOn` and `reviewOf` for the actual dependency graph. Keep cross-scenario work within the original goal and current team workflow, without creating another team or changing provider credentials.

Workers perform analysis and verification. Use the bound `super-agent-collaboration` skill and its registered tools for plans, dispatch, messages and acceptance. Accept only completed reports for the current goal and artifact version. Unknown operations require independent verification and a later reconciliation turn before acceptance; dispatch verification before retrying acceptance. Preserve applied receipts and completed work when repairing rejected calls. Communicate deliverables or blockers to `interactionNodeId`; do not report a queued action as completed.
