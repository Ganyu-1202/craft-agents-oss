import { z } from 'zod'
import { ArtifactSchema } from './continuity'

const deliveryFields = {
  kind: z.enum(['stage', 'final']),
  title: z.string().trim().min(1).max(120).optional(),
}

/** The host resolves IDs; the model cannot invent file paths or fingerprints. */
export const SuperAgentDeliveryRequestSchema = z.object({
  ...deliveryFields,
  artifactIds: z.array(z.string().min(1).max(64)).max(16).optional(),
}).strict()

/** Keep the delivered file versions with the reply across reloads and updates. */
export const SuperAgentDeliverySchema = z.object({
  ...deliveryFields,
  artifacts: z.array(ArtifactSchema).max(16),
}).strict()
export type SuperAgentDelivery = z.infer<typeof SuperAgentDeliverySchema>
