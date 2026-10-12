import { z } from 'zod'

/** Display guidance only; this cannot authorize actions or change acceptance. */
export const SuperAgentPlanBlockerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('system'), summary: z.string().trim().min(1).max(500),
    systemAction: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('user'), summary: z.string().trim().min(1).max(500),
    userAction: z.string().trim().min(1).max(1000), systemAction: z.string().trim().min(1).max(1000).optional() }).strict(),
])
export type SuperAgentPlanBlocker = z.infer<typeof SuperAgentPlanBlockerSchema>
