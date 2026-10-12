import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';
import { footerNav } from './nav';

/**
 * The public site's footer: every public and legal page, reachable from anywhere. Midnight,
 * like the board and the story, so every page ends on the same note (D-095): the promise in
 * one line, then the links (two columns on phones, short to scan).
 */
export function SiteFooter() {
  return (
    <footer data-tone="dark" className="scope-dark mt-24 bg-board text-board-ink sm:mt-32">
      <Container className="flex flex-col gap-12 pt-14 pb-10 sm:pt-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5">
            <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.015em]">
              <LogoMark className="size-8" /> BUKU
            </span>
            <p className="type-section max-w-xl">
              Book the time. <span className="text-board-ink-2">Skip the wait.</span>
            </p>
          </div>
          <Link
            href="/explore"
            className="inline-flex h-12 w-fit items-center rounded-full bg-board-go-fill px-6 font-semibold text-board-on-go transition-transform duration-150 ease-(--ease-out) active:scale-[0.97]"
          >
            Find a place
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 border-t border-white/10 pt-10 sm:grid-cols-3">
          {footerNav.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-sm font-semibold text-board-ink">{group.title}</h2>
              <ul className="mt-3 flex flex-col">
                {group.links.map(({ href, label }) => (
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

        <p className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-sm text-board-ink-2">
          <span>© {new Date().getFullYear()} BUKU</span>
          <span>Appointments and queues, without the wait.</span>
        </p>
      </Container>
    </footer>
  );
}
