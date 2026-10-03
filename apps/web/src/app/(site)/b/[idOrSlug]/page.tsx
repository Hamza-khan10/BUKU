import type { Metadata, Route } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { loadBusinessPage } from '@/features/business/api';
import { businessJsonLd } from '@/features/business/json-ld';
import { ProfileHeader } from '@/features/business/components/profile-header';
import { QueueCard } from '@/features/business/components/queue-card';
import { ReviewsSection } from '@/features/business/components/reviews';
import { BookingTerms, ServicesMenu } from '@/features/business/components/services-menu';
import { HoursCard, SideCard, VisitCard } from '@/features/business/components/side-cards';
import { TeamList } from '@/features/business/components/team-list';
import { env } from '@/lib/env';

type Props = PageProps<'/b/[idOrSlug]'>;

function Unavailable({ what, reference }: { what: string; reference: string | undefined }) {
  return (
    <ErrorState
      className="rounded-lg border border-line py-8"
      title={`We couldn’t load the ${what}`}
      message="Please refresh the page in a moment."
      reference={reference}
    />
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex scroll-mt-24 flex-col gap-4">
      <h2 id={id} className="font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadBusinessPage((await params).idOrSlug);
  if (!page) return { title: 'Business not found' };
  const b = page.business;
  const description =
    b.description ??
    `${b.name} — ${b.category.name.toLowerCase()} in ${b.address.city}. See services, prices and opening hours on BUKU.`;
  return {
    title: `${b.name} — ${b.category.name} in ${b.address.city}`,
    description: description.slice(0, 300),
    alternates: { canonical: `/b/${b.slug}` },
    openGraph: {
      title: b.name,
      description: description.slice(0, 300),
      type: 'website',
      url: `/b/${b.slug}`,
    },
  };
}

export default async function BusinessPage({ params, searchParams }: Props) {
  const { idOrSlug } = await params;
  const page = await loadBusinessPage(idOrSlug);
  if (!page) notFound();
  const { business, menu, staff, reviews, queue } = page;

  // Links by id (from notifications) settle on the business's own address, keeping their query.
  if (idOrSlug !== business.slug) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') query.set(k, v);
    const qs = query.toString();
    permanentRedirect(`/b/${business.slug}${qs ? `?${qs}` : ''}` as Route);
  }

  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const url = `${env().APP_URL}/b/${business.slug}`;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        // Escaped by businessJsonLd: no "<" can end this block.
        dangerouslySetInnerHTML={{ __html: businessJsonLd(business, url) }}
      />
      <ProfileHeader business={business} />

      <Container className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* First in reading order on phones (what's happening now), the side column on wide screens. */}
        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
          {queue.ok ? (
            <QueueCard slug={business.slug} initial={queue.data} />
          ) : (
            <SideCard title="Walk-in queue">
              <p className="text-sm text-ink-2">We couldn’t load the queue. Please refresh in a moment.</p>
            </SideCard>
          )}
          <HoursCard business={business} />
          <VisitCard business={business} />
        </aside>

        <div className="flex min-w-0 flex-col gap-12 lg:col-start-1 lg:row-start-1">
          {(business.description || menu.ok) && (
            <Block id="about" title="About">
              {business.description && (
                <p className="max-w-[70ch] whitespace-pre-line text-ink-2">{business.description}</p>
              )}
              {menu.ok && <BookingTerms booking={menu.data.booking} />}
            </Block>
          )}

          <Block id="services" title="Services and prices">
            {menu.ok ? (
              <ServicesMenu menu={menu.data} />
            ) : (
              <Unavailable what="services" reference={menu.reference} />
            )}
          </Block>

          {staff.ok ? (
            staff.data.length > 0 && (
              <Block id="team" title="Team">
                <TeamList staff={staff.data} />
              </Block>
            )
          ) : (
            <Block id="team" title="Team">
              <Unavailable what="team" reference={staff.reference} />
            </Block>
          )}

          <Block id="reviews" title="Reviews">
            {reviews.ok ? (
              <ReviewsSection
                slug={business.slug}
                businessName={business.name}
                reviews={reviews.data.data}
                meta={reviews.data.meta!}
              />
            ) : (
              <Unavailable what="reviews" reference={reviews.reference} />
            )}
          </Block>
        </div>
      </Container>
    </>
  );
}
