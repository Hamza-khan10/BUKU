import { LogoMark } from '@/components/brand/logo';
import { Container } from '@/components/ui/layout';

/** The public site's footer. Links to every public and legal page join it in step 3.2. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <Container className="flex flex-col items-start gap-3 py-10 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <LogoMark className="size-6" />
          <span>© {new Date().getFullYear()} BUKU</span>
        </span>
        <span>Book appointments. Join queues. Know when it’s your turn.</span>
      </Container>
    </footer>
  );
}
