import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { AccountControl } from '@/features/auth/components/account-control';
import type { Theme } from '@/lib/theme';
import { DesktopNav, MobileNav } from './site-nav';

/** The public site's header: logo, main links (a menu on phones), theme, and signing in or the account menu. */
export function SiteHeader({ theme, signedIn }: { theme: Theme; signedIn: boolean }) {
  return (
    <header className="material-bar sticky top-0 z-30 border-b border-line/60">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="BUKU home" className="rounded-md">
            <Logo />
          </Link>
          <DesktopNav />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle initial={theme} className="hidden lg:inline-flex" />
          <AccountControl signedIn={signedIn} />
          <MobileNav theme={theme} />
        </div>
      </Container>
    </header>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lift"
    >
      Skip to content
    </a>
  );
}
