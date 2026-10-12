import type { Me } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import type { PictureType } from './picture';

/**
 * A new profile picture: sent straight to storage by a signed link, then checked and cleaned
 * by the API (no location or camera details survive) and made the account's picture.
 */
export const uploadPicture = (file: File, type: PictureType) =>
  uploadFile<Me>('auth/me/avatar/uploads', {}, file, type);

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
