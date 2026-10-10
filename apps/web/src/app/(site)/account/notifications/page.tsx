import { Settings } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Inbox } from '@/features/notifications/components/inbox';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false, follow: false } };

export default function NotificationsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">Notifications</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/account/notifications/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </Button>
      </div>
      <Inbox />
    </div>
  );
}
