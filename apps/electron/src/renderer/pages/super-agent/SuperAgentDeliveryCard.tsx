import { CheckCheck, FileOutput, FolderOpen, MessageSquare, PackageCheck } from 'lucide-react'
import { usePlatform } from '@craft-agent/ui/context'
import type { SuperAgentArtifact, SuperAgentDelivery } from '@craft-agent/shared/super-agent'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import type { SuperAgentText } from './super-agent-ui'

/** A durable handoff in the conversation, so deliveries remain easy to revisit. */
export function SuperAgentDeliveryCard({ delivery, body, artifacts, text, disabled, onReply }: {
  delivery: SuperAgentDelivery
  body: string
  artifacts: SuperAgentArtifact[]
  text: SuperAgentText
  disabled: boolean
  onReply: (title: string) => void
}) {
  const { onOpenFile, onRevealInFinder } = usePlatform()
  const final = delivery.kind === 'final'
  const title = delivery.title ?? text(final ? 'deliveryFinal' : 'deliveryStage')
  const Icon = final ? PackageCheck : MessageSquare
  return <section aria-label={text(final ? 'deliveryFinal' : 'deliveryStage')}
    className="min-w-0 space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-50 p-4 dark:bg-emerald-950/40 sm:p-5">
    <header className="flex items-start gap-2.5 text-emerald-800 dark:text-emerald-300">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0"><p className="text-[10px] font-medium">{text(final ? 'deliveryFinal' : 'deliveryStage')}</p>
        <h3 className="break-words text-sm font-semibold">{title}</h3></div>
    </header>
    <div className="min-w-0 break-words text-sm leading-6"><Markdown>{body}</Markdown></div>
    {delivery.artifacts.length > 0 && <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300"><CheckCheck aria-hidden="true" className="size-3.5" />{text('deliveryArtifacts')}</h4>
      {delivery.artifacts.map(file => {
        const current = artifacts.find(artifact => artifact.id === file.id)
        const unavailable = !current || current.missing === true
        const changed = !unavailable && current.sha256 !== file.sha256
        return <div key={file.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-emerald-500/15 bg-background/65 p-3">
          <FileOutput aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div className="min-w-0 flex-1">
            <button type="button" disabled={unavailable || !onOpenFile} onClick={() => onOpenFile?.(file.path)}
              className="block max-w-full break-all text-left text-xs font-medium underline-offset-4 hover:underline disabled:cursor-default disabled:no-underline">{file.path}</button>
            {file.description && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{file.description}</p>}
            {(unavailable || changed) && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{text(unavailable ? 'deliveryUnavailable' : 'deliveryChanged')}</p>}
          </div>
          {onRevealInFinder && <Button variant="ghost" size="icon" className="size-7 shrink-0" disabled={unavailable}
            aria-label={text('deliveryReveal')} onClick={() => onRevealInFinder(file.path)}><FolderOpen className="size-3.5" /></Button>}
        </div>
      })}
    </div>}
    <footer className="flex justify-end"><Button size="sm" variant="outline" className="border-emerald-500/25 bg-background/60 text-emerald-800 dark:text-emerald-300"
      disabled={disabled} onClick={() => onReply(title)}><MessageSquare className="size-3.5" />{text(final ? 'deliveryFeedback' : 'deliveryRespond')}</Button></footer>
  </section>
}
