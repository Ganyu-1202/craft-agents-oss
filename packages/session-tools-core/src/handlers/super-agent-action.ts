import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import { parseSuperAgentToolCall } from '../super-agent-tools.ts'

export async function handleSuperAgentAction(ctx: SessionToolContext, toolName: string, args: Record<string, unknown>) {
  if (!ctx.superAgentAction) return errorResponse('This session is not an active Super Agent node.')
  try {
    parseSuperAgentToolCall(toolName, args)
    const result = await ctx.superAgentAction(toolName, args) as { receipt?: { status: string } }
    return result.receipt?.status === 'applied' ? successResponse(JSON.stringify(result)) : errorResponse(JSON.stringify(result))
  } catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)) }
}
