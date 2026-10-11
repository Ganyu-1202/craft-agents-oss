import { useEffect, useRef, useState } from 'react'
import type { CloudConfig, CloudDevice } from '@craft-agent/shared/cloud'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../electron/src/renderer/components/ui/dialog'
import { Button } from '../../electron/src/renderer/components/ui/button'
import { localCloudApi } from './adapter/local-cloud'

export function CloudServerPicker({ open, onOpenChange, connectionMode }: {
  open: boolean; onOpenChange: (open: boolean) => void; connectionMode: 'local' | 'remote'
}) {
  const [devices, setDevices] = useState<CloudDevice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState<string>()
  const [config, setConfig] = useState<CloudConfig>()
  const [accounts, setAccounts] = useState<Array<{ slug: string; name: string }>>([])
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const localRef = useRef<ReturnType<typeof localCloudApi>>()
  useEffect(() => {
    if (!open) return
    let active = true
    let pending = false
    setDevices([]); setError(''); setConnecting(undefined); setConfig(undefined); setAccounts([])
    try { localRef.current = localCloudApi(connectionMode) } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); return
    }
    const local = localRef.current
    void Promise.all([local.api.getCloudConfig(), local.api.listLlmConnectionsWithStatus()]).then(([settings, connections]) => {
      if (active) { setConfig(settings); setAccounts(connections.filter(c => c.oauthProvider === 'tokennest' && c.isAuthenticated).map(c => ({ slug: c.slug, name: c.name }))) }
    }).catch(err => { if (active) setError(String(err)) })
    const refresh = async () => {
      if (pending) return
      pending = true; setLoading(true)
      try {
        const [list, status] = await Promise.all([local.api.listCloudDevices(), local.api.getCloudStatus()])
        if (active) { setDevices(list.filter(device => device.id !== status.deviceId)); setError('') }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : String(err)) }
      finally { pending = false; if (active) setLoading(false) }
    }
    refreshRef.current = refresh
    void refresh()
    const timer = setInterval(() => { void refresh() }, 15_000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', focus); local.close(); localRef.current = undefined }
  }, [open, connectionMode])
  const connect = async (device: CloudDevice) => {
    if (connecting || !localRef.current) return
    const local = localRef.current
    setConnecting(device.id); setError('')
    try {
      if (!window.CraftAgentAndroid?.connectRemoteServer) throw new Error('请更新手机客户端以连接同账号设备。')
      // Tickets expire: obtain one at every click, never reuse a saved ticket.
      const grant = await local.api.connectCloudDevice(device.id)
      if (localRef.current !== local) return
      window.CraftAgentAndroid.connectRemoteServer(grant.url, grant.token)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setConnecting(undefined) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>服务器列表</DialogTitle><DialogDescription>登录相同 TokenNest 账号后，已开启云端远程访问的电脑会自动出现在这里。</DialogDescription></DialogHeader>
      <Button variant="outline" disabled={!!connecting} onClick={() => window.CraftAgentAndroid?.connectLocalServer?.()}>本机服务器</Button>
      {config && accounts.length > 0 && <label className="space-y-1 text-sm">TokenNest 账号
        <select className="w-full rounded border bg-background p-2" value={config.connectionSlug || accounts[0]?.slug} disabled={loading || !!connecting} onChange={event => {
          const next = { ...config, connectionSlug: event.target.value }
          setLoading(true); setDevices([])
          void localRef.current?.api.setCloudConfig(next).then(async () => { setConfig(next); await refreshRef.current() }).catch(err => setError(String(err))).finally(() => setLoading(false))
        }}>{accounts.map(account => <option key={account.slug} value={account.slug}>{account.name}</option>)}</select>
      </label>}
      {config && !accounts.length && <Button variant="outline" onClick={() => { onOpenChange(false); window.CraftAgentAndroid?.connectLocalServer?.() }}>进入本机服务器登录 TokenNest</Button>}
      <div className="flex items-center justify-between"><span className="text-sm">TokenNest 设备</span><Button size="sm" variant="ghost" disabled={loading || !!connecting} onClick={() => refreshRef.current()}>{loading ? '正在刷新…' : '刷新'}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      {!error && !loading && !devices.length && <p className="text-sm text-muted-foreground">暂无设备，请在电脑端开启云端远程访问并保存。</p>}
      {devices.map(device => <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{device.name}</p><p className="text-xs text-muted-foreground">{device.online ? '在线' : '离线'}</p></div>
        <Button size="sm" disabled={!device.online || !!connecting} onClick={() => void connect(device)}>{connecting === device.id ? '正在连接…' : '连接'}</Button>
      </div>)}
      <Button variant="outline" disabled={!!connecting} onClick={() => { onOpenChange(false); window.CraftAgentAndroid?.configureServer() }}>手动添加服务器</Button>
    </DialogContent>
  </Dialog>
}
