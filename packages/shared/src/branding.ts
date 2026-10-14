/**
 * Centralized branding assets for TokenBird
 * Used by OAuth callback pages
 */

export const TOKENBIRD_LOGO = [
  'TokenBird',
  '词元鸟',
] as const;

export const PRODUCT_NAME_EN = 'TokenBird';
export const PRODUCT_NAME_ZH = '词元鸟';

/** Resolve the user-visible product name without changing technical identifiers. */
export function getLocalizedProductName(language?: string | null): string {
  return language?.trim().toLowerCase().startsWith('zh')
    ? PRODUCT_NAME_ZH
    : PRODUCT_NAME_EN;
}

/** Logo as a single string for HTML templates */
export const TOKENBIRD_LOGO_HTML = TOKENBIRD_LOGO.map((line) => line.trimEnd()).join('\n');
