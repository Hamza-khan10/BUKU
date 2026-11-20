'use client';

import { normalizeText, textProblem } from '@buku/validation';
import type { Route } from 'next';
import Link from 'next/link';
import { useId, useState } from 'react';
import { initials } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import {
  EXAMPLE_SERVICES,
  KINDS_OF_BUSINESS,
  isBusinessKind,
  type BusinessKind,
} from '@/features/early-access/kinds';

/**
 * "See your place on BUKU" (3.7i): an owner types their business's name and picks what they do,
 * and their page takes shape beside it as they type (the content is the interaction). Nothing is
 * sent anywhere: "Save my spot" opens the early-access form with the name and kind filled in,
 * where the same text rules apply again (and on the server). Before launch only; after, it leads
 * to adding the business.
 */

const NAME_MAX = 80;

/** A shop's name as an address ("Ali's Barbershop" → ali-s-barbershop), as BUKU makes them. */
const slug = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'your-business';

export function YourPlace({ early }: { early: boolean }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BusinessKind>('Barbershop');
  const headingId = useId();

  const clean = normalizeText(name, 'title');
  // Only a name the form would take reaches the preview's address and the link.
  const usable = clean.length >= 2 && clean.length <= NAME_MAX && !textProblem(clean, 'title');
  const shown = usable ? clean : 'Your business';
  const query = new URLSearchParams({ as: 'business', source: 'see-your-place', type: kind });
  if (usable) query.set('name', clean);
  const href = (early ? `/early-access?${query.toString()}` : '/business/new') as Route;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-10 rounded-[2rem] bg-sunken/70 p-6 ring-1 ring-line/60 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:items-center lg:gap-16"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 id={headingId} className="type-section">
            See your place on BUKU
          </h2>
          <p className="max-w-[42ch] text-lg leading-relaxed text-ink-2">
            Type your business’s name and pick what you do. This is how your page could look to the people who
            book.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Field label="Business name" optionalLabel={false}>
            <CleanTextInput
              kind="title"
              value={name}
              maxLength={NAME_MAX}
              autoComplete="organization"
              placeholder="Ali’s Barbershop"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="What you do" optionalLabel={false}>
            <Select value={kind} onChange={(e) => isBusinessKind(e.target.value) && setKind(e.target.value)}>
              {KINDS_OF_BUSINESS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button asChild variant="primary" size="lg">
            <Link href={href}>{early ? 'Save my spot' : 'Add your business'}</Link>
          </Button>
          <p className="text-sm text-ink-2">Starter is free. Nothing to pay before launch.</p>
        </div>
      </div>

      {/* A small version of a business's page on BUKU: an illustration (its words are the ones
          typed beside it), so it's hidden from screen readers and captioned as an example. */}
      <figure className="flex flex-col items-center gap-3">
        <div aria-hidden className="w-full max-w-[21rem] rounded-[2.25rem] bg-board p-2.5 shadow-lift">
          <div className="scope-light flex flex-col gap-4 rounded-[1.75rem] bg-canvas p-5 text-ink">
            <div className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-semibold text-brand-ink">
                {usable ? initials(clean) : 'B'}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={`truncate text-[1.05rem] font-semibold tracking-[-0.01em] ${usable ? '' : 'text-ink-3'}`}
                >
                  {shown}
                </span>
                <span className="text-sm text-ink-2">{kind}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-2 text-[0.8rem] font-medium">
              <span className="rounded-full bg-ok-soft px-2.5 py-1 text-brand-ink">Open now</span>
              <span className="rounded-full bg-sunken px-2.5 py-1 text-ink-2">3 in the queue</span>
            </div>
            <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface px-4 text-[0.92rem] ring-1 ring-line">
              {EXAMPLE_SERVICES[kind].map(([service, length]) => (
                <li key={service} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate">{service}</span>
                  <span className="tabular shrink-0 text-ink-3">{length}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2 text-[0.9rem] font-semibold">
              <span className="grid h-10 place-items-center rounded-full bg-brand text-on-brand">
                Book a time
              </span>
              <span className="grid h-10 place-items-center rounded-full bg-surface ring-1 ring-line">
                Join the queue
              </span>
            </div>
            <span className="truncate text-center text-[0.8rem] text-ink-3">
              onbuku.com/b/{slug(usable ? clean : '')}
            </span>
          </div>
        </div>
        <figcaption className="text-sm text-ink-3">An example of your page on BUKU</figcaption>
      </figure>
    </section>
  );
}
