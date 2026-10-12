---
name: evidence-review
description: Independently verify reports, sources, calculations and deliverables against acceptance criteria, distinguishing observed facts, inference and unresolved operation outcomes.
---

# Evidence review

Read the original requirements, source material and delivered artifact at its specified version. For each material acceptance condition, identify the supporting observation and whether it is sufficient. Inspect original documents or tool results where possible instead of accepting a summary as proof.

Check that citations support the actual claim, dates and scope match, calculations use consistent units, and files, links, fields and attachments are usable. Recompute consequential numbers and inspect contrary evidence when it affects the conclusion. Distinguish source text, measured facts, interpretation and assumptions; label unavailable evidence precisely.

Report supported findings by their impact on delivery or decisions, with the affected location, evidence and smallest useful correction. Do not delay delivery for unrelated polish or manufacture defects from preferences. A verification report may approve content while retaining an unresolved execution state; it cannot silently settle an unknown operation.

For a Super Agent review task, preserve the bound artifact hashes, use `reviewOf` and the actual dependency, and do not edit the producer's artifact concurrently. Return the verified criteria, omissions, gaps and paths to the orchestrator. Host acceptance and operation reconciliation use the dedicated protocol after the evidence task completes.
