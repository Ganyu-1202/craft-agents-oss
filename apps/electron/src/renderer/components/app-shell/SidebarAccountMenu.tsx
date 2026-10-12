import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, LogIn, LogOut, Plus, Settings, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { resolveEffectiveConnectionSlug } from '@config/llm-connections'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { navigate, routes } from '@/lib/navigate'
import {
  DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent,
  StyledDropdownMenuItem, StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

function accountIdentity(connection: { isAuthenticated: boolean; oauthProvider?: string; oauthAccountUsername?: string; oauthAccountEmail?: string }) {
  if (!connection.isAuthenticated) return undefined
  return (connection.oauthProvider === 'tokennest' ? connection.oauthAccountUsername?.trim() : undefined)
    || connection.oauthAccountEmail?.trim()
}

/** The focused chat's connection, or the workspace default outside a chat. */
export function SidebarAccountMenu({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation()
  const context = useAppShellContext()
  const metadata = useAtomValue(sessionMetaMapAtom)
  const [busy, setBusy] = React.useState(false)
  const operationPending = React.useRef(false)
  const [logoutSlug, setLogoutSlug] = React.useState<string | null>(null)
  const slug = resolveEffectiveConnectionSlug(
    sessionId ? metadata.get(sessionId)?.llmConnection : undefined,
    context.workspaceDefaultLlmConnection,
    context.llmConnections,
  )
  const connection = context.llmConnections.find(item => item.slug === slug)
  const authenticated = connection?.isAuthenticated === true
  const identity = connection ? accountIdentity(connection) : undefined
  const title = identity || connection?.name || t('sidebar.account.noAccount')
  const subtitle = !connection ? t('sidebar.account.addConnection')
    : !authenticated ? t('sidebar.account.signedOut')
    : identity ? connection.name : t('sidebar.account.currentConnection')
  const logoutConnection = context.llmConnections.find(item => item.slug === logoutSlug)
  const openSettings = () => navigate(routes.view.settings('ai'))

  const switchConnection = async (nextSlug: string) => {
    if (operationPending.current || nextSlug === slug) return
    const next = context.llmConnections.find(item => item.slug === nextSlug)
    if (!next?.isAuthenticated) return
    operationPending.current = true
    setBusy(true)
    try {
      const result = context.activeWorkspaceId
        ? await window.electronAPI.setWorkspaceDefaultLlmConnection(context.activeWorkspaceId, nextSlug)
        : await window.electronAPI.setDefaultLlmConnection(nextSlug)
      if (!result.success) throw new Error('Connection switch failed')
      // Existing chats keep their provider and context. Start a fresh chat with
      // the selected account, using explicit options rather than a stale default.
      if (sessionId && context.activeWorkspaceId) {
        const created = await context.onCreateSession(context.activeWorkspaceId, { llmConnection: nextSlug })
        navigate(routes.view.allSessions(created.id))
      }
      await context.refreshLlmConnections()
      toast.success(t('sidebar.account.switched', { name: next.name }))
    } catch {
      // A default may have been saved before chat creation failed; refresh it.
      await context.refreshLlmConnections().catch(() => {})
      toast.error(t('sidebar.account.switchFailed'))
    } finally {
      operationPending.current = false
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (!logoutSlug || operationPending.current) return
    operationPending.current = true
    setBusy(true)
    try {
      const result = await window.electronAPI.logoutLlmConnection(logoutSlug)
      if (!result.success) throw new Error('Sign out failed')
      setLogoutSlug(null)
      await context.refreshLlmConnections()
      toast.success(t('sidebar.account.signedOutSuccess'))
    } catch {
      await context.refreshLlmConnections().catch(() => {})
      toast.error(t('sidebar.account.signOutFailed'))
    } finally {
      operationPending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 px-2 pb-2 pt-2" onKeyDown={event => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={t('sidebar.account.menuLabel', { name: title })}
            data-testid="sidebar-account-trigger"
            className="flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-foreground/[0.07] px-2.5 py-2.5 text-left transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white" aria-hidden="true">
              {connection ? Array.from(title)[0]?.toLocaleUpperCase() : <UserRound className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-5" title={title}>{title}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground" title={subtitle}>{subtitle}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 max-w-[calc(100vw-24px)] whitespace-normal">
          <div className="px-2 py-2">
            <p className="text-[10px] font-medium text-muted-foreground">{t('sidebar.account.currentConnection')}</p>
            <p className="truncate text-sm font-semibold">{connection?.name || t('sidebar.account.noAccount')}</p>
            {identity && <p className="truncate text-xs text-muted-foreground" title={identity}>{identity}</p>}
          </div>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem onSelect={openSettings}>
            <Settings /><span>{t('sidebar.account.settings')}</span>
          </StyledDropdownMenuItem>
          {!authenticated && <StyledDropdownMenuItem onSelect={openSettings}>
            <LogIn /><span>{t('sidebar.account.signIn')}</span>
          </StyledDropdownMenuItem>}
          <StyledDropdownMenuSeparator />
          <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">{t('sidebar.account.switchAccount')}</p>
          {sessionId && <p className="px-2 pb-1 text-xs text-muted-foreground">{t('sidebar.account.switchHint')}</p>}
          <div className="max-h-52 overflow-y-auto">
            {context.llmConnections.map(item => <StyledDropdownMenuItem
              key={item.slug}
              disabled={busy || !item.isAuthenticated}
              onSelect={() => { void switchConnection(item.slug) }}
              data-testid={`sidebar-account-${item.slug}`}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold" aria-hidden="true">
                {Array.from(accountIdentity(item) || item.name)[0]?.toLocaleUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{item.isAuthenticated ? accountIdentity(item) : t('sidebar.account.signedOut')}</span>
              </span>
              {item.slug === slug && <Check className="size-3.5 shrink-0" aria-label={t('sidebar.account.currentConnection')} />}
            </StyledDropdownMenuItem>)}
          </div>
          <StyledDropdownMenuItem onSelect={openSettings}><Plus /><span>{t('sidebar.account.addAccount')}</span></StyledDropdownMenuItem>
          {authenticated && connection.authType !== 'none' && connection.authType !== 'environment' && <>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem variant="destructive" onSelect={() => setLogoutSlug(connection.slug)}><LogOut /><span>{t('sidebar.account.signOut')}</span></StyledDropdownMenuItem>
          </>}
        </StyledDropdownMenuContent>
      </DropdownMenu>
      <Dialog open={logoutSlug !== null} onOpenChange={open => { if (!open && !busy) setLogoutSlug(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sidebar.account.signOut')}</DialogTitle>
            <DialogDescription>{t('sidebar.account.signOutDescription', { name: logoutConnection?.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setLogoutSlug(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => { void signOut() }}>{t('sidebar.account.signOut')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
