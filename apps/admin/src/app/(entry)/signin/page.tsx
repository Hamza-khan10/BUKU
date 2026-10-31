import { SIGN_IN_ERRORS } from '@buku/web-security/google-oauth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DevSignIn } from '@admin/components/dev-sign-in';
import { EyeOff, KeyRound, ScrollText } from 'lucide-react';
import { Notice, beat } from '@admin/components/ui';
import { adminGate } from '@admin/lib/admin';
import { devSignInEnabled, googleSignInEnabled } from '@admin/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

/** This app's own endpoint (not a page, so a plain link: <Link> would prefetch it). */
const GOOGLE_START = '/api/auth/google/start';

/** Only known reasons are shown, never text from the address. */
const REASONS: Record<string, { tone: 'danger' | 'info'; title: string }> = {
  ...Object.fromEntries(
    Object.entries(SIGN_IN_ERRORS).map(([code, title]) => [code, { tone: 'danger' as const, title }]),
  ),
  'not-admin': {
    tone: 'danger',
    title: 'That account isn’t a BUKU platform admin. Nothing here is open to it.',
  },
  expired: { tone: 'info', title: 'That sign-in expired. Please start again.' },
};

export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const gate = await adminGate();
  if (gate.kind === 'ok') redirect('/');
  if (gate.kind === 'needs-two-step') redirect('/two-step');
  const asked = (await searchParams).error;
  const reason = typeof asked === 'string' && Object.hasOwn(REASONS, asked) ? REASONS[asked] : undefined;
  const google = googleSignInEnabled();
  const dev = devSignInEnabled();

  return (
    <div className="grid w-full items-center gap-10 lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:gap-16">
      <div className="rise flex flex-col gap-6">
        <h1 className="max-w-xl text-[2.1rem] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[2.75rem]">
          Sign in to BUKU admin
        </h1>
        <p className="max-w-lg text-[1.02rem] leading-relaxed text-ink-2">
          Where BUKU’s operators keep the platform well: businesses to verify, reports, accounts, the switches
          for a bad day, and the system’s pulse.
        </p>
        <ul className="flex flex-col gap-3 text-sm text-ink-2">
          {FACTS.map(({ icon: Icon, text }, i) => (
            <li key={text} className="rise flex items-center gap-3" style={beat(i + 1)}>
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand-text ring-1 ring-brand/15 ring-inset">
                <Icon aria-hidden strokeWidth={1.9} className="size-[1.05rem]" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-4">
        {reason && <Notice tone={reason.tone} title={reason.title} />}
        <section aria-label="Sign in" className="panel rise flex flex-col gap-5 p-6 sm:p-7" style={beat(2)}>
          {google && (
            // A plain link to this app's own endpoint: the sign-in happens on the server (D-090).
            <a
              href={GOOGLE_START}
              className="press inline-flex h-11 items-center justify-center rounded-[10px] bg-brand px-4 text-sm font-semibold text-brand-ink shadow-[0_8px_20px_-12px_var(--brand)] hover:bg-brand-hover"
            >
              Continue with Google
            </a>
          )}
          {dev && (
            <>
              <Notice title="Development sign-in">
                A new email becomes a platform admin. Never on the live site.
              </Notice>
              <DevSignIn />
            </>
          )}
          {!google && !dev && <Notice title="Admin sign-in isn’t set up on this deployment yet." />}
        </section>
        <p className="px-1 text-sm text-ink-3">
          For BUKU’s own operators only. Customers and businesses use the BUKU website.
        </p>
      </div>
    </div>
  );
}

const FACTS = [
  { icon: KeyRound, text: 'Two-step sign-in, every time' },
  { icon: ScrollText, text: 'Every look and every step is recorded' },
  { icon: EyeOff, text: 'Never public, never indexed' },
];
