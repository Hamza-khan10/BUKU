import { api, sessionCall, signOut } from '@/lib/api/client';
import { deviceNameFrom } from '@/lib/http/device-name';

/** The signed-in person, as GET /v1/auth/me describes them (only ever to themselves). */
export interface Me {
  id: string;
  name: string;
  email: string | null;
  phone: { number: string; verified: boolean } | null;
  whatsappOptIn: boolean;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  role: 'user' | 'business_owner' | 'super_admin';
  account:
    | { type: 'personal' }
    | { type: 'employee'; businessId: string; username: string | null; mustChangePassword: boolean };
  createdAt: string;
  onboarding: { phoneRequired: boolean };
}

export type DevRole = 'user' | 'business_owner' | 'super_admin';

/** A sign-in answer once the web server has turned its tokens into cookies. */
export type SignedIn = { user: Me; isNewUser: boolean; sessionId: string };
/** The account uses two-step sign-in: the code comes next (the web server keeps the challenge). */
export type TwoStepNeeded = { mfaRequired: true; expiresAt: string };
export type SignInAnswer = SignedIn | TwoStepNeeded;

export const needsTwoStep = (answer: SignInAnswer): answer is TwoStepNeeded => 'mfaRequired' in answer;

/** An employee account still on the temporary password its business gave it. */
export const mustChangePassword = (me: Me) => me.account.type === 'employee' && me.account.mustChangePassword;

export const ME_KEY = ['me'] as const;

export const fetchMe = () => api<Me>('auth/me');

/** "Chrome on Windows" — so the person recognises this device in their sessions list. */
export function deviceName(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : deviceNameFrom(navigator.userAgent);
}

const device = () => {
  const name = deviceName();
  return { platform: 'web' as const, ...(name && { name }) };
};

export function devSignIn(input: { email: string; name?: string | undefined; role: DevRole }) {
  return api<SignInAnswer>('auth/dev/login', {
    method: 'POST',
    body: {
      email: input.email,
      ...(input.name && { name: input.name }),
      role: input.role,
      device: device(),
    },
  });
}

/** Employee accounts: the business's handle, a username and a password (D-034). */
export function businessSignIn(input: { business: string; username: string; password: string }) {
  return api<SignInAnswer>('auth/business-login', {
    method: 'POST',
    body: { ...input, device: device() },
  });
}

/** The second step: a code from the authenticator app, or a recovery code. */
export function verifySignIn(input: { code: string } | { recoveryCode: string }) {
  return sessionCall<SignedIn>('verify', input);
}

/** Name, time zone and language (PATCH /v1/auth/me): only what changed. */
export function updateProfile(change: { name?: string; timezone?: string }) {
  return api<Me>('auth/me', { method: 'PATCH', body: change });
}

/** Change one's own password. Every session ends, this one included: sign in again with the new one. */
export function changePassword(input: { currentPassword: string; newPassword: string }) {
  return api<{ signInAgain: true }>('auth/password', { method: 'POST', body: input });
}

export interface TwoStepStatus {
  enabled: boolean;
  since: string | null;
  recoveryCodesLeft: number;
  required: boolean;
}

export const fetchTwoStepStatus = () => api<TwoStepStatus>('auth/mfa');

/** Sign out of every device: the API ends all sessions; the web server clears this browser's cookies. */
export async function signOutEverywhere(): Promise<void> {
  await api('auth/logout-all', { method: 'POST' });
}

export { signOut };
