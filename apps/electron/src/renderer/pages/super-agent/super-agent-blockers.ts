import { superAgentTaskBlocker, type SuperAgentState, type SuperAgentTask, type SuperAgentPlanItem } from '@craft-agent/shared/super-agent'

export function superAgentBlockingReports(state: SuperAgentState) {
  const report = (id: string, title: string, initialTasks: SuperAgentTask[], plan?: SuperAgentPlanItem, task?: SuperAgentTask) => {
    const taskIds = new Set(initialTasks.map(item => item.id))
    // Include upstream blockers, without pulling in unrelated work under another plan.
    for (let size = -1; size !== taskIds.size;) {
      size = taskIds.size
      for (const item of state.tasks) if (taskIds.has(item.id)) for (const dependency of item.dependsOn ?? []) taskIds.add(dependency)
    }
    const operations = (state.operations ?? []).filter(operation => !!operation.taskId && taskIds.has(operation.taskId)
      && ['prepared', 'running', 'unknown'].includes(operation.status))
    const blocker = task && superAgentTaskBlocker(state, task)
    const guidance = plan?.blocker
    const kind = guidance?.kind === 'user' ? 'user' : operations.length ? 'verification'
      : guidance?.kind === 'system' ? 'system' : blocker && blocker.code !== 'planBlocked'
        ? blocker.code === 'dependencyWaiting' ? 'dependency' : 'replan' : 'unspecified'
    return { id, title, kind, summary: guidance?.summary, userAction: guidance?.kind === 'user' ? guidance.userAction : undefined,
      systemAction: guidance?.systemAction, blocker, operations, details: plan?.note ?? task?.error ?? '',
      submittedCount: initialTasks.filter(item => item.status === 'completed').length,
      artifactCount: (state.artifacts ?? []).filter(artifact => initialTasks.some(item => item.id === artifact.taskId) && !artifact.missing).length }
  }
  const plans = state.plans.filter(plan => plan.status === 'blocked' && !state.tasks.some(task => task.planId === plan.id && task.status === 'running'))
  return [
    ...plans.map(plan => report(`plan:${plan.id}`, plan.title, state.tasks.filter(task => task.planId === plan.id), plan)),
    ...state.tasks.filter(task => task.status === 'queued' && superAgentTaskBlocker(state, task)
      && !plans.some(plan => plan.id === task.planId)).map(task => report(`task:${task.id}`, task.title, [task], undefined, task)),
  ]
}
export type SuperAgentBlockingReport = ReturnType<typeof superAgentBlockingReports>[number]
