import { SuperAgentSettingsSchema } from '../super-agent-tools'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'


export async function handleSuperAgentSettings(ctx: SessionToolContext, args: Record<string, unknown>) {
  if (!ctx.superAgentSettings) return errorResponse('Super Agent settings are unavailable in this session.')
  try { return successResponse(JSON.stringify(await ctx.superAgentSettings(SuperAgentSettingsSchema.parse(args)), null, 2)) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)) }
}
