import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { Theme } from '@/lib/theme';

/** The public site's header. Navigation grows with the public pages (step 3.2). */
export function SiteHeader({ theme }: { theme: Theme }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="BUKU home" className="rounded-md">
          <Logo />
        </Link>
        <ThemeToggle initial={theme} />
      </Container>
    </header>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lift"
    >
      Skip to content
    </a>
  );
}
