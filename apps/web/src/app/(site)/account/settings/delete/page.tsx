import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DeleteAccount } from '@/features/settings/components/delete-account';

export const metadata: Metadata = { title: 'Delete your account', robots: { index: false, follow: false } };

export default function DeleteAccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/account/settings"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Settings
        </Link>
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">Delete your account</h1>
      </div>
      <DeleteAccount />
    </div>
  );
}
