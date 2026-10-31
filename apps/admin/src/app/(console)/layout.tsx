import type { ReactNode } from 'react';
import { Mark } from '@admin/components/mark';
import { Nav } from '@admin/components/nav';
import { SignOut } from '@admin/components/sign-out';
import { adminGate } from '@admin/lib/admin';

/** Where this console is acting: an operator must never mistake production for a test. */
function environment(): { label: string; live: boolean } {
  if (process.env.VERCEL_ENV === 'production') return { label: 'Production', live: true };
  if (process.env.VERCEL_ENV === 'preview') return { label: 'Preview', live: false };
  return { label: 'Development', live: false };
}

/**
 * The operator console (3.6b): the sections on the side, who is signed in and where on top. Each
 * page checks the admin itself (and redirects anyone else); this only draws the frame.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const gate = await adminGate();
  const env = environment();
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-4 border-b border-line bg-surface px-3 py-3 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex items-center gap-2 px-2">
          <Mark className="size-7" />
          <span className="font-semibold tracking-tight">BUKU</span>
          <span className="rounded bg-brand px-1.5 py-0.5 text-[0.7rem] font-semibold text-brand-ink">
            Admin
          </span>
        </div>
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur sm:px-6">
          <span
            className={`rounded px-2 py-1 text-xs font-semibold tracking-wide uppercase ${
              env.live ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'
            }`}
          >
            {env.label}
          </span>
          {gate.kind === 'ok' && (
            <div className="flex items-center gap-3">
              <p className="text-right text-sm leading-tight">
                <span className="block font-medium text-ink">{gate.me.name}</span>
                {gate.me.email && <span className="block text-ink-3">{gate.me.email}</span>}
              </p>
              <SignOut />
            </div>
          )}
        </header>
        <main id="main" className="w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
