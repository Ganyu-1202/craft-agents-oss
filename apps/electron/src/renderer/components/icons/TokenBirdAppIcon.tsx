import tokenBirdIcon from '@/assets/branding/tokenbird.png'
import { useTranslation } from 'react-i18next'
import { getLocalizedProductName } from '@tokenbird/shared/branding'

interface TokenBirdAppIconProps {
  className?: string
  size?: number
}

/**
 * TokenBirdAppIcon - Displays the TokenBird application icon.
 */
export function TokenBirdAppIcon({ className, size = 64 }: TokenBirdAppIconProps) {
  const { i18n } = useTranslation()
  return (
    <img
      src={tokenBirdIcon}
      alt={getLocalizedProductName(i18n.resolvedLanguage ?? i18n.language)}
      width={size}
      height={size}
      className={className}
    />
  )
}
