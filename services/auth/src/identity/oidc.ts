import { AppError, ErrorCodes } from '@buku/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/**
 * Verifies ID tokens from "Sign in with Google / Apple" SERVER-SIDE.
 *
 * The client (web or app) gets an ID token from Google/Apple and sends it to
 * us. We never trust what the client says about who the user is: we verify
 * the token's signature against the provider's published keys, and check the
 * issuer, the audience (it must be minted for OUR client id, not some other
 * app's), expiry, and that the email is verified.
 */
export type OidcProvider = 'google' | 'apple';

export interface VerifiedIdentity {
  provider: OidcProvider;
  /** Stable provider-side user id (`sub`). Never changes, unlike the email. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

export interface OidcVerifier {
  verify(idToken: string): Promise<VerifiedIdentity>;
}

interface ProviderSettings {
  provider: OidcProvider;
  issuers: string[];
  audiences: string[];
  keys: JWTVerifyGetKey;
}

const PROVIDERS = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
  },
} as const;

/** Production verifier: provider keys are fetched and cached by `jose`. */
export function createOidcVerifier(provider: OidcProvider, audiences: string[]): OidcVerifier {
  const settings = PROVIDERS[provider];
  return createOidcVerifierWithKeys({
    provider,
    issuers: [...settings.issuers],
    audiences,
    keys: createRemoteJWKSet(new URL(settings.jwksUrl), { cooldownDuration: 30_000 }),
  });
}

/** Injectable variant (tests use locally generated keys). */
export function createOidcVerifierWithKeys(settings: ProviderSettings): OidcVerifier {
  return {
    async verify(idToken) {
      if (idToken.length > 8192) throw invalid();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, settings.keys, {
          issuer: settings.issuers,
          audience: settings.audiences,
          algorithms: ['RS256', 'ES256'],
          clockTolerance: 10,
          requiredClaims: ['sub', 'exp', 'iat'],
        }));
      } catch (err) {
        throw invalid(err);
      }
      const email = typeof payload.email === 'string' ? payload.email : null;
      // Google sends a boolean; Apple has historically sent the string "true".
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
      return {
        provider: settings.provider,
        subject: payload.sub!,
        email,
        emailVerified,
        name: typeof payload.name === 'string' ? payload.name : null,
        pictureUrl:
          typeof payload.picture === 'string' && payload.picture.startsWith('https://')
            ? payload.picture
            : null,
      };
    },
  };
}

function invalid(cause?: unknown): AppError {
  return new AppError('Sign-in token is invalid or expired', ErrorCodes.OAUTH_TOKEN_INVALID, 401, { cause });
}
