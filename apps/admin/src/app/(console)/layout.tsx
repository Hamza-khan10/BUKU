import type { ReactNode } from 'react';
import { Mark } from '@admin/components/mark';
import { Nav } from '@admin/components/nav';
import { SignOut } from '@admin/components/sign-out';
import { StatusDot, cx } from '@admin/components/ui';
import { adminGate } from '@admin/lib/admin';

/** Where this console is acting: an operator must never mistake production for a test. */
function environment(): { label: string; live: boolean } {
  if (process.env.VERCEL_ENV === 'production') return { label: 'Production', live: true };
  if (process.env.VERCEL_ENV === 'preview') return { label: 'Preview', live: false };
  return { label: 'Development', live: false };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * The operator console (3.6b, redrawn in D-131): a glass sidebar with the sections, where it is
 * acting and who is signed in; on phones, a bar on top. Production is marked twice: a crimson band
 * across the top and in the sidebar. Each page checks the admin itself; this only draws the frame.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const gate = await adminGate();
  const env = environment();
  const me = gate.kind === 'ok' ? gate.me : null;
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {env.live && (
        <div
          aria-hidden
          className="fixed inset-x-0 top-0 z-40 h-[3px] bg-danger shadow-[0_0_16px_var(--danger)]"
        />
      )}
      <aside className="material sticky top-0 z-30 flex flex-col gap-3 border-b border-line px-4 pt-3 pb-2 lg:h-dvh lg:w-[15.5rem] lg:shrink-0 lg:gap-6 lg:border-r lg:border-b-0 lg:px-3 lg:py-6">
        <div className="flex items-center justify-between gap-3 lg:px-2">
          <div className="flex items-center gap-2.5">
            <Mark className="size-8 drop-shadow-[0_4px_12px_rgb(6_127_93/0.35)]" />
            <span className="flex flex-col leading-none">
              <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">BUKU</span>
              <span className="mt-1 text-[0.7rem] font-medium text-ink-3">Admin console</span>
            </span>
          </div>
          <EnvBadge env={env} className="lg:hidden" />
        </div>
        {/* The sections scroll on their own when the window is short, so where it's acting and who
            is signed in (and signing out) always stay on screen. */}
        <div className="lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1">
          <Nav />
        </div>
        <div className="hidden shrink-0 flex-col gap-3 lg:flex">
          <EnvBadge env={env} />
          {me && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2.5">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-sm font-semibold text-brand-text"
              >
                {initials(me.name) || '·'}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-ink">{me.name}</span>
                {me.email && <span className="truncate text-xs text-ink-3">{me.email}</span>}
              </span>
              <SignOut compact />
            </div>
          )}
        </div>
        {me && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2 lg:hidden">
            <span className="truncate text-sm text-ink-2">{me.name}</span>
            <SignOut />
          </div>
        )}
      </aside>
      <main id="main" className="w-full max-w-[76rem] min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}

function EnvBadge({ env, className }: { env: { label: string; live: boolean }; className?: string }) {
  return (
    <p
      className={cx(
        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
        env.live ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink-2 ring-1 ring-line ring-inset',
        className,
      )}
    >
      <StatusDot tone={env.live ? 'danger' : 'neutral'} live={env.live} />
      {env.label}
      {env.live && <span className="sr-only">: changes here affect real people</span>}
    </p>
  );
}
