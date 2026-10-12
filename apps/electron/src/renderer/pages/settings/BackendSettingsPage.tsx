import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppShellContext } from '@/context/AppShellContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { BackendFrameworkSettings } from './BackendFrameworkSettings'

export const meta: DetailsPageMeta = { navigator: 'settings', slug: 'backends' }

export default function BackendSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const onChanged = useCallback(() => {}, [])
  return <div className="flex h-full flex-col">
    <PanelHeader title={t('settings.backends.title')} />
    <div className="min-h-0 flex-1 mask-fade-y">
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-4xl space-y-7 px-5 py-7">
          <p className="text-sm text-muted-foreground">{t('settings.backends.description')}</p>
          <BackendFrameworkSettings workspaceId={activeWorkspaceId} onChanged={onChanged} />
        </div>
      </ScrollArea>
    </div>
  </div>
}
