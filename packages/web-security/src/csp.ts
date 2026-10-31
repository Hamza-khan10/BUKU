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
  /**
   * Object storage itself, where signed links point: private pictures load
   * from it and uploads go straight to it, e.g. "https://fra1.digitaloceanspaces.com".
   */
  storageOrigin?: string | undefined;
  /** Any further exact origins pictures may load from (e.g. a sign-in provider's). */
  imageOrigins?: readonly string[] | undefined;
  /**
   * The checkout page only: Paddle.js (the merchant of record's checkout, D-119) may load, style
   * itself, talk to Paddle and show its payment frame — the sandbox's or the live one, never both.
   */
  payments?: 'sandbox' | 'production' | undefined;
}

/** Paddle.js itself, then the sandbox's own assets (its styles come from there); the payment frame. */
const PADDLE_CDN = {
  sandbox: 'https://cdn.paddle.com https://sandbox-cdn.paddle.com',
  production: 'https://cdn.paddle.com',
};
const PADDLE_CHECKOUT = { sandbox: 'https://sandbox-buy.paddle.com', production: 'https://buy.paddle.com' };

export function buildCsp({
  nonce,
  dev,
  mediaOrigin,
  storageOrigin,
  imageOrigins = [],
  payments,
}: CspOptions): string {
  const media = mediaOrigin ? ` ${mediaOrigin}` : '';
  const storage = storageOrigin ? ` ${storageOrigin}` : '';
  const pictures = storageOrigin && storageOrigin !== mediaOrigin ? `${media}${storage}` : media || storage;
  const extra = imageOrigins.map((o) => ` ${o}`).join('');
  // Paddle's script still needs this response's nonce: with 'strict-dynamic' a host alone admits nothing.
  const paddle = payments ? ` ${PADDLE_CDN[payments]}` : '';
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self' 'nonce-${nonce}' 'strict-dynamic'${paddle}${dev ? " 'unsafe-eval'" : ''}`,
    'style-src': `'self' 'unsafe-inline'${paddle}`,
    'img-src': `'self' data: blob:${pictures}${extra}${paddle}`,
    'media-src': `'self'${media}`,
    'font-src': `'self'${paddle}`,
    'connect-src': `'self'${storage}${payments ? ' https://*.paddle.com' : ''}${dev ? ' ws: wss:' : ''}`,
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'frame-src': payments ? PADDLE_CHECKOUT[payments] : "'none'",
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
