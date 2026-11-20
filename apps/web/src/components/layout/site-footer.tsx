import Link from 'next/link';
import { HeldDot } from '@/components/brand/held-dot';
import { Logo } from '@/components/brand/logo';
import { Magnetic } from '@/components/motion/magnetic';
import { Container } from '@/components/ui/layout';
import { SocialIcons } from '@/features/marketing/components/social-links';
import { prelaunch } from '@/lib/flags';
import { footerNav, visibleLinks } from './nav';

/**
 * The public site's footer: every public and legal page, reachable from anywhere. Midnight,
 * like the board and the story, so every page ends on the same note (D-095): the promise in
 * one line, then the links (two columns on phones, short to scan), then BUKU's profiles.
 */
export function SiteFooter() {
  const early = prelaunch();
  return (
    <footer data-tone="dark" className="scope-dark mt-24 bg-board text-board-ink sm:mt-32">
      <Container className="flex flex-col gap-12 pt-14 pb-10 sm:pt-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5">
            {/* Pinned left with the words (an image in a column otherwise stretches and centres). */}
            <Logo title="BUKU" className="h-9 self-start" />
            <p className="type-section">
              <span className="block">No one should wait</span>{' '}
              <span className="block text-board-ink-2">
                to be seen
                <HeldDot still />
              </span>
            </p>
          </div>
          <Magnetic className="w-fit">
            <Link
              href={early ? '/early-access?source=footer' : '/explore'}
              className="inline-flex h-12 w-fit items-center rounded-full bg-board-go-fill px-6 font-semibold text-board-on-go transition-transform duration-150 ease-(--ease-out) active:scale-[0.97]"
            >
              {early ? 'Get early access' : 'Find a place'}
            </Link>
          </Magnetic>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 border-t border-white/10 pt-10 sm:grid-cols-4">
          {footerNav.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-sm font-semibold text-board-ink">{group.title}</h2>
              <ul className="mt-3 flex flex-col">
                {visibleLinks(group.links, early).map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="inline-flex min-h-10 items-center text-[0.95rem] text-board-ink-2 transition-colors hover:text-board-ink"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* The last line: who, and where else to find BUKU (its profiles, as marks). */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <p className="text-sm text-board-ink-2">© {new Date().getFullYear()} BUKU</p>
          <SocialIcons />
        </div>
      </Container>
    </footer>
  );
}
