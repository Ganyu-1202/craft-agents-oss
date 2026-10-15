import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { SettingsRow, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'

function Range({ label, value, min = 0, max = 100, unit = '%', onChange }: {
  label: string; value: number; min?: number; max?: number; unit?: string; onChange: (value: number) => void
}) {
  return <div className="flex items-center gap-3"><input type="range" aria-label={label} min={min} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))} className="w-28 accent-accent sm:w-32" />
    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{value}{unit}</span></div>
}

export function ThemePresentationSettings() {
  const { t } = useTranslation()
  const { isScenic, activeThemePack, presentation, setPresentation, resetPresentation } = useTheme()
  const hasCharacters = Boolean(activeThemePack?.manifest.live2d || activeThemePack?.manifest.characters?.left || activeThemePack?.manifest.characters?.right)
  if (!isScenic && !hasCharacters) return null
  return <div className="mt-3 overflow-hidden rounded-xl border border-foreground/10 bg-foreground/[0.02]">
    <div className="flex items-center justify-between gap-3 px-4 pt-2.5"><span className="text-xs font-medium text-muted-foreground">{t('settings.appearance.themeAdjustments')}</span>
      <Button variant="ghost" size="sm" onClick={resetPresentation}><RotateCcw className="mr-1.5 size-3.5" />{t('settings.appearance.resetThemeAdjustments')}</Button>
    </div>
    {isScenic && <>
      <SettingsRow label={t('settings.appearance.backgroundDim')}><Range label={t('settings.appearance.backgroundDim')} value={Math.round(presentation.backgroundDim * 100)} max={80} onChange={value => setPresentation({ backgroundDim: value / 100 })} /></SettingsRow>
      <SettingsRow label={t('settings.appearance.glassBlur')}><Range label={t('settings.appearance.glassBlur')} value={presentation.glassBlur} max={24} unit="px" onChange={value => setPresentation({ glassBlur: value })} /></SettingsRow>
    </>}
    {hasCharacters && <>
      <SettingsToggle label={t('settings.appearance.showCharacters')} checked={presentation.showCharacters} onCheckedChange={value => setPresentation({ showCharacters: value })} />
      {presentation.showCharacters && <>
        <SettingsRow label={t('settings.appearance.characterOpacity')}><Range label={t('settings.appearance.characterOpacity')} value={Math.round(presentation.characterOpacity * 100)} onChange={value => setPresentation({ characterOpacity: value / 100 })} /></SettingsRow>
        <SettingsRow label={t('settings.appearance.characterScale')}><Range label={t('settings.appearance.characterScale')} value={Math.round(presentation.characterScale * 100)} min={50} max={150} onChange={value => setPresentation({ characterScale: value / 100 })} /></SettingsRow>
      </>}
    </>}
  </div>
}
