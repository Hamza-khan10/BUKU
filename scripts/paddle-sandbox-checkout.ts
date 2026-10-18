/**
 * A test checkout page for Paddle's sandbox (D3g.1, docs/PADDLE_SANDBOX.md), until the website
 * has its own (D3i).
 *
 * billing-service starts a payment as a Paddle transaction; Paddle's checkout link points at the
 * account's "default payment link" with `?_ptxn=<transaction>`, and the page there must load
 * Paddle.js, which opens the checkout for that transaction. This serves that page on
 * 127.0.0.1:8098/checkout (set the sandbox's default payment link to
 * http://localhost:8098/checkout). It needs only the public client-side token, read from .env;
 * nothing is sent to it, and it refuses anything but the sandbox.
 *
 *   tsx scripts/paddle-sandbox-checkout.ts
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

process.loadEnvFile('.env');
const token = process.env.PADDLE_CLIENT_TOKEN ?? '';
if (process.env.PADDLE_ENVIRONMENT !== 'sandbox' || !/^test_[a-z0-9]{10,64}$/.test(token)) {
  throw new Error('sandbox only: PADDLE_ENVIRONMENT=sandbox and a sandbox client token (test_…) in .env');
}
const port = Number(process.env.CHECKOUT_PORT ?? 8098);

const page = (nonce: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BUKU sandbox checkout</title>
<style nonce="${nonce}">body{font:16px system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
.note{background:#fff4d6;border-radius:8px;padding:.75rem 1rem}#status{margin-top:1rem;font-weight:600}</style>
<script nonce="${nonce}" src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
</head><body>
<h1>BUKU sandbox checkout</h1>
<p class="note">Test only: Paddle's sandbox, no real money. Card 4242 4242 4242 4242, any future expiry, CVC 100.</p>
<p id="status">Opening Paddle's checkout…</p>
<script nonce="${nonce}">
  const status = document.getElementById('status');
  if (!new URLSearchParams(location.search).get('_ptxn')) {
    status.textContent = 'No payment to show: start one from BUKU (it opens this page with ?_ptxn=…).';
  }
  Paddle.Environment.set('sandbox');
  Paddle.Initialize({
    token: ${JSON.stringify(token)},
    eventCallback(event) {
      if (event.name === 'checkout.completed') {
        status.textContent = 'Paid in the sandbox. BUKU hears about it from Paddle in a few seconds.';
      } else if (event.name === 'checkout.closed') {
        status.textContent = 'Checkout closed.';
      }
    },
  });
</script>
</body></html>`;

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (req.method !== 'GET' || path !== '/checkout') {
    res.writeHead(404).end();
    return;
  }
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    // Paddle.js and its checkout frame only.
    'content-security-policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://cdn.paddle.com`,
      // Paddle.js adds inline styles; a nonce here would switch 'unsafe-inline' off.
      "style-src 'unsafe-inline' https://cdn.paddle.com",
      'frame-src https://sandbox-buy.paddle.com',
      'connect-src https://*.paddle.com',
      'img-src https: data:',
      'font-src https: data:',
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  });
  res.end(page(nonce));
}).listen(port, '127.0.0.1', () => console.log(`sandbox checkout page on http://localhost:${port}/checkout`));
