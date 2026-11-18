import { ArrowRight, Check } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { faqStructuredData } from '@/features/marketing/faq';
import { jsonLd } from '@/lib/seo';
import { categoryQuestions, inSentence, visitsOf, withArticle, type Placed } from '../guide';
import { GROUP_GUIDES, KIND_GUIDES } from '../guide-content';
import { CategoryIcon } from '../icons';

/**
 * The guide on a category's page (D-139): what people come for, how BUKU works there, what it means
 * for that kind of business, questions with answers (FAQPage data), and the categories around it.
 * Before launch it is the page; after, it follows the list of places. Built in the site's own parts:
 * the mint invitation band, numbered steps, a 20px panel, the questions list, pill chips.
 */
export function CategoryGuide({
  placed,
  siblings,
  early,
  nonce,
}: {
  placed: Placed;
  /** The other kinds in the group (for a kind) or the other groups (for a group). */
  siblings: { slug: string; name: string }[];
  early: boolean;
  nonce: string | undefined;
}) {
  const { node, parent } = placed;
  const kind = parent ? KIND_GUIDES[node.slug] : undefined;
  const lower = inSentence(node.name);
  const visits = parent ? visitsOf(node.slug) : 'both';
  const questions = categoryQuestions(placed, early);
  const steps =
    visits === 'book'
      ? [
          'Find the place and what you need.',
          'Choose a time that’s really free, and confirm.',
          'Get a reminder, and arrive on time.',
        ]
      : visits === 'queue'
        ? [
            'Find the place on BUKU.',
            'Join its queue from your phone, wherever you are.',
            'Watch your place move, and arrive when it’s your turn.',
          ]
        : [
            'Find the place and what you need.',
            'Book a time ahead, or join the walk-in queue from your phone.',
            'Get a reminder, or a nudge when your turn is near.',
          ];

  return (
    <div className="flex flex-col gap-16 sm:gap-24">
      <section
        aria-labelledby="come-for"
        className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16"
      >
        <h2 id="come-for" className="type-section">
          {parent ? 'What people come for.' : `What’s in ${node.name}.`}
        </h2>
        <div className="flex flex-col gap-5">
          <p className="type-lead">
            {kind?.intro ?? GROUP_GUIDES[node.slug]?.intro ?? `${node.name} on BUKU.`}
          </p>
          {kind ? (
            <ul aria-label={`What people book at ${withArticle(lower)}`} className="flex flex-wrap gap-2">
              {kind.book.map((b) => (
                <li
                  key={b}
                  className="rounded-full bg-sunken px-3.5 py-1.5 text-sm font-medium text-ink ring-1 ring-line ring-inset"
                >
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <ul
              aria-label={`Kinds of place in ${node.name}`}
              className="grid gap-x-2 gap-y-0.5 min-[22.5rem]:grid-cols-2"
            >
              {node.children.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/c/${c.slug}` as Route}
                    className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-2 text-[0.95rem] font-medium text-ink transition-colors hover:bg-sunken"
                  >
                    <CategoryIcon slug={c.slug} className="size-[1.125rem] shrink-0 text-brand-ink" />
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {early && (
        <div className="flex flex-col gap-4 rounded-xl bg-brand-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="max-w-xl text-ink">
            <span className="font-semibold">BUKU opens soon.</span> Join the early-access list and we’ll tell
            you the day you can{' '}
            {parent
              ? visits === 'queue'
                ? `join the queue at ${withArticle(lower)}`
                : `book ${withArticle(lower)}`
              : 'book these'}{' '}
            near you.
          </p>
          <Button asChild variant="primary" className="shrink-0">
            <Link href={`/early-access?as=customer&source=c-${node.slug}` as Route}>Get early access</Link>
          </Button>
        </div>
      )}

      <section aria-labelledby="how" className="flex flex-col gap-8">
        <h2 id="how" className="type-section">
          How it works.
        </h2>
        {/* A real sequence, so it's numbered (as on For businesses). */}
        <ol className="grid gap-6 md:grid-cols-3 md:gap-8">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-4 md:flex-col md:gap-4">
              <span className="tabular grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand-ink">
                {i + 1}
              </span>
              <span className="pt-2 text-lg leading-relaxed text-ink md:pt-0">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="for-business"
        className="grid gap-8 rounded-xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12"
      >
        <div className="flex flex-col gap-4">
          <h2 id="for-business" className="type-section">
            {parent ? `Run ${withArticle(lower)}?` : `Run a business in ${node.name}?`}
          </h2>
          <p className="text-lg leading-relaxed text-ink-2">
            {visits === 'queue'
              ? 'Let people wait for their turn from wherever they are, and see the day’s line at a glance.'
              : visits === 'book'
                ? 'Take bookings around your real availability, and stop chasing no-shows by phone.'
                : 'Take bookings and run your walk-in line in one place, so the day stays calm.'}{' '}
            Starter is free.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2">
            <Button asChild variant="primary">
              <Link href={early ? `/early-access?as=business&source=c-${node.slug}` : '/business/new'}>
                {early ? 'Join early as a business' : 'Add your business'}
              </Link>
            </Button>
            <Link href="/pricing" className="font-medium text-brand-ink underline-offset-4 hover:underline">
              See plans and prices
            </Link>
          </div>
        </div>
        <ul className="flex flex-col gap-3 self-center">
          {[
            visits === 'queue'
              ? 'A walk-in queue people join from their phone, with a live display'
              : 'Bookings from your real hours, team and services',
            visits === 'book'
              ? 'Reminders sent for you, before every visit'
              : 'Call the next ticket, add walk-ins, pause or close the line',
            'Check-in by code or QR, and the day’s list stays right',
            'Your own page, with reviews only from real visits',
          ].map((line) => (
            <li key={line} className="flex gap-3 text-ink">
              <Check aria-hidden className="mt-1 size-[1.1rem] shrink-0 text-brand-ink" strokeWidth={2.5} />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="questions"
        className="reveal-rise grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20"
      >
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLd(faqStructuredData(questions)) }}
        />
        <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
          <h2 id="questions" className="type-section">
            Questions people ask.
          </h2>
          <p className="text-ink-2">
            Something else?{' '}
            <Link href="/help" className="font-medium text-brand-ink underline underline-offset-4">
              See all answers
            </Link>
            .
          </p>
        </div>
        <Accordion type="single" collapsible defaultValue={`q-${questions[0]!.id}`}>
          {questions.map((item) => (
            <AccordionItem key={item.id} value={`q-${item.id}`} question={item.q}>
              <p>{item.a}</p>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {siblings.length > 0 && (
        <nav aria-labelledby="around" className="flex flex-col gap-5">
          <h2 id="around" className="type-heading">
            {parent ? `More in ${parent.name}` : 'Other kinds of place'}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/c/${s.slug}` as Route}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
                >
                  <CategoryIcon slug={s.slug} className="size-4" />
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={(parent ? `/c/${parent.slug}` : '/categories') as Route}
            className="inline-flex items-center gap-1.5 self-start font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            {parent ? `All of ${parent.name}` : 'Every category'}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </nav>
      )}
    </div>
  );
}
