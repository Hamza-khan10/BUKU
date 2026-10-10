import { buildCsp as sharedCsp, type CspOptions } from '@buku/web-security/csp';

export { newNonce, originOnly, type CspOptions } from '@buku/web-security/csp';

/**
 * Where someone's sign-in provider keeps their picture: a person who signed in
 * with Google sees their own Google picture on their account button (D-051).
 */
const SIGN_IN_PICTURES = 'https://lh3.googleusercontent.com';

/** The website's policy: the shared one, plus Google account pictures. */
export const buildCsp = (options: Omit<CspOptions, 'imageOrigins'>) =>
  sharedCsp({ ...options, imageOrigins: [SIGN_IN_PICTURES] });
