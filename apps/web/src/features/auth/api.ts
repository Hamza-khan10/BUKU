import { api, signOut } from '@/lib/api/client';

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
export type TwoStepNeeded = { mfaRequired: true; mfaToken: string; expiresAt: string };

export const ME_KEY = ['me'] as const;

export const fetchMe = () => api<Me>('auth/me');

/** "Chrome on Windows" — so the person recognises this device in their sessions list. */
export function deviceName(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

export function devSignIn(input: { email: string; name?: string | undefined; role: DevRole }) {
  const name = deviceName();
  return api<SignedIn | TwoStepNeeded>('auth/dev/login', {
    method: 'POST',
    body: {
      email: input.email,
      ...(input.name && { name: input.name }),
      role: input.role,
      device: { platform: 'web', ...(name && { name }) },
    },
  });
}

/** Sign out of every device: the API ends all sessions; the web server clears this browser's cookies. */
export async function signOutEverywhere(): Promise<void> {
  await api('auth/logout-all', { method: 'POST' });
}

export { signOut };
