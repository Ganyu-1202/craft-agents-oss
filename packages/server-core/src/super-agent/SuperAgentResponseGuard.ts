import { createHash } from 'node:crypto'
import type { SuperAgentDocument } from '@craft-agent/shared/super-agent'

export function normalizeSuperAgentResponse(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

/** Only flag dominant, verbatim repetition. Similar conclusions are not proof of a loop. */
export function hasSuperAgentResponseLoop(text: string): boolean {
  const normalized = normalizeSuperAgentResponse(text)
  if (normalized.length < 160) return false
  const parts = text.split(/\n+|(?<=[。！？])\s*|(?<=[.!?])\s+/u).map(normalizeSuperAgentResponse).filter(Boolean)
  const counts = new Map<string, number>()
  for (const part of parts) if (part.length >= 12) counts.set(part, (counts.get(part) ?? 0) + 1)
  const repeated = [...counts].reduce((sum, [part, count]) => sum + (count >= 4 ? part.length * count : 0), 0)
  if (repeated >= normalized.length * 0.65) return true
  // Sliding samples also catch runs without sentence delimiters, including Chinese output.
  const samples = new Map<string, number>()
  let total = 0
  for (let i = 0; i + 64 <= normalized.length; i += 32) {
    const sample = normalized.slice(i, i + 64)
    samples.set(sample, (samples.get(sample) ?? 0) + 1)
    total++
  }
  return [...samples.values()].reduce((sum, count) => sum + (count >= 4 ? count : 0), 0) >= Math.max(4, total * 0.65)
}

/** Evidence identities, not timestamps, conversational prose or incidental plan revisions. */
export function superAgentResponseProgressKey(document: SuperAgentDocument): string {
  const state = document.state
  return createHash('sha256').update(JSON.stringify({
    input: state.messages.findLast(message => message.fromNodeId === 'user')?.id,
    goals: state.intents?.map(goal => [goal.id, goal.revision, goal.status]),
    plans: state.plans.map(plan => [plan.id, plan.goalRevision, plan.status, plan.instructions, plan.blocker]),
    tasks: state.tasks.map(task => [task.id, task.status, task.phase, task.checkpoint?.revision, task.acceptance,
      task.output, task.error]),
    artifacts: state.artifacts?.map(artifact => [artifact.id, artifact.sha256, artifact.missing]),
    operations: state.operations?.map(operation => [operation.id, operation.status, operation.resultHash]),
    board: state.board.map(item => [item.id, item.revision]),
    scripts: state.scripts.map(script => [script.scriptId, script.runId, script.status, script.sha256]),
    environment: document.config?.environment,
  })).digest('hex')
}

/** A pure receipt confirmation has no new facts and should not wake the planner. */
export function isSuperAgentAcknowledgment(text: string, request = ''): boolean {
  const acknowledgment = /^(?:收到|已收到|好的|明白|了解|已确认|acknowledged|understood|ok)[\s，,。.!！:：]/iu
  if (/^(?:收到|已收到|好的|明白|了解|已确认|acknowledged|understood|ok)[\s，,。.!！:：]*(?:(?:谢谢|感谢|thanks)[。.!！]?)?$/iu.test(text.trim())) return true
  return /(?:不需|无需|不要).{0,4}回复|no (?:reply|response|acknowledgment) needed/iu.test(request)
    && text.length <= 250 && acknowledgment.test(text.trim()) && /按要求|遵照|停止|不再|as requested/iu.test(text)
    && !/但|不过|然而|错误|失败|发现|新增(?:证据|产物|结果)|变更|更新|新证据|报告已|https?:|[A-Z]:[\\/]/iu.test(text)
}
