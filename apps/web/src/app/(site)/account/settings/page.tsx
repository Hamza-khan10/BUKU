import type { Metadata } from 'next';
import { AccountSettings } from '@/features/settings/components/account-settings';

export const metadata: Metadata = { title: 'Settings', robots: { index: false, follow: false } };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">Settings</h1>
      <AccountSettings />
    </div>
  );
}
