/**
 * Light, dark, or the device's setting. The choice is a small cookie (not
 * personal data, no tracking) that the server reads, so pages arrive in the
 * right colours with no flash.
 */
export const THEME_COOKIE = 'buku_theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function themeFrom(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
