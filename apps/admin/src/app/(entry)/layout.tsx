import type { ReactNode } from 'react';
import { Mark } from '@admin/components/mark';

/** Signing in and setting up two-step sign-in: the brand, the form, nothing else. */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="flex items-center gap-1.5 font-semibold tracking-tight">
            <Mark className="size-7" /> BUKU
          </span>
          <span className="rounded bg-brand px-2 py-0.5 text-xs font-semibold text-brand-ink">Admin</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
