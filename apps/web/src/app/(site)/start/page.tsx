import type { Metadata } from 'next';
import { Container } from '@/components/ui/layout';
import { StartHere } from '@/features/account/components/start-here';

export const metadata: Metadata = {
  title: 'Where to',
  robots: { index: false, follow: false },
};

/**
 * Where a sign-in lands when nothing asked for a page (signed-out visitors are sent to sign in by
 * the proxy): the person's business, a choice between their businesses, or their home.
 */
export default function StartPage() {
  return (
    <Container className="flex flex-col gap-8 py-8 sm:py-14">
      <StartHere />
    </Container>
  );
}
