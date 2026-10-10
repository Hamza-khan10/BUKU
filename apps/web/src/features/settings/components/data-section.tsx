'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import type { Me } from '@/features/auth/api';
import { problemFrom } from '@/features/auth/problems';
import { fetchMyData } from '../api';
import { DELETION_GRACE_DAYS, exportFileName } from '../my-data';
import { SettingsSection } from './section';

/** Save everything BUKU keeps about the account as a file. */
export function DownloadMyData({ variant = 'secondary' }: { variant?: 'secondary' | 'primary' }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const data = await fetchMyData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName(new Date());
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Your data is downloaded.');
    } catch (err) {
      toast.error(problemFrom(err, 'The download didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} loading={busy} onClick={() => void download()} className="w-fit">
      {!busy && <Download aria-hidden />} Download your data
    </Button>
  );
}

/**
 * The account's data: a copy to take away, and deleting the account (which
 * an employee account can't do itself — the business that made it closes it).
 */
export function DataSection({ me }: { me: Me }) {
  return (
    <SettingsSection title="Your data">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          A copy of everything BUKU keeps about you, as a file you can open: your account, visits, reviews,
          places in queues, messages, and your sign-in history.
        </p>
        <DownloadMyData />
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {me.account.type === 'employee' ? (
          <p className="text-sm text-ink-2">
            This account was made by your business: it’s closed by them, for example when you leave the team.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Deleting your account signs you out everywhere and cancels visits still to come. You can change
              your mind for {DELETION_GRACE_DAYS} days.
            </p>
            <Button asChild variant="ghost" className="w-fit text-danger">
              <Link href="/account/settings/delete">Delete your account…</Link>
            </Button>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
