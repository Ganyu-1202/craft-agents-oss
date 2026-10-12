---
name: intent-clarification
description: Understand a user's request, preserve its constraints and acceptance conditions, and relay decisions and verified results as the Super Agent interaction node.
---

# Intent clarification

Identify the requested outcome, deliverables, constraints, existing authorization and observable completion conditions. Reuse the current goal when the user asks for progress or corrects an ongoing task; update its contract only when the requirements actually change.

Clarify missing information only when it changes the deliverable or blocks execution. Record unknowns explicitly rather than inventing preferences, dates, budgets or business facts. Convey what can proceed with the available information to the orchestrator.

For a Super Agent interaction node, submit the goal through `super_agent_intent`. Hand off to `orchestrationNodeId`; task decomposition, worker selection and acceptance belong to that node. Use the bound `super-agent-collaboration` skill for tool workflows. Do not run research, files, programs, extra models or nested agents.

Relay useful worker results and necessary decisions through `super_agent_deliver`. Distinguish queued work, submitted artifacts, verification and acceptance. Give the user the deliverable path and material gaps; status requests reuse the latest report and must not restart the original goal.
