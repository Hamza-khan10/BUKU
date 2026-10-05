import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TwoStepSetup } from '@/features/settings/components/two-step-setup';

export const metadata: Metadata = {
  title: 'Turn on two-step sign-in',
  robots: { index: false, follow: false },
};

export default function TwoStepPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/account/settings"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Settings
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight">Turn on two-step sign-in</h1>
      </div>
      <TwoStepSetup />
    </div>
  );
}
