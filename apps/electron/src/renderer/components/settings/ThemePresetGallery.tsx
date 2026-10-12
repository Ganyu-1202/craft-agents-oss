import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { PresetTheme } from '@config/theme'
import { getThemePreviewPalette } from '@config/theme-presentation'
import { cn } from '@/lib/utils'

/** A miniature workspace uses each preset's real surface palette. */
export function ThemePresetGallery({ themes, selected, dark, onSelect }: {
  themes: PresetTheme[]
  selected: string | null
  dark: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  return <div className="grid gap-3 px-4 pb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
    {themes.map(({ id, theme }) => {
      const colors = getThemePreviewPalette(theme, dark)
      const active = selected === id
      return <button key={id} type="button" aria-pressed={active} onClick={() => onSelect(id)}
        className={cn('group overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'border-accent bg-accent/5' : 'border-foreground/10 hover:border-accent/50')}
      >
        <div aria-hidden="true" className="flex h-24 p-2" style={{ background: colors.background, color: colors.foreground }}>
          <div className="w-1/4 rounded-l-md p-2" style={{ background: colors.navigator }}>
            <div className="mb-2 h-1.5 w-3 rounded" style={{ background: colors.accent }} />
            {[0, 1, 2, 3].map(i => <div key={i} className="mt-2 h-1 rounded opacity-25" style={{ background: colors.foreground }} />)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
            <div className="h-1 w-1/2 rounded opacity-35" style={{ background: colors.foreground }} />
            <div className="flex-1 rounded p-2" style={{ background: colors.paper }}>
              <div className="h-1 w-4/5 rounded opacity-25" style={{ background: colors.foreground }} />
              <div className="mt-1.5 h-1 w-1/2 rounded opacity-20" style={{ background: colors.foreground }} />
            </div>
            <div className="flex h-4 items-center justify-end rounded px-1" style={{ background: colors.input }}>
              <div className="size-2 rounded-full" style={{ background: colors.accent }} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0"><div className="truncate text-xs font-medium">{theme.name ?? id}</div>
            <div className="mt-1 flex gap-1.5">{[colors.background, colors.navigator, colors.paper, colors.accent].map((color, i) => <span key={i} className="size-2.5 rounded-full ring-1 ring-foreground/10" style={{ background: color }} />)}</div>
          </div>
          {active ? <Check className="size-4 shrink-0 text-accent" /> : theme.supportedModes?.length === 1 ? <span className="text-[10px] text-muted-foreground">{t(`settings.appearance.${theme.supportedModes[0]}`)}</span> : null}
        </div>
      </button>
    })}
  </div>
}
