import { originOnly } from '@/lib/security/csp';
import { siteFacts } from '@/lib/site';

/**
 * security.txt (RFC 9116): where to report a vulnerability. Served only once
 * a real security address is configured — never a placeholder.
 */
export function GET(): Response {
  const contact = siteFacts().email.security;
  if (!contact) return new Response('Not found', { status: 404 });
  const site = originOnly(process.env.APP_URL);
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = [
    `Contact: mailto:${contact}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    ...(site ? [`Canonical: ${site}/.well-known/security.txt`, `Policy: ${site}/security`] : []),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
