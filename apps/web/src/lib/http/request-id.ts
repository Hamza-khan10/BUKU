/**
 * Every request gets an id that follows it through the web server, the
 * gateway and the services' logs, and is shown on error screens so support
 * can find exactly what happened. Same rule as the services: an incoming id
 * is kept only if it is short and boring.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function requestIdFrom(incoming: string | null | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
