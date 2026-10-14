import { useTranslation } from 'react-i18next'
import { Check, LoaderCircle, Wrench, X } from 'lucide-react'
import type { StudioWorkEvent } from '@craft-agent/shared/protocol'

export function StudioWorkLog({ events, busy, answer }: { events: StudioWorkEvent[]; busy?: boolean; answer?: boolean }) {
  const { t } = useTranslation()
  const output = events.findLast(event => event.type === 'output')
  return <details open={busy || undefined} className="mt-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
    <summary className="cursor-pointer text-muted-foreground">{t('studio.workProcess')}</summary>
    <ol className="mt-2 space-y-2" aria-live="polite">
      {events.map((event, index) => <li key={index} className="flex items-start gap-2 break-words text-muted-foreground">
        {event.type === 'tool'
          ? event.status === 'running' ? <LoaderCircle className="mt-0.5 size-3 shrink-0 animate-spin" /> : event.status === 'error' ? <X className="mt-0.5 size-3 shrink-0 text-destructive" /> : <Check className="mt-0.5 size-3 shrink-0" />
          : <Wrench className="mt-0.5 size-3 shrink-0" />}
        <span>{event.type === 'tool'
          ? <>{event.tool === 'read_project_file' ? t('studio.workReadFile') : event.tool === 'list_project_files' ? t('studio.workListFiles') : event.tool}<span className="ml-1 font-mono">{event.detail}</span></>
          : event.type === 'output' ? t('studio.workReceiving', { count: event.characters ?? 0 }) : t(`studio.workPhase.${event.phase}`)}</span>
      </li>)}
    </ol>
    {busy && answer && output?.text && <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-t border-border pt-2 leading-5">{output.text}</div>}
  </details>
}

export function appendStudioWorkEvent(events: StudioWorkEvent[], event: StudioWorkEvent): StudioWorkEvent[] {
  // Retain a small transcript while updating the current output and tool status.
  const last = events.at(-1)
  if (last?.type === event.type && ((event.type === 'output')
    || (event.type === 'phase' && last.phase === event.phase)
    || (event.type === 'tool' && last.tool === event.tool && last.detail === event.detail && last.status === 'running'))) {
    return [...events.slice(0, -1), event]
  }
  return [...events, event].slice(-100)
}
