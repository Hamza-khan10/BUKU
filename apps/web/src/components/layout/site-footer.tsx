import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';
import { footerNav } from './nav';

/** The public site's footer: every public and legal page, reachable from anywhere. */
export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-line">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-10 py-16 lg:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-3 lg:col-span-1">
          <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.015em]">
            <LogoMark className="size-7" /> BUKU
          </span>
          <p className="max-w-xs text-sm text-ink-2">
            Book appointments. Join queues. Know when it’s your turn.
          </p>
        </div>
        {footerNav.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-semibold text-ink">{group.title}</h2>
            <ul className="mt-3 flex flex-col gap-1">
              {group.links.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-9 items-center text-sm text-ink-2 transition-colors hover:text-ink"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-t border-line py-6 text-sm text-ink-3">
        © {new Date().getFullYear()} BUKU
      </Container>
    </footer>
  );
}
