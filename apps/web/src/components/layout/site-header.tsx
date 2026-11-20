import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { AccountControl } from '@/features/auth/components/account-control';
import { prelaunch } from '@/lib/flags';
import type { Theme } from '@/lib/theme';
import { HeaderShell } from './header-shell';
import { DesktopNav, MobileNav } from './site-nav';

/**
 * The public site's header: logo, main links (a menu on phones), theme, and signing in or the
 * account menu; before launch, the way onto the early-access list instead (D-134).
 */
export function SiteHeader({ theme, signedIn }: { theme: Theme; signedIn: boolean }) {
  return (
    <HeaderShell className="site-glass">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          {/* The full logo from 360 px; on the narrowest phones the symbol alone (the kit: below
              the lockup's 120 px minimum, use the symbol), so the header always fits. */}
          <Link href="/" aria-label="BUKU home" className="rounded-md">
            <Logo className="hidden min-[360px]:block" />
            <LogoMark className="size-9 min-[360px]:hidden" />
          </Link>
          <DesktopNav early={prelaunch()} />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle initial={theme} className="hidden lg:inline-flex" />
          {prelaunch() ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/early-access?source=header">Get early access</Link>
            </Button>
          ) : (
            <AccountControl signedIn={signedIn} />
          )}
          <MobileNav theme={theme} early={prelaunch()} />
        </div>
      </Container>
    </HeaderShell>
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
