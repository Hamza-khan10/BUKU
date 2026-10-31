import type { ReactNode } from 'react';
import { Mark } from '@admin/components/mark';

/** Signing in and setting up two-step sign-in: the brand, the form, nothing else. */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <Mark className="size-8 drop-shadow-[0_4px_12px_rgb(6_127_93/0.35)]" />
          <span className="flex flex-col leading-none">
            <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">BUKU</span>
            <span className="mt-1 text-[0.7rem] font-medium text-ink-3">Admin console</span>
          </span>
        </span>
        <span className="rounded-lg bg-sunken px-2.5 py-1 text-xs font-medium text-ink-2 ring-1 ring-line ring-inset">
          Operators only
        </span>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-center px-5 pt-4 pb-16 sm:px-8">
        {children}
      </main>
    </div>
  );
}
