import { deviceNameFrom } from '@/lib/http/device-name';
import type { SignedInDevice } from './api';

/** What people call a device: its name from sign-in, else read from its browser, else plainly unknown. */
export function deviceLabel(s: Pick<SignedInDevice, 'device' | 'userAgent'>): string {
  return s.device?.name ?? deviceNameFrom(s.userAgent) ?? 'Unknown device';
}

/** A phone (the app, or a phone's browser) — for the icon. */
export function isPhone(s: Pick<SignedInDevice, 'device' | 'userAgent'>): boolean {
  if (s.device?.platform === 'ios' || s.device?.platform === 'android') return true;
  return /Android|iPhone|iPad|Mobile/.test(s.userAgent ?? '');
}

/** This browser first, then the most recently active. */
export function sortedDevices(list: SignedInDevice[]): SignedInDevice[] {
  return [...list].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) || Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt),
  );
}
