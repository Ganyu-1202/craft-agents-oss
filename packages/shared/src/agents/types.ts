/** Settings applied with highest precedence to sessions started by an agent. */
export interface AgentSessionSettings {
  /** Explicit model/connection used by the spawned session. */
  model?: string
  llmConnection?: string
  /** Additional system instructions for this agent session. */
  systemPrompt?: string
  /** Source slugs allowed for this session (MCP and API sources). */
  enabledSourceSlugs?: string[]
  /** Optional independent allowlists; omitted means all enabled source types. */
  mcpSourceSlugs?: string[]
  apiSourceSlugs?: string[]
  /** Whether the spawned session is visible in the normal conversation list. */
  showInSessionList?: boolean
}

/** A reusable, isolated worker that the main conversation can delegate to. */
export interface CustomAgentDefinition {
  id: string
  name: string
  description: string
  prompt: string
  tools?: string[]
  model?: string
  /** Settings for the special session created when this agent is invoked. */
  session?: AgentSessionSettings
  builtin?: boolean
}

export interface AgentsConfig {
  version: 1
  agents: CustomAgentDefinition[]
}

/** Built-in agent exposed in the agent catalog; execution uses native /compact. */
export const COMPACT_AGENT: CustomAgentDefinition = {
  id: 'compact',
  name: '压缩上下文',
  description: '在保留决策、约束条件和下一步计划的同时，总结当前会话以释放上下文空间。',
  prompt: '使用原生上下文压缩流程，目标是将模型使用的上下文压缩到原来的约 10%。原始会话记录和近期原文保持保留，压缩摘要而非删除历史。只保留继续当前任务必需的目标、用户约束、有效决策、当前状态、未完成工作、阻塞原因和关键文件路径。将旧摘要与新进展重新合并，去重并删除已失效的计划、已解决的问题、重复说明和无关的已完成任务；不要逐条累积旧摘要。用简短事实替代操作过程、长日志和代码全文，必要时保留原文或文件引用以便回查。保留不可重新获取的关键事实、精确标识符、用户最新指令和不确定性，不编造结论，不因长度目标丢弃关键约束。只输出紧凑的任务交接摘要。',
  tools: [],
  session: { showInSessionList: false },
  builtin: true,
}
