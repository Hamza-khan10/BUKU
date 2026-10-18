/**
 * Paddle's sandbox notifications into a local stack (D3g.1, docs/PADDLE_SANDBOX.md).
 *
 * Paddle can only deliver webhooks to a public HTTPS address. A tunnel gives one, but a tunnel
 * straight to the gateway would put the whole development stack on the internet — including the
 * development sign-in, which needs no password. This relay is what the tunnel points at instead:
 * it listens on 127.0.0.1 only, forwards exactly `POST /v1/billing/webhooks/paddle` to the
 * gateway (the body byte for byte, with the signature header), and answers 404 to everything
 * else. billing-service checks every signature, so a forged request is refused there too.
 *
 *   tsx scripts/paddle-webhook-relay.ts             listens on 127.0.0.1:8099 → gateway :8000
 *   RELAY_PORT=9000 GATEWAY_URL=http://127.0.0.1:8000 tsx scripts/paddle-webhook-relay.ts
 *
 * Development only: it refuses to forward anywhere but this machine.
 */
import { createServer } from 'node:http';

const PATH = '/v1/billing/webhooks/paddle';
const MAX_BODY = 1024 * 1024;
const port = Number(process.env.RELAY_PORT ?? 8099);
const gateway = new URL(process.env.GATEWAY_URL ?? 'http://127.0.0.1:8000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname)) {
  throw new Error('the relay only forwards to this machine (GATEWAY_URL must be localhost)');
}

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
/**
 * What a stranger sent, made safe to log: with the tunnel open anyone can reach the relay, so
 * line breaks and other control characters (which could fake log lines) are replaced, and it's cut short.
 */
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const shown = (value: string | undefined) => (value ?? '').slice(0, 120).replace(CONTROL, '?');

const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (req.method !== 'POST' || path !== PATH) {
    log(`refused ${shown(req.method)} ${shown(path)}`);
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      log('refused: body too large');
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.headersSent) return;
    const headers: Record<string, string> = {
      'content-type': req.headers['content-type'] ?? 'application/json',
    };
    const signature = req.headers['paddle-signature'];
    if (typeof signature === 'string') headers['paddle-signature'] = signature;
    fetch(new URL(PATH, gateway), {
      method: 'POST',
      headers,
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (upstream) => {
        const body = Buffer.from(await upstream.arrayBuffer());
        log(`forwarded ${size} bytes → ${upstream.status}`);
        res.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'text/plain',
        });
        res.end(body);
      })
      .catch((err: unknown) => {
        log(`gateway unreachable: ${err instanceof Error ? err.message : String(err)}`);
        res.writeHead(502).end();
      });
  });
});

server.listen(port, '127.0.0.1', () => log(`relay on 127.0.0.1:${port}: POST ${PATH} → ${gateway.origin}`));
