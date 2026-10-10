'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import type { ServiceMenu, StaffMember } from '@/features/business/types';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { book, fetchAvailability, fetchUpcoming, RECEIPT_KEY } from '../api';
import {
  addDays,
  choicesQuery,
  clockLabel,
  dayParts,
  daysBetween,
  readChoices,
  WINDOW_DAYS,
  windowFor,
  type BookingChoices,
} from '../choices';
import type { Receipt, Slot } from '../types';
import { BookingSummary, type SummaryProblem } from './booking-summary';
import { PersonChoice, ServiceChoice, serviceSummary } from './service-step';
import { Step } from './step';
import { DayChoice, TimeChoice } from './when-step';

export interface BookingBusiness {
  id: string;
  slug: string;
  name: string;
  city: string;
  timezone: string;
}

const sameMoment = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/**
 * Booking, start to finish, on one page: service → person (or anyone) → day
 * and time → book. Every choice is kept in the address (choices.ts), so
 * nothing is lost on refresh, going back, or signing in halfway. Times always
 * come fresh from the API; one taken in the meantime is said so, with the
 * other choices kept.
 */
export function BookingFlow({
  business,
  menu,
  staff,
  today,
  signedIn,
}: {
  business: BookingBusiness;
  menu: ServiceMenu;
  staff: StaffMember[];
  /** Today on the business's calendar (from the server, so both sides agree). */
  today: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const raw = readChoices(useSearchParams());

  // Only choices that exist here count (an old link may name a service that's gone).
  const services = menu.categories.flatMap((c) => c.services);
  const service = services.find((s) => s.id === raw.serviceId) ?? null;
  const people = service ? staff.filter((p) => service.staffIds.includes(p.id)) : [];
  const person = people.find((p) => p.id === raw.staffId) ?? null;
  const choices: BookingChoices = {
    serviceId: service?.id ?? null,
    staffId: person?.id ?? null,
    date: service ? raw.date : null,
    startAt: service ? raw.startAt : null,
  };

  const [editingService, setEditingService] = useState(!service);
  const [windowStart, setWindowStart] = useState(() => windowFor(today, choices.date));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SummaryProblem | null>(null);
  const [noteError, setNoteError] = useState<string | undefined>();
  const summaryRef = useRef<HTMLElement>(null);
  const [summaryInView, setSummaryInView] = useState(false);

  // Phones: the summary sits below the times; a bar offers the way there until it's on screen.
  useEffect(() => {
    const el = summaryRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setSummaryInView(Boolean(entry?.isIntersecting)), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toSummary = () => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    summaryRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('your-booking')?.focus({ preventScroll: true });
  };

  const lastDay = addDays(today, menu.booking.bookingHorizonDays);
  const days = Math.min(WINDOW_DAYS, daysBetween(windowStart, lastDay) + 1);

  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, enabled: signedIn, retry: false });
  const teamAccount = me.data?.account.type === 'employee';

  const availabilityKey = ['availability', business.slug, choices.serviceId, choices.staffId, windowStart];
  const availability = useQuery({
    queryKey: availabilityKey,
    queryFn: () =>
      fetchAvailability(business.slug, {
        serviceId: choices.serviceId!,
        staffId: choices.staffId,
        date: windowStart,
        days,
      }),
    enabled: Boolean(service) && service!.staffIds.length > 0 && days > 0,
    staleTime: 30_000,
  });

  const windowDays = availability.data?.days;
  // The chosen day if it's in view; otherwise the first day in view with free times.
  const date =
    (choices.date && windowDays?.some((d) => d.date === choices.date) ? choices.date : null) ??
    windowDays?.find((d) => d.slots.length > 0)?.date ??
    null;
  const slots = windowDays?.find((d) => d.date === date)?.slots ?? [];
  const slot: Slot | null = choices.startAt
    ? (slots.find((s) => sameMoment(s.startAt, choices.startAt!)) ?? null)
    : null;
  const takenMeanwhile = Boolean(choices.startAt && windowDays && choices.date === date && !slot);

  const set = (change: Partial<BookingChoices>) => {
    setProblem(null);
    setNoteError(undefined);
    window.history.replaceState(null, '', `${pathname}${choicesQuery({ ...choices, ...change })}`);
  };

  const signInHref = `/signin?next=${encodeURIComponent(`${pathname}${choicesQuery({ ...choices, date })}`)}`;

  /** The visit this person already has at exactly this time here (a retry after a lost answer). */
  const alreadyBooked = async (s: Slot): Promise<Receipt | null> => {
    const mine = await fetchUpcoming(50).catch(() => []);
    return (
      mine.find(
        (a) =>
          a.business.id === business.id &&
          a.service.id === choices.serviceId &&
          sameMoment(a.startAt, s.startAt) &&
          (a.status === 'pending' || a.status === 'confirmed'),
      ) ?? null
    );
  };

  const open = (receipt: Receipt) => {
    queryClient.setQueryData(RECEIPT_KEY(receipt.id), receipt);
    router.push(`/appointments/${receipt.id}?new=1` as Route);
  };

  const onBook = async (note: string | undefined) => {
    if (!service || !slot) return;
    setBusy(true);
    setProblem(null);
    setNoteError(undefined);
    try {
      open(
        await book({
          businessId: business.id,
          serviceId: service.id,
          staffId: choices.staffId,
          startAt: slot.startAt,
          notes: note,
        }),
      );
      return; // stays busy while the receipt opens
    } catch (err) {
      const error = err instanceof ApiError ? err : null;
      const code = error?.code;
      if (code === 'NETWORK_ERROR' || code === 'APPOINTMENT_OVERLAP') {
        // The booking may have gone through with only the answer lost: if so, show it.
        const found = await alreadyBooked(slot);
        if (found) {
          open(found);
          return;
        }
      }
      setBusy(false);
      if (code === 'SLOT_UNAVAILABLE' || code?.startsWith('SLOT_')) {
        set({ startAt: null });
        await queryClient.invalidateQueries({ queryKey: availabilityKey });
        setProblem({
          title: 'That time was just taken.',
          detail: 'The free times below are up to date. Choose another.',
        });
      } else if (code === 'APPOINTMENT_OVERLAP') {
        setProblem({
          title: 'You already have a visit booked at that time.',
          detail: 'Choose another time: BUKU never books you twice at once.',
        });
      } else if (code === 'BOOKING_NOT_ALLOWED') {
        setProblem({
          title: 'Team accounts can’t book visits.',
          detail: 'Sign out, then sign in with your own account to book.',
        });
      } else if (error?.status === 401) {
        setProblem({ title: 'Your session has ended.', detail: 'Your choices are kept.', signIn: true });
      } else if (code === 'VALIDATION_ERROR' && error?.fieldIssues.some((i) => i.path === 'notes')) {
        setNoteError(error.fieldIssues.find((i) => i.path === 'notes')?.message);
      } else if (code === 'NETWORK_ERROR') {
        setProblem({
          title: 'We couldn’t reach BUKU, so the booking wasn’t made.',
          detail:
            'Check your connection and try again. If it went through after all, trying again takes you to it.',
        });
      } else {
        setProblem({
          title: error?.message ?? 'Booking didn’t work. Please try again.',
          reference: error?.requestId,
        });
      }
    }
  };

  if (services.length === 0) {
    return (
      <Alert title="Nothing to book here yet">
        {business.name} hasn’t added services to BUKU yet. Their page shows how to reach them.
      </Alert>
    );
  }

  return (
    <div
      className={cn('grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]', slot && 'pb-24 lg:pb-0')}
    >
      <div className="flex min-w-0 flex-col gap-8">
        {teamAccount && (
          <Alert tone="wait" title="Team accounts can’t book visits">
            You’re signed in with an account your business made for work. To book for yourself, sign out and
            sign in with your own account.
          </Alert>
        )}

        <Step
          number={1}
          title="Service"
          done={Boolean(service) && !editingService}
          summary={service && serviceSummary(service)}
          onChange={() => setEditingService(true)}
        >
          <ServiceChoice
            menu={menu}
            value={choices.serviceId}
            onChange={(serviceId) => {
              const next = services.find((s) => s.id === serviceId);
              // Keep the person if they do this service too; the time belongs to the old service.
              const keep = next && choices.staffId && next.staffIds.includes(choices.staffId);
              set({ serviceId, staffId: keep ? choices.staffId : null, startAt: null });
              setEditingService(false);
            }}
          />
        </Step>

        {service && (
          <Step number={2} title="Who">
            {people.length > 0 ? (
              <PersonChoice
                staff={people}
                value={choices.staffId}
                onChange={(staffId) => set({ staffId, startAt: null })}
              />
            ) : (
              <p className="text-ink-2">
                Nobody at {business.name} takes online bookings for this service yet.
              </p>
            )}
          </Step>
        )}

        {service && people.length > 0 && (
          <Step number={3} title="When">
            {availability.isError ? (
              <Alert tone="danger" title="We couldn’t load the free times.">
                <Button variant="link" onClick={() => void availability.refetch()}>
                  Try again
                </Button>
              </Alert>
            ) : (
              <>
                <DayChoice
                  days={windowDays}
                  loading={availability.isPending}
                  value={date}
                  onChange={(d) => set({ date: d, startAt: null })}
                  onEarlier={
                    windowStart > today ? () => setWindowStart(addDays(windowStart, -WINDOW_DAYS)) : undefined
                  }
                  onLater={
                    addDays(windowStart, WINDOW_DAYS) <= lastDay
                      ? () => setWindowStart(addDays(windowStart, WINDOW_DAYS))
                      : undefined
                  }
                />
                {windowDays && !date && (
                  <p className="text-ink-2">
                    No free times in these two weeks{person ? ` with ${person.displayName}` : ''}.{' '}
                    {addDays(windowStart, WINDOW_DAYS) <= lastDay
                      ? 'Try later dates.'
                      : 'That’s as far ahead as this business takes bookings.'}
                  </p>
                )}
                {takenMeanwhile && (
                  <Alert tone="wait" title="The time you picked isn’t free any more">
                    Someone else took it. Choose another below.
                  </Alert>
                )}
                {date && slots.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="font-medium text-ink">{dayParts(date).label}</p>
                    <TimeChoice
                      slots={slots}
                      value={slot?.startAt ?? null}
                      onChange={(startAt) => set({ date, startAt })}
                    />
                  </div>
                )}
              </>
            )}
          </Step>
        )}
      </div>

      <aside ref={summaryRef} className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
        <BookingSummary
          businessName={business.name}
          city={business.city}
          timezone={business.timezone}
          service={service}
          person={person}
          slot={slot}
          booking={menu.booking}
          signedIn={signedIn}
          canBook={!teamAccount}
          signInHref={signInHref}
          busy={busy}
          problem={problem}
          noteError={noteError}
          onBook={(note) => void onBook(note)}
        />
      </aside>

      {slot && date && !summaryInView && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-2">
              <span className="font-semibold text-ink tabular">{clockLabel(slot.time)}</span>,{' '}
              {dayParts(date).label}
            </p>
            <Button variant="primary" onClick={toSummary}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
