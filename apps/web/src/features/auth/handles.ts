/**
 * What employees type to sign in: their business's handle and their username.
 * Pure, so the browser and the server read them the same way (and tests can).
 */

// The API's own rules: a business handle is its slug; usernames as the business created them.
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,39}$/;

/**
 * The business handle in what someone typed — the handle itself
 * ("salt-and-pepper", "@salt-and-pepper") or the business's BUKU link
 * pasted whole ("https://…/b/salt-and-pepper?x=1"). Null when it can't be one.
 */
export function businessHandleFrom(input: string | null | undefined): string | null {
  let value = (input ?? '').trim().toLowerCase();
  if (value.length > 500) return null;
  const link = value.lastIndexOf('/b/');
  if (link >= 0) value = value.slice(link + 3).split(/[/?#]/)[0] ?? '';
  value = value.replace(/^@/, '');
  return HANDLE.test(value) ? value : null;
}

/** A username as the API compares it (trimmed, lower case), or null when it can't be one. */
export function usernameFrom(input: string | null | undefined): string | null {
  const value = (input ?? '').trim().toLowerCase();
  return USERNAME.test(value) ? value : null;
}
