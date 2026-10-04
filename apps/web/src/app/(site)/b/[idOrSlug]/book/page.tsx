import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { Alert } from '@/components/ui/alert';
import { Container } from '@/components/ui/layout';
import { BookingFlow } from '@/features/booking/components/booking-flow';
import { todayIn } from '@/features/booking/choices';
import { loadBookingPage } from '@/features/business/api';
import { signedInHere } from '@/lib/session/server';

type Props = PageProps<'/b/[idOrSlug]/book'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadBookingPage((await params).idOrSlug);
  if (!page) return { title: 'Business not found' };
  return {
    title: `Book at ${page.business.name}`,
    description: `Choose a service and a free time at ${page.business.name}, ${page.business.address.city}.`,
    // A step in a flow, not a page to find in search results.
    robots: { index: false, follow: true },
  };
}

/**
 * Booking at one business. Anyone can look for a time; signing in is asked
 * for only at the last step, and comes back to the same choice.
 */
export default async function BookPage({ params, searchParams }: Props) {
  const { idOrSlug } = await params;
  const page = await loadBookingPage(idOrSlug);
  if (!page) notFound();
  const { business, menu, staff } = page;

  // A link by id settles on the business's own address, keeping the choices.
  if (idOrSlug !== business.slug) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') query.set(k, v);
    const qs = query.toString();
    permanentRedirect(`/b/${business.slug}/book${qs ? `?${qs}` : ''}` as Route);
  }

  return (
    <Container className="flex flex-col gap-8 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <Link
          href={`/b/${business.slug}` as Route}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> {business.name}
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight text-balance">
          Book at {business.name}
        </h1>
        <p className="text-ink-2">
          {business.address.line}, {business.address.city}
        </p>
      </header>

      {menu.ok ? (
        <Suspense>
          <BookingFlow
            business={{
              id: business.id,
              slug: business.slug,
              name: business.name,
              city: business.address.city,
              timezone: business.timezone,
            }}
            menu={menu.data}
            staff={staff.ok ? staff.data : []}
            today={todayIn(business.timezone)}
            signedIn={await signedInHere()}
          />
        </Suspense>
      ) : (
        <Alert tone="danger" title="We couldn’t load this business’s services.">
          Please refresh in a moment.
          {menu.reference && <p className="font-mono text-xs">Reference: {menu.reference}</p>}
        </Alert>
      )}
    </Container>
  );
}
