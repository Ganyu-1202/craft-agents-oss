import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import type { AgentPluginManifest } from '@tokenbird/shared/agent-plugins/types'

/** Register a local bridge manifest; framework runtime downloads have their own verified recipes. */
export function AgentPluginInstaller({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const { t } = useTranslation()
  const [manifest, setManifest] = useState<AgentPluginManifest | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  async function select(file?: File) {
    setManifest(null); setFeedback(''); setFailed(false)
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 512 * 1024) throw new Error('manifest too large')
      const value = JSON.parse(await file.text())
      if (value.schemaVersion !== 1 || typeof value.id !== 'string' || !/^plugin:[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)
        || typeof value.name !== 'string' || typeof value.transport?.command !== 'string' || value.transport.type !== 'stdio') throw new Error('invalid manifest')
      setManifest(value)
    } catch { setFailed(true); setFeedback(t('settings.backends.invalidManifest')) }
    finally { setBusy(false) }
  }
  async function install() {
    if (!manifest) return
    setBusy(true); setFeedback(''); setFailed(false)
    try {
      await window.electronAPI.saveAgentPlugin(manifest)
      setManifest(null); setInputKey(value => value + 1)
      await onInstalled(); setFeedback(t('settings.backends.importSuccess'))
    } catch (error) { setFailed(true); setFeedback(error instanceof Error ? error.message : t('settings.backends.invalidManifest')) }
    finally { setBusy(false) }
  }
  return <SettingsSection title={t('settings.backends.pluginsTitle')} description={t('settings.backends.pluginsHelp')}>
    <SettingsCard><div className="space-y-3 p-4">
      <label className="block text-xs text-muted-foreground">{t('settings.backends.chooseManifest')}
        <input key={inputKey} type="file" accept=".json" disabled={busy} aria-label={t('settings.backends.chooseManifest')}
          className="ml-2 max-w-64 text-xs" onChange={event => { void select(event.target.files?.[0]) }} />
      </label>
      {manifest && <div className="space-y-1 text-xs" data-plugin-preview={manifest.id}>
        <p className="font-medium">{manifest.name} · {manifest.version} · {manifest.id}</p>
        <p className="text-muted-foreground break-all">{manifest.description}</p>
        <p className="text-muted-foreground break-all">{manifest.transport.command}</p>
        {manifest.useConnectionCredentials && <p>{t('settings.backends.credentialsShared')}</p>}
      </div>}
      <Button size="sm" disabled={busy || !manifest} onClick={() => { void install() }}>{t('settings.backends.installPlugin')}</Button>
      {feedback && <p role={failed ? 'alert' : 'status'} className={failed ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{feedback}</p>}
    </div></SettingsCard>
  </SettingsSection>
}
