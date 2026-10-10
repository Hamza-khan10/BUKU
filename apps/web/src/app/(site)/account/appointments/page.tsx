import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { VisitList } from '@/features/booking/components/visit-list';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { title: 'Your visits', robots: { index: false, follow: false } };

const SCOPES = [
  { scope: 'upcoming', label: 'Upcoming', href: '/account/appointments' },
  { scope: 'past', label: 'Past', href: '/account/appointments?scope=past' },
] as const;

/** Every visit booked through BUKU: what's coming up, and what's been. */
export default async function VisitsPage({ searchParams }: PageProps<'/account/appointments'>) {
  const scope = (await searchParams).scope === 'past' ? 'past' : 'upcoming';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">Your visits</h1>
        <nav aria-label="Which visits" className="flex rounded-md bg-sunken p-1">
          {SCOPES.map((s) => (
            <Link
              key={s.scope}
              href={s.href as Route}
              aria-current={scope === s.scope ? 'page' : undefined}
              className={cn(
                'rounded px-4 py-2 text-sm font-medium text-ink-2 hover:text-ink',
                scope === s.scope && 'bg-surface text-ink shadow-soft',
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      <VisitList key={scope} scope={scope} />
    </div>
  );
}
