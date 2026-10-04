import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/brand/logo';
import { Alert } from '@/components/ui/alert';
import { Container } from '@/components/ui/layout';
import { DevSignInForm } from '@/features/auth/components/dev-sign-in-form';
import { devSignInEnabled } from '@/lib/flags';
import { safeNext } from '@/lib/session/next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to book appointments, join queues and see your visits.',
  robots: { index: false, follow: false },
};

const SESSION_HINTS = ['__Host-buku_s', 'buku_s'];

/**
 * Signing in. Someone already signed in goes straight on to where they were
 * heading. The ways in are only the ones this site really offers: development
 * sign-in on development and test sites; Google joins when it is set up.
 */
export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const next = safeNext((await searchParams).next);
  const jar = await cookies();
  if (SESSION_HINTS.some((name) => jar.has(name))) redirect(next as Route);
  const dev = devSignInEnabled();

  return (
    <Container className="flex justify-center py-12 sm:py-20">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="size-12" />
          <h1 className="font-display text-4xl font-bold tracking-tight">Sign in to BUKU</h1>
          <p className="text-ink-2">Book appointments, join queues and keep every visit in one place.</p>
        </header>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8">
          {dev ? (
            <DevSignInForm next={next} />
          ) : (
            <Alert title="Signing in isn’t open on this site yet">
              You can browse every business, its prices and opening hours without an account. Signing in with
              Google is being set up.
            </Alert>
          )}
        </div>

        <p className="text-center text-sm text-ink-3">
          By signing in you agree to the{' '}
          <Link
            href={'/legal/terms' as Route}
            className="font-medium text-brand-ink underline underline-offset-4"
          >
            terms of use
          </Link>{' '}
          and the{' '}
          <Link
            href={'/legal/privacy' as Route}
            className="font-medium text-brand-ink underline underline-offset-4"
          >
            privacy notice
          </Link>
          .
        </p>
      </div>
    </Container>
  );
}
