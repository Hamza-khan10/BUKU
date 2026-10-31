'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { post } from '@admin/lib/client';
import { Button } from './ui';

/** Sign out; `compact` is the sidebar's icon button (its name stays "Sign out" for everyone). */
export function SignOut({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const leave = () => {
    setBusy(true);
    void post('/api/session/signout').then(() => window.location.assign('/signin'));
  };
  if (compact)
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label="Sign out"
        title="Sign out"
        disabled={busy}
        onClick={leave}
        className="size-8 px-0 text-ink-2 ring-1 ring-line ring-inset hover:ring-line-strong"
      >
        <LogOut aria-hidden strokeWidth={2} className="size-4" />
      </Button>
    );
  return (
    <Button variant="secondary" size="sm" busy={busy} onClick={leave}>
      Sign out
    </Button>
  );
}
