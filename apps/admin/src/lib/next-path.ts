/**
 * Where to go after renewing a session: only a path of this app, never another
 * site ("//evil.example", "/\evil.example") and never the sign-in pages again.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/^\/(signin|api)(\/|\?|$)/.test(value)) return '/';
  return value.length > 512 ? '/' : value;
}
