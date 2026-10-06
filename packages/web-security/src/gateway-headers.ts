import { REQUEST_ID_HEADER } from './request-id';

/** What `new Headers()` accepts (written this way so it works without the DOM types). */
type HeadersBase = ConstructorParameters<typeof Headers>[0];

/**
 * What a web server adds to every call it makes to the API gateway:
 *  • the request id, so the call can be found in the API's logs;
 *  • the session's access token, when there is one (never from the browser);
 *  • its key, and the visitor's address the key makes the gateway believe
 *    (D-084). The website's key travels only with an address; the admin app's
 *    goes on every call, because admin routes answer nothing else (D-091).
 */
export function gatewayHeaders(
  base: HeadersBase,
  call: {
    requestId?: string | undefined;
    accessToken?: string | undefined;
    visitor?: string | undefined;
    key?: { header: 'x-buku-web-key' | 'x-buku-admin-key'; value: string | undefined; always?: boolean };
  },
): Headers {
  const headers = new Headers(base);
  if (call.requestId) headers.set(REQUEST_ID_HEADER, call.requestId);
  if (call.accessToken) headers.set('authorization', `Bearer ${call.accessToken}`);
  const key = call.key?.value;
  if (key && (call.visitor || call.key?.always)) headers.set(call.key!.header, key);
  if (key && call.visitor) headers.set('x-buku-client-ip', call.visitor);
  return headers;
}

/** "/v1/businesses/search?q=hair&city=Lahore" — empty values left out, in the order given. */
export function withQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
