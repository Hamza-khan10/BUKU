/**
 * The Content-Security-Policy for every page (WEB_PLAN §4). Scripts run only
 * with this response's nonce ('strict-dynamic' lets those scripts load the
 * chunks they need); nothing else may run, embed us, or be embedded.
 *
 * Styles allow inline: React writes style attributes (animations, sizes) and
 * the dialog/toast libraries inject small <style> tags. Injected CSS can't run
 * code, and no secret lives in the page's markup for it to read.
 */
export interface CspOptions {
  nonce: string;
  /** Development: React needs eval for its error overlay, and the dev server a websocket. */
  dev: boolean;
  /** Where pictures are served from (object storage), e.g. "https://media.buku.app". */
  mediaOrigin?: string | undefined;
}

export function buildCsp({ nonce, dev, mediaOrigin }: CspOptions): string {
  const media = mediaOrigin ? ` ${mediaOrigin}` : '';
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    'style-src': "'self' 'unsafe-inline'",
    'img-src': `'self' data: blob:${media}`,
    'media-src': `'self'${media}`,
    'font-src': "'self'",
    'connect-src': `'self'${dev ? ' ws: wss:' : ''}`,
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'frame-src': "'none'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  if (!dev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** A fresh, unguessable nonce (128 bits, base64). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** A configured origin, only if it is exactly an origin (nothing that could add directives). */
export function originOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const { origin } = new URL(value);
    return origin === value.replace(/\/+$/, '') && /^https?:\/\//.test(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
}
