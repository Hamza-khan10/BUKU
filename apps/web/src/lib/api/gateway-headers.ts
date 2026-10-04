import { REQUEST_ID_HEADER } from '../http/request-id';

/**
 * What the web server adds to every call it makes to the API gateway. Pure,
 * so the rules are tested on their own:
 *  • the request id, so the call can be found in the API's logs;
 *  • the session's access token, when there is one (never from the browser);
 *  • the visitor's address — with the key that makes the gateway believe it
 *    (D-084). Both or neither: the key never travels without an address, and
 *    an address without the key would be ignored.
 */
export function gatewayHeaders(
  base: HeadersInit | undefined,
  call: {
    requestId?: string | undefined;
    accessToken?: string | undefined;
    visitor?: string | undefined;
    webKey?: string | undefined;
  },
): Headers {
  const headers = new Headers(base);
  if (call.requestId) headers.set(REQUEST_ID_HEADER, call.requestId);
  if (call.accessToken) headers.set('authorization', `Bearer ${call.accessToken}`);
  if (call.visitor && call.webKey) {
    headers.set('x-buku-web-key', call.webKey);
    headers.set('x-buku-client-ip', call.visitor);
  }
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
