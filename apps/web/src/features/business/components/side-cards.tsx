import { ExternalLink, Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { DAY_NAMES, hoursOn, openState, WEEK, wallClock } from '@/lib/format';
import type { BusinessProfile } from '../types';

export function SideCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-lg border border-line bg-surface p-5 shadow-soft', className)}
    >
      <h2 className="mb-3 text-lg tracking-[-0.015em] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Opening hours for the week, today marked, in the business's own time. */
export function HoursCard({ business }: { business: BusinessProfile }) {
  const today = wallClock(business.timezone).day;
  const open = openState(business.hours, business.timezone).open;
  return (
    <SideCard title="Opening hours">
      <dl className="flex flex-col gap-1.5 text-sm">
        {WEEK.map((day) => {
          const periods = hoursOn(business.hours, day);
          const isToday = day === today;
          return (
            <div
              key={day}
              className={cn(
                'flex justify-between gap-4 rounded-sm px-2 py-1',
                isToday && 'bg-sunken font-medium text-ink',
              )}
            >
              <dt>
                {DAY_NAMES[day]}
                {isToday && <span className="sr-only"> (today{open ? ', open now' : ''})</span>}
              </dt>
              <dd className="text-right tabular">
                {periods.length === 0 ? (
                  <span className="text-ink-3">Closed</span>
                ) : (
                  periods.map((p) => `${p.openTime}–${p.closeTime}`).join(', ')
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-ink-3">
        Times are local to the business ({business.timezone.replace('_', ' ')}).
      </p>
    </SideCard>
  );
}

/** Where it is and how to reach it. Directions open the visitor's own maps app — no map loaded here. */
export function VisitCard({ business }: { business: BusinessProfile }) {
  const { address, contact, location } = business;
  const lines = [address.line, [address.city, address.state].filter(Boolean).join(', '), address.postalCode]
    .filter(Boolean)
    .join('\n');
  const directions = location
    ? `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.line}, ${address.city}`)}`;
  const link = 'inline-flex min-h-11 items-center gap-2 font-medium text-brand-ink hover:underline';
  return (
    <SideCard title="Visit">
      <address className="flex items-start gap-2 text-sm whitespace-pre-line text-ink-2 not-italic">
        <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        {lines}
      </address>
      <div className="mt-2 flex flex-col">
        <a href={directions} target="_blank" rel="noopener noreferrer" className={link}>
          <ExternalLink className="size-4" aria-hidden /> Directions
          <span className="sr-only"> (opens Google Maps)</span>
        </a>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className={link}>
            <Phone className="size-4" aria-hidden /> {contact.phone}
          </a>
        )}
        {contact.website && (
          <a href={contact.website} target="_blank" rel="noopener noreferrer nofollow" className={link}>
            <Globe className="size-4" aria-hidden /> {new URL(contact.website).host}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className={link}>
            <Mail className="size-4" aria-hidden /> {contact.email}
          </a>
        )}
      </div>
    </SideCard>
  );
}
