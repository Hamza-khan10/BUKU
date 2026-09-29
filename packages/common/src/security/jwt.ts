import { randomUUID } from 'node:crypto';
import {
  errors as joseErrors,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWTHeaderParameters,
  type JWTPayload,
} from 'jose';
import { AppError, ErrorCodes } from '../errors.js';

/**
 * Access tokens: short-lived RS256 JWTs.
 *
 * - Only auth-service holds the PRIVATE key and signs. Every other service
 *   holds only PUBLIC keys and verifies. A compromised booking-service cannot
 *   mint tokens.
 * - The algorithm is pinned to RS256 on verify, which blocks the classic
 *   `alg: none` and RS256→HS256 key-confusion attacks.
 * - `kid` (key id) in the header selects the verification key, so keys can be
 *   rotated: publish the new public key everywhere, switch signing, retire
 *   the old key after the longest token lifetime has passed.
 * - `iss` and `aud` are always checked so tokens from another environment
 *   (staging vs production) or another system are rejected.
 */

export const ROLES = ['user', 'staff', 'business_owner', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

const ALGORITHM = 'RS256';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  role: Role;
  /** Session id (refresh-token family); lets a logout revoke related access tokens. */
  sid?: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  jti: string;
  iat: number;
  exp: number;
}

export interface JwtSettings {
  issuer: string;
  audience: string;
}

export interface JwtSigner {
  sign(claims: AccessTokenClaims): Promise<{ token: string; jti: string; expiresAt: Date }>;
}

export interface SignerOptions extends JwtSettings {
  privateKeyPem: string;
  keyId: string;
  /** Lifetime in seconds. Default 15 minutes. */
  ttlSeconds?: number;
}

export async function createJwtSigner(options: SignerOptions): Promise<JwtSigner> {
  const key = await importPKCS8(options.privateKeyPem, ALGORITHM);
  const ttl = options.ttlSeconds ?? 15 * 60;
  return {
    async sign(claims) {
      const jti = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: claims.role, ...(claims.sid ? { sid: claims.sid } : {}) })
        .setProtectedHeader({ alg: ALGORITHM, kid: options.keyId, typ: 'JWT' })
        .setSubject(claims.sub)
        .setIssuer(options.issuer)
        .setAudience(options.audience)
        .setJti(jti)
        .setIssuedAt(now)
        .setExpirationTime(now + ttl)
        .sign(key);
      return { token, jti, expiresAt: new Date((now + ttl) * 1000) };
    },
  };
}

export interface PublicKeySpec {
  keyId: string;
  publicKeyPem: string;
}

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export async function createJwtVerifier(
  options: JwtSettings & { keys: PublicKeySpec[] },
): Promise<JwtVerifier> {
  if (options.keys.length === 0) throw new Error('At least one JWT public key is required');
  const keys = new Map<string, CryptoKey>();
  for (const spec of options.keys) keys.set(spec.keyId, await importSPKI(spec.publicKeyPem, ALGORITHM));

  const resolveKey = (header: JWTHeaderParameters): CryptoKey => {
    const key = header.kid ? keys.get(header.kid) : undefined;
    if (!key) throw new AppError('Unknown token signing key', ErrorCodes.TOKEN_INVALID, 401);
    return key;
  };

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, resolveKey, {
          algorithms: [ALGORITHM],
          issuer: options.issuer,
          audience: options.audience,
          clockTolerance: 5,
          requiredClaims: ['sub', 'jti', 'exp', 'iat'],
        }));
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) {
          throw new AppError('Access token expired', ErrorCodes.TOKEN_EXPIRED, 401);
        }
        throw new AppError('Invalid access token', ErrorCodes.TOKEN_INVALID, 401, { cause: err });
      }

      const role = payload.role;
      if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
        throw new AppError('Invalid access token', ErrorCodes.TOKEN_INVALID, 401);
      }
      return {
        sub: payload.sub!,
        role: role as Role,
        jti: payload.jti!,
        iat: payload.iat!,
        exp: payload.exp!,
        ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
      };
    },
  };
}

/** Build a verifier from the standard JWT_* environment variables (see `jwtVerifyEnv`). */
export function createJwtVerifierFromEnv(env: {
  JWT_PUBLIC_KEY: string;
  JWT_KEY_ID: string;
  JWT_PREVIOUS_PUBLIC_KEY?: string | undefined;
  JWT_PREVIOUS_KEY_ID?: string | undefined;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
}): Promise<JwtVerifier> {
  const keys: PublicKeySpec[] = [{ keyId: env.JWT_KEY_ID, publicKeyPem: env.JWT_PUBLIC_KEY }];
  if (env.JWT_PREVIOUS_PUBLIC_KEY && env.JWT_PREVIOUS_KEY_ID) {
    keys.push({ keyId: env.JWT_PREVIOUS_KEY_ID, publicKeyPem: env.JWT_PREVIOUS_PUBLIC_KEY });
  }
  return createJwtVerifier({ issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, keys });
}
