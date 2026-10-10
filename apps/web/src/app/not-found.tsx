import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Page not found' };

/** A link that leads nowhere: say so kindly and offer the way back. */
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <Link href="/" aria-label="BUKU home">
          <Logo />
        </Link>
        <p className="font-mono text-sm font-semibold tracking-widest text-brand-ink">404</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">This page isn’t here</h1>
        <p className="text-ink-2">
          The link may be old, or the page may have moved. If you followed a link to a business, it may no
          longer be listed.
        </p>
        <Button asChild variant="primary">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </main>
  );
}
