import tokenBirdIcon from '@/assets/branding/tokenbird.png'

interface TokenBirdSymbolProps {
  className?: string
}

/**
 * TokenBird symbol.
 */
export function TokenBirdSymbol({ className }: TokenBirdSymbolProps) {
  return (
    <img
      src={tokenBirdIcon}
      alt=""
      className={className}
    />
  )
}
