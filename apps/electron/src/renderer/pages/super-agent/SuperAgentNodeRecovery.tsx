import { useState } from 'react'
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { SuperAgentCommand, SuperAgentNodeRuntime } from '@craft-agent/shared/super-agent'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatTimestamp, useSuperAgentText } from './super-agent-ui'

export function SuperAgentNodeRecovery({ runtime, nodeName, busy, onCommand }: {
  runtime: SuperAgentNodeRuntime
  nodeName?: string
  busy: boolean
  onCommand: (command: SuperAgentCommand) => Promise<void>
}) {
  const text = useSuperAgentText()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [resetError, setResetError] = useState('')
  const disabled = busy || resetPending
  async function reset() {
    if (disabled) return
    setResetPending(true); setResetError('')
    try {
      await onCommand({ type: 'node-reset', nodeId: runtime.nodeId, confirmed: true })
      setResetOpen(false)
    } catch (cause) { setResetError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setResetPending(false) }
  }
  if (!['error', 'recovering'].includes(runtime.status)) return null
  return <div className="space-y-2 text-xs leading-5">
    {runtime.status === 'recovering' && <div role="status" className="text-amber-600 dark:text-amber-400">
      <p>{text('recoveryNotice', { attempt: Math.max(1, runtime.retryAttempt ?? 1) })}</p>
      {runtime.retryAt != null && <p>{text('recoveryNext', { time: formatTimestamp(runtime.retryAt, true) })}</p>}
      {runtime.retryDeadline != null && <p>{text('recoveryDeadline', { time: formatTimestamp(runtime.retryDeadline, true) })}</p>}
    </div>}
    <p className="text-[11px] text-muted-foreground">{text('nodeRefreshHint')}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => { void onCommand({ type: 'node-refresh', nodeId: runtime.nodeId }).catch(() => {}) }}>
      <RefreshCw className="size-3.5" />{text(runtime.status === 'recovering' ? 'retryNodeNow' : 'refreshNode')}
    </Button>
      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={disabled} onClick={() => { setResetError(''); setResetOpen(true) }}>
        <Trash2 className="size-3.5" />{text('resetNode')}
      </Button>
    </div>
    <Dialog open={resetOpen} onOpenChange={open => { if (!resetPending) setResetOpen(open) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{text('resetNodeConfirm', { name: nodeName ?? runtime.nodeId })}</DialogTitle><DialogDescription>{text('resetNodeDescription')}</DialogDescription></DialogHeader>
        <p className="text-sm text-muted-foreground">{text('resetNodePreserved')}</p>
        {resetError && <p role="alert" className="break-words text-sm text-destructive">{resetError}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={resetPending} onClick={() => setResetOpen(false)}>{text('cancel')}</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => void reset()}>{resetPending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{text(resetPending ? 'resettingNode' : 'resetNode')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
