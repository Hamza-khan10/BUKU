import type { Metadata } from 'next';
import { AccountSettings } from '@/features/settings/components/account-settings';

export const metadata: Metadata = { title: 'Settings', robots: { index: false, follow: false } };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="type-app-title">Settings</h1>
      <AccountSettings />
    </div>
  );
}
