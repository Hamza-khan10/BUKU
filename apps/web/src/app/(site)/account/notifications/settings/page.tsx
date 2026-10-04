import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NotificationSettings } from '@/features/notifications/components/notification-settings';

export const metadata: Metadata = { title: 'Notification settings', robots: { index: false, follow: false } };

export default function NotificationSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/account/notifications"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Notifications
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight">Notification settings</h1>
      </div>
      <NotificationSettings />
    </div>
  );
}
