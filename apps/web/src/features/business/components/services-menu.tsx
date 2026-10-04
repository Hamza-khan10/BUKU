import { CalendarCheck, Clock3, Hourglass } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { bookHref } from '@/features/booking/choices';
import { duration, money } from '@/lib/format';
import type { ServiceMenu } from '../types';

/** "Cancel free up to 12 hours before" and how bookings get confirmed — the business's own settings. */
export function BookingTerms({ booking }: { booking: ServiceMenu['booking'] }) {
  const notice =
    booking.cancellationWindowHours > 0
      ? `Cancel or move up to ${duration(booking.cancellationWindowHours * 60)} before without it counting as late`
      : 'Cancel or move any time before your visit';
  return (
    <ul className="flex flex-col gap-2 text-sm text-ink-2">
      <li className="flex items-start gap-2">
        <CalendarCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        {booking.confirmationMode === 'automatic'
          ? 'Bookings are confirmed straight away'
          : 'The business confirms each booking — you’ll be told as soon as it does'}
      </li>
      <li className="flex items-start gap-2">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        {notice}
      </li>
      {booking.minNoticeMinutes > 0 && (
        <li className="flex items-start gap-2">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          Book at least {duration(booking.minNoticeMinutes)} ahead
        </li>
      )}
    </ul>
  );
}

/**
 * The service menu: what the business offers, how long it takes, what it
 * costs (paid at the venue) — and, for services someone takes bookings for,
 * a way straight to booking it.
 */
export function ServicesMenu({ menu, slug }: { menu: ServiceMenu; slug: string }) {
  const groups = menu.categories.filter((c) => c.services.length > 0);
  if (groups.length === 0) {
    return (
      <EmptyState title="No services listed yet">
        This business hasn’t added its services to BUKU yet.
      </EmptyState>
    );
  }
  const single = groups.length === 1;
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section
          key={group.id ?? 'other'}
          aria-label={single ? undefined : group.name}
          className="flex flex-col gap-3"
        >
          {!single && <h3 className="font-display text-lg font-semibold">{group.name}</h3>}
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {group.services.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium text-ink">{s.name}</p>
                  {s.description && <p className="text-sm text-ink-2">{s.description}</p>}
                  <p className="text-sm text-ink-3">
                    {duration(s.durationMinutes)}
                    {s.staffIds.length > 0 &&
                      ` · ${s.staffIds.length} ${s.staffIds.length === 1 ? 'person does' : 'people do'} this`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <p className="font-semibold text-ink tabular">{money(s.price, s.currency)}</p>
                  {s.staffIds.length > 0 && (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={bookHref(slug, { serviceId: s.id }) as Route}>
                        Book<span className="sr-only"> {s.name}</span>
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-sm text-ink-3">Prices are set by the business and paid at the venue.</p>
    </div>
  );
}
