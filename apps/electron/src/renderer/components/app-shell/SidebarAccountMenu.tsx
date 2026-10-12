import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, Info, LogIn, LogOut, Plus, RefreshCw, Settings, UserRound } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCreditBalance } from '@/lib/format-credit'
import { TOKENNEST_BALANCE_REFRESH_EVENT } from '@/lib/tokennest-recharge'
import { getAgentChannelGroups, getAgentModelsForConnection } from './input/model-picker-helpers'

type ApiBalance = Awaited<ReturnType<typeof window.electronAPI.getLlmConnectionBalances>>[number]

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
  const [detailsSlug, setDetailsSlug] = React.useState<string | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [balances, setBalances] = React.useState<ApiBalance[]>([])
  const [showBalances, setShowBalances] = React.useState(false)
  const [balanceLoading, setBalanceLoading] = React.useState(true)
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
  const detailsConnection = context.llmConnections.find(item => item.slug === detailsSlug)
  const detailsGroups = detailsConnection ? getAgentChannelGroups(detailsConnection) : []
  const channelName = (item: typeof connection) => item?.oauthProvider === 'tokennest'
    ? item.channelGroups?.find(group => group.id === item.channelGroup)?.name || item.channelGroup || t('sidebar.account.automaticChannel')
    : item?.name || t('common.unavailable')
  const balanceText = (item: typeof connection) => {
    const value = balances.find(balance => balance.connectionSlug === item?.slug)
    return value ? formatCreditBalance(value) : t(balanceLoading ? 'common.loading' : 'common.unavailable')
  }
  const canShowBalance = (item: typeof connection) => showBalances && item?.isAuthenticated
    && (item.oauthProvider === 'tokennest' || balances.some(balance => balance.connectionSlug === item.slug))
  // Refresh independently of chat startup. The server caches provider balances
  // for one minute; recharge completion explicitly bypasses that cache.
  const balanceConnectionsKey = context.llmConnections.map(item =>
    `${item.slug}:${item.isAuthenticated}:${item.oauthAccountUsername}:${item.oauthAccountEmail}`,
  ).join('|')
  React.useEffect(() => { setBalances([]); setBalanceLoading(true) }, [balanceConnectionsKey])
  React.useEffect(() => {
    let cancelled = false
    let requestId = 0
    const refresh = async (event?: Event) => {
      if (document.visibilityState === 'hidden' && event?.type !== TOKENNEST_BALANCE_REFRESH_EVENT) return
      const id = ++requestId
      try {
        const enabled = await window.electronAPI.getShowApiBalances()
        if (cancelled || id !== requestId) return
        setShowBalances(enabled)
        if (!enabled) { setBalances([]); return }
        const next = await window.electronAPI.getLlmConnectionBalances({ forceRefresh: event?.type === TOKENNEST_BALANCE_REFRESH_EVENT })
        if (!cancelled && id === requestId) setBalances(next)
      } catch {
        if (!cancelled && id === requestId) setBalances([])
      } finally {
        if (!cancelled && id === requestId) setBalanceLoading(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 60_000)
    window.addEventListener('focus', refresh)
    window.addEventListener(TOKENNEST_BALANCE_REFRESH_EVENT, refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(TOKENNEST_BALANCE_REFRESH_EVENT, refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [balanceConnectionsKey, menuOpen, detailsSlug])
  const openSettings = () => navigate(routes.view.settings('ai'))

  const refreshChannels = async () => {
    if (!detailsConnection || operationPending.current) return
    operationPending.current = true
    setBusy(true)
    try {
      const result = await window.electronAPI.refreshLlmConnectionModels(detailsConnection.slug)
      if (!result.success) throw new Error(result.error || t('settings.usage.refreshFailed'))
      await context.refreshLlmConnections()
      window.dispatchEvent(new Event(TOKENNEST_BALANCE_REFRESH_EVENT))
      toast.success(t('settings.usage.refreshSucceeded'))
    } catch (error) {
      toast.error(t('settings.usage.refreshFailed'), { description: error instanceof Error ? error.message : String(error) })
    } finally { operationPending.current = false; setBusy(false) }
  }

  const changeChannel = async (channelGroup: string) => {
    if (!detailsConnection || operationPending.current || detailsConnection.channelGroup === channelGroup) return
    const group = detailsConnection.channelGroups?.find(item => item.id === channelGroup)
    if (!group) return
    operationPending.current = true
    setBusy(true)
    try {
      const { isAuthenticated: _auth, isDefault: _default, authError: _error, ...data } = detailsConnection
      const models = getAgentModelsForConnection({ ...detailsConnection, channelGroup })
      const modelIds = models.map(model => typeof model === 'string' ? model : model.id)
      const defaultModel = data.defaultModel && modelIds.includes(data.defaultModel) ? data.defaultModel : modelIds[0] ?? data.defaultModel
      const result = await window.electronAPI.saveLlmConnection({ ...data, channelGroup, defaultModel })
      if (!result.success) throw new Error(result.error || t('settings.ai.channelGroupUpdateFailed'))
      await context.refreshLlmConnections()
      // Keep the focused chat usable if its model is absent from the new group.
      const session = sessionId ? metadata.get(sessionId) : undefined
      if (session && slug === detailsConnection.slug && session.model && modelIds.length && !modelIds.includes(session.model)) {
        await window.electronAPI.setSessionModel(session.id, session.workspaceId, modelIds[0], detailsConnection.slug)
      }
      toast.success(t('settings.usage.groupUpdated'))
    } catch (error) {
      await context.refreshLlmConnections().catch(() => {})
      toast.error(t('settings.ai.channelGroupUpdateFailed'), { description: error instanceof Error ? error.message : String(error) })
    } finally { operationPending.current = false; setBusy(false) }
  }

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
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
              <span className="block truncate text-xs leading-4 text-muted-foreground" title={authenticated ? channelName(connection) : subtitle}>
                {authenticated ? `${t('sidebar.account.currentChannel')}: ${channelName(connection)}` : subtitle}
              </span>
              {canShowBalance(connection) && <span className="block truncate text-xs leading-4 text-muted-foreground tabular-nums" title={balanceText(connection)} data-testid="sidebar-account-balance">
                {t('sidebar.account.remainingCredit')}: {balanceText(connection)}
              </span>}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 max-w-[calc(100vw-24px)] whitespace-normal">
          <div className="px-2 py-2">
            <p className="text-[10px] font-medium text-muted-foreground">{t('sidebar.account.currentConnection')}</p>
            <p className="truncate text-sm font-semibold">{connection?.name || t('sidebar.account.noAccount')}</p>
            {identity && <p className="truncate text-xs text-muted-foreground" title={identity}>{identity}</p>}
            {authenticated && <p className="mt-1 truncate text-xs text-muted-foreground">{t('sidebar.account.currentChannel')}: {channelName(connection)}</p>}
            {canShowBalance(connection) && <p className="mt-1 text-xs tabular-nums">{t('sidebar.account.remainingCredit')}: {balanceText(connection)}</p>}
          </div>
          <StyledDropdownMenuSeparator />
          {connection && <StyledDropdownMenuItem onSelect={() => {
            setMenuOpen(false)
            const targetSlug = connection.slug
            requestAnimationFrame(() => setDetailsSlug(targetSlug))
          }}>
            <Info /><span>{t('sidebar.account.details')}</span>
          </StyledDropdownMenuItem>}
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
      <Dialog open={detailsSlug !== null && !!detailsConnection} onOpenChange={open => { if (!open && !busy) setDetailsSlug(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sidebar.account.details')}</DialogTitle>
            <DialogDescription>{t('sidebar.account.detailsDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">{detailsConnection?.name}</p>
              {detailsConnection && accountIdentity(detailsConnection) && <p className="break-all text-xs text-muted-foreground">{accountIdentity(detailsConnection)}</p>}
            </div>
            {canShowBalance(detailsConnection) && <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t('sidebar.account.remainingCredit')}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{balanceText(detailsConnection)}</p>
            </div>}
            <div className="space-y-2">
              <p id="account-channel-label" className="text-sm font-medium">{t('sidebar.account.currentChannel')}</p>
              {detailsConnection?.oauthProvider === 'tokennest' && detailsConnection.isAuthenticated && !!detailsGroups.length
                ? <Select value={detailsGroups.some(group => group.id === detailsConnection.channelGroup) ? `group:${detailsConnection.channelGroup}` : ''} onValueChange={value => { void changeChannel(value.slice(6)) }} disabled={busy}>
                  <SelectTrigger aria-labelledby="account-channel-label"><SelectValue placeholder={channelName(detailsConnection)} /></SelectTrigger>
                  <SelectContent className="z-floating-menu max-w-[calc(100vw-2rem)]" collisionPadding={16}>{detailsGroups.map(group => <SelectItem key={group.id} value={`group:${group.id}`}>
                    {group.name}
                    {group.ratio != null && <span className="ml-2 text-xs text-muted-foreground">{t('settings.ai.channelGroupRatio', { ratio: group.ratio })}</span>}
                  </SelectItem>)}</SelectContent>
                </Select>
                : <p className="text-sm text-muted-foreground">{channelName(detailsConnection)}</p>}
              {detailsConnection?.oauthProvider === 'tokennest' && detailsConnection.isAuthenticated && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void refreshChannels() }}>
                <RefreshCw className={busy ? 'mr-1.5 size-3.5 animate-spin' : 'mr-1.5 size-3.5'} />{t('sidebar.account.refreshChannels')}
              </Button>}
            </div>
          </div>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDetailsSlug(null)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
