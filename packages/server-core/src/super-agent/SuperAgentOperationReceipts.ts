import { createHash } from 'node:crypto'
import type { Session } from '@craft-agent/shared/protocol'
import type { SuperAgentOperation } from '@craft-agent/shared/super-agent'

/** The shell bridge marks a dispatched process and its terminal exit explicitly.
 * This proves the invocation finished, never that its requested business work succeeded. */
export function terminalProgramResult(toolName: string, result: string): boolean {
  const name = toolName.split('__').at(-1)?.toLowerCase()
  return ['bash', 'localbash', 'runshell'].includes(name ?? '')
    && /^\[ERROR\] \[executed on (?:server|client)\]/.test(result)
    && /(?:^|\n)exit code -?\d+(?:\r?\n|$)/.test(result)
}

/** Original host transcript evidence; never infer execution from an error or a hash. */
export function operationReceipt(operation: SuperAgentOperation, session: {
  id: string; workspaceId: string; messages?: Session['messages']
} | null, workspaceId: string) {
  const identity = { operationId: operation.id, sessionId: operation.sessionId, invocationId: operation.invocationId }
  if (!session || session.id !== operation.sessionId || session.workspaceId !== workspaceId) return { ...identity, availability: 'missing' as const }
  const matches = session.messages?.filter(message => message.role === 'tool'
    && message.toolUseId === operation.invocationId && message.toolName === operation.toolName
    && typeof message.toolResult === 'string') ?? []
  // Older recordings lost the result event/hash while retaining the host transcript.
  // Recover only one unambiguous terminal result; an existing hash must still match.
  const terminal = matches.filter(message => message.toolStatus === 'completed' || message.toolStatus === 'error')
  const message = operation.resultHash ? matches.findLast(message =>
    createHash('sha256').update(`${operation.toolName}\n${message.toolResult}`).digest('hex') === operation.resultHash)
    : terminal.length === 1 ? terminal[0] : undefined
  if (!message) return { ...identity, availability: matches.length ? 'hash-mismatch' as const : 'missing' as const }
  // Bound returned evidence, preserving the full-result hash and explicit truncation.
  const input = message.toolInput === undefined ? undefined : JSON.stringify(message.toolInput)
  const result = message.toolResult!
  return { ...identity, availability: 'available' as const, messageId: message.id, timestamp: message.timestamp,
    toolName: operation.toolName, toolStatus: message.toolStatus, isError: message.isError,
    inputJson: input?.slice(0, 16_000), result: result.slice(0, 32_000),
    resultHash: operation.resultHash ?? createHash('sha256').update(`${operation.toolName}\n${result}`).digest('hex'),
    hashSource: operation.resultHash ? 'operation' as const : 'transcript' as const,
    inputTruncated: (input?.length ?? 0) > 16_000, resultTruncated: result.length > 32_000 }
}
