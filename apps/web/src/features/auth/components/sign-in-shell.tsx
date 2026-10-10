import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';

/** The frame every sign-in step shares: the mark, a heading, the step itself, and what comes after. */
export function SignInShell({
  title,
  lead,
  children,
  after,
  terms = true,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
  /** Below the card: other ways in, help. */
  after?: ReactNode;
  /** The "you agree to the terms" line (not on steps that come after agreeing). */
  terms?: boolean;
}) {
  return (
    <Container className="flex justify-center py-12 sm:py-20">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="size-12" />
          <h1 className="text-4xl font-semibold tracking-[-0.03em] text-balance">{title}</h1>
          <p className="text-ink-2">{lead}</p>
        </header>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8">{children}</div>

        {after}

        {terms && (
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
        )}
      </div>
    </Container>
  );
}

/** A quiet line under the card leading to another way in. */
export function OtherWayIn({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <p className="text-center text-sm text-ink-2">
      {children}{' '}
      <Link href={href as Route} className="font-medium text-brand-ink underline underline-offset-4">
        {label}
      </Link>
    </p>
  );
}
