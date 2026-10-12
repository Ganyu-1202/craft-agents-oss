import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptySuperAgentState, type SuperAgentPlanItem, type SuperAgentTask } from '@craft-agent/shared/super-agent'
import { superAgentBlockingReports } from './super-agent-blockers'
import { SuperAgentBlockingCard } from './SuperAgentBlockingCard'
import type { SuperAgentText } from './super-agent-ui'
import zh from '@craft-agent/shared/i18n/locales/zh-Hans.json'

const text: SuperAgentText = (key, values) => {
  let value = (zh as Record<string, string>)[`superAgent.${key}`] ?? key
  for (const [name, item] of Object.entries(values ?? {})) value = value.replaceAll(`{{${name}}}`, String(item))
  return value
}
const plan: SuperAgentPlanItem = { id: 'plan', title: '投资研究', instructions: 'Research', status: 'blocked', priority: 1,
  note: 'Unsettled operation outcomes must be verified before acceptance; SHA256 abcdef', revision: 1, updatedBy: 'main', updatedAt: 1 }
const task: SuperAgentTask = { id: 'original', nodeId: 'worker', planId: 'plan', title: 'Research', instructions: '', status: 'completed', createdAt: 1 }
function render(report: ReturnType<typeof superAgentBlockingReports>[number], processing = false) {
  return renderToStaticMarkup(<SuperAgentBlockingCard report={report} text={text} processing={processing} disabled={false} onProvideInput={() => {}} />)
}

test('unknown outcomes show saved progress and a system action, with technical evidence collapsed', () => {
  const state = emptySuperAgentState(1)
  state.plans = [plan]; state.tasks = [task]
  state.operations = [{ id: 'op_unknown', key: 'a'.repeat(64), taskId: task.id, turnId: 'turn', nodeId: 'worker',
    sessionId: 'session', invocationId: 'call', toolName: 'Bash', status: 'unknown', createdAt: 1, updatedAt: 1 }]
  state.artifacts = [{ id: 'file', taskId: task.id, path: 'research.md', sha256: 'b'.repeat(64), revision: 1, description: '', updatedAt: 1 }]
  const report = superAgentBlockingReports(state)[0]!
  expect(report).toMatchObject({ kind: 'verification', submittedCount: 1, artifactCount: 1 })
  const html = render(report)
  const main = html.slice(0, html.indexOf('<details'))
  expect(main).toContain('有 1 项工具操作的执行结果尚未确认')
  expect(main).toContain('无需操作。AI 会自动核验执行结果并继续')
  expect(main).toContain('已提交 1 份任务结果，已登记 1 项文件产物')
  expect(main).not.toContain('<button')
  expect(main).toContain('AI 自动核验与恢复')
  expect(main).not.toContain('op_unknown')
  expect(main).not.toContain('SHA256')
  expect(html).toContain('op_unknown')
  expect(html).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/)
  expect(render(report, true)).not.toContain('<button')
})

test('specific user information is explicit and uses a reply action instead of verification', () => {
  const state = emptySuperAgentState(1)
  state.plans = [{ ...plan, blocker: { kind: 'user', summary: '还没有确定目标市场', userAction: '请选择中国市场或美国市场，并提供分析周期。', systemAction: '收到后继续数据研究。' } }]
  const html = render(superAgentBlockingReports(state)[0]!)
  expect(html).toContain('需要你补充信息')
  expect(html).toContain('请选择中国市场或美国市场，并提供分析周期。')
  expect(html).toContain('补充信息</button>')
  expect(html).not.toContain('暂不需要你补充')
})

test('legacy reports do not invent a missing user requirement or claim completed acceptance', () => {
  const state = emptySuperAgentState(1)
  state.plans = [plan]; state.tasks = [{ ...task, status: 'queued' }]
  const reports = superAgentBlockingReports(state)
  expect(reports).toHaveLength(1)
  expect(reports[0]!.kind).toBe('unspecified')
  expect(render(reports[0]!)).toContain('具体原因和解除条件还需要确认')
  expect(render(reports[0]!)).not.toContain('需要你补充信息')
})

test('upstream operations are included while unrelated and reconciled operations stay out', () => {
  const state = emptySuperAgentState(1)
  state.tasks = [{ ...task, acceptanceCriteria: ['Verified result'] }, { ...task, id: 'next', status: 'queued', planId: undefined, dependsOn: [task.id] }]
  const base = { key: 'a'.repeat(64), turnId: 'turn', nodeId: 'worker', sessionId: 'session', invocationId: 'call', toolName: 'Bash', createdAt: 1, updatedAt: 1 }
  state.operations = [{ ...base, id: 'op_relevant', taskId: task.id, status: 'unknown' }, { ...base, id: 'op_other', taskId: 'other', status: 'unknown' }, { ...base, id: 'op_settled', taskId: task.id, status: 'reconciled' }]
  const reports = superAgentBlockingReports(state)
  expect(reports).toHaveLength(1)
  expect(reports[0]!.kind).toBe('verification')
  expect(reports[0]!.operations.map(operation => operation.id)).toEqual(['op_relevant'])
})
