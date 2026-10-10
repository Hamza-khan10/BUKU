import type { Me } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { PictureType } from './picture';

/** Where to send the file: a signed link to storage, good for a few minutes. */
interface UploadStart {
  uploadId: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

const NOT_SENT = 'Your picture couldn’t be sent. Check your connection and try again.';

/**
 * A new profile picture, in three steps: the API hands out a signed link, the
 * file goes straight to storage (never through our server), then the API
 * checks it really is a picture, cleans it (no location or camera details
 * survive) and makes it the account's picture.
 */
export async function uploadPicture(file: File, type: PictureType): Promise<Me> {
  const { uploadId, upload } = await api<UploadStart>('auth/me/avatar/uploads', {
    method: 'POST',
    body: { contentType: type, sizeBytes: file.size },
  });
  const target = new URL(upload.url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:')
    throw new ApiError(0, 'UPLOAD_FAILED', NOT_SENT);

  let sent: Response;
  try {
    sent = await fetch(target, {
      method: 'PUT',
      // The signed headers; the browser sets Content-Length from the file itself.
      headers: { 'Content-Type': upload.headers['Content-Type'] ?? type },
      body: file,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NOT_SENT);
  }
  if (!sent.ok) throw new ApiError(sent.status, 'UPLOAD_FAILED', NOT_SENT);

  return api<Me>(`auth/me/avatar/uploads/${uploadId}/complete`, { method: 'POST' });
}

/** No picture: the uploaded one and the one from the sign-in provider. */
export const removePicture = () => api<Me>('auth/me/avatar', { method: 'DELETE' });

// ── Two-step sign-in ─────────────────────────────────────────────────────

/** A code from the app, or one of the recovery codes (for a lost phone). */
export type SecondFactor = { code: string } | { recoveryCode: string };

export const TWO_STEP_KEY = ['two-step'] as const;

/** A new app to set up: the secret (to type in) and the same as a QR code's contents. */
export const startTwoStep = () =>
  api<{ secret: string; otpauthUri: string }>('auth/mfa/setup', { method: 'POST' });

/** The app works: two-step is on, and these recovery codes are shown once. */
export const confirmTwoStep = (code: string) =>
  api<{ enabled: true; recoveryCodes: string[] }>('auth/mfa/confirm', { method: 'POST', body: { code } });

export const newRecoveryCodes = (proof: SecondFactor) =>
  api<{ recoveryCodes: string[] }>('auth/mfa/recovery-codes', { method: 'POST', body: proof });

export const turnOffTwoStep = (proof: SecondFactor) =>
  api<undefined>('auth/mfa', { method: 'DELETE', body: proof });

// ── Where the account is signed in ────────────────────────────────────────

export interface SignedInDevice {
  /** The session (all its renewals share it). */
  id: string;
  device: { name?: string; platform?: 'ios' | 'android' | 'web' } | null;
  /** Shortened, e.g. "203.0.x.x". */
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

export const SESSIONS_KEY = ['sessions'] as const;

export const fetchSessions = () => api<SignedInDevice[]>('auth/sessions');

/** Sign another device out (this browser signs out the usual way). */
export const endSession = (id: string) => api<undefined>(`auth/sessions/${id}`, { method: 'DELETE' });

// ── Your data ─────────────────────────────────────────────────────────────

/** Everything BUKU keeps about the account, as one document (a few times an hour at most). */
export const fetchMyData = () => api<unknown>('auth/me/export');

/**
 * Delete the account: signed out everywhere at once, restorable until
 * `purgeAfter`. Needs a recent sign-in (REAUTH_REQUIRED otherwise).
 */
export const deleteAccount = (reason: string | undefined) =>
  api<{ status: 'scheduled'; purgeAfter: string }>('auth/me', {
    method: 'DELETE',
    body: { confirmation: 'DELETE', ...(reason && { reason }) },
  });
