import { gatewayHeaders as sharedHeaders } from '@buku/web-security/gateway-headers';

export { withQuery } from '@buku/web-security/gateway-headers';

/**
 * What the website's server adds to every call it makes to the API gateway: the
 * request id, the session's access token, and the visitor's address with the
 * website's key (D-084) — both or neither (the shared rule).
 */
export const gatewayHeaders = (
  base: HeadersInit | undefined,
  call: {
    requestId?: string | undefined;
    accessToken?: string | undefined;
    visitor?: string | undefined;
    webKey?: string | undefined;
  },
) =>
  sharedHeaders(base, {
    requestId: call.requestId,
    accessToken: call.accessToken,
    visitor: call.visitor,
    key: { header: 'x-buku-web-key', value: call.webKey },
  });
