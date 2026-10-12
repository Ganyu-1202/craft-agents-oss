import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { SidebarAccountMenu } from './SidebarAccountMenu'
import './page-sidebar.css'

/** The same left drawer for every page on phones and narrow windows. */
export function PageSidebarSheet({ open, onOpenChange, title, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} showCloseButton={false}
      data-page-sidebar-drawer
      className="flex flex-col gap-0 rounded-none border-r border-border bg-background p-0">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <button aria-label={t('common.close')} className="flex size-11 items-center justify-center rounded-md hover:bg-accent" onClick={() => onOpenChange(false)}><X className="size-4" /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </DialogContent>
  </Dialog>
}

export function PageSidebar({ title, visible, compact, open, onOpenChange, onToggle, children }: {
  title: string
  visible: boolean
  compact: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const appShell = useOptionalAppShellContext()
  const content = <>{children}{appShell && <SidebarAccountMenu sessionId={null} />}</>
  if (compact) return <PageSidebarSheet open={open} onOpenChange={onOpenChange} title={title}>{content}</PageSidebarSheet>
  if (!visible) return null
  return <aside data-page-sidebar className="flex h-full w-56 shrink-0 flex-col border-r border-border/70 bg-muted/20">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
      <span className="text-sm font-semibold">{title}</span>
      <button aria-label={t('menu.toggleSidebar')} title={t('menu.toggleSidebar')} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onToggle}><PanelLeftClose className="size-4" /></button>
    </div>
    {content}
  </aside>
}
