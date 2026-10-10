'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { problemFrom, type Problem } from '@/features/auth/problems';
import type { ServiceMenu, StaffMember } from '@/features/business/types';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { duration, possessive } from '@/lib/format';
import { fetchAvailability, fetchReceipt, moveVisit, RECEIPT_KEY } from '../api';
import { addDays, clockLabel, dayParts, daysBetween, todayIn, WINDOW_DAYS } from '../choices';
import { useInsideNotice } from '../notice';
import type { Receipt } from '../types';
import { PersonChoice } from './service-step';
import { Step } from './step';
import { DayChoice, TimeChoice } from './when-step';

/**
 * Moving a visit to another time (same service, same place). Allowed until
 * the business's notice period begins; the visit gets a new code, and the
 * old time is given back. Keeps the same person unless another is chosen.
 */
export function MoveFlow({ id }: { id: string }) {
  const receipt = useQuery({
    queryKey: RECEIPT_KEY(id),
    queryFn: () => fetchReceipt(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  if (receipt.isPending) {
    return <Skeleton className="h-64 max-w-xl" />;
  }
  if (receipt.error) {
    const e = receipt.error instanceof ApiError ? receipt.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this booking' : 'We couldn’t load this booking'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.status === 404 ? undefined : e?.requestId}
      />
    );
  }
  return <MoveChoices receipt={receipt.data} />;
}

function MoveChoices({ receipt: r }: { receipt: Receipt }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tz = r.local.timezone;
  const live = (r.status === 'pending' || r.status === 'confirmed') && !r.checkedInAt;

  const menu = useQuery({
    queryKey: ['menu', r.business.slug],
    queryFn: () => api<ServiceMenu>(`businesses/${r.business.slug}/services`),
    enabled: live,
  });
  const staff = useQuery({
    queryKey: ['staff', r.business.slug],
    queryFn: () => api<StaffMember[]>(`businesses/${r.business.slug}/staff`),
    enabled: live,
  });

  const [today] = useState(() => todayIn(tz));
  const [staffId, setStaffId] = useState<string | null>(r.staff?.id ?? null);
  const [windowStart, setWindowStart] = useState(today);
  const [date, setDate] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const people = (staff.data ?? []).filter((p) => p.serviceIds.includes(r.service.id));
  const horizon = menu.data?.booking.bookingHorizonDays ?? 365;
  const notice = menu.data?.booking.cancellationWindowHours ?? 0;
  const lastDay = addDays(today, horizon);
  const days = Math.min(WINDOW_DAYS, daysBetween(windowStart, lastDay) + 1);

  const availabilityKey = ['availability', r.business.slug, r.service.id, staffId, windowStart];
  const availability = useQuery({
    queryKey: availabilityKey,
    queryFn: () =>
      fetchAvailability(r.business.slug, { serviceId: r.service.id, staffId, date: windowStart, days }),
    enabled: live && r.policy.canReschedule && days > 0,
    staleTime: 30_000,
  });
  const windowDays = availability.data?.days;
  const day =
    (date && windowDays?.some((d) => d.date === date) ? date : null) ??
    windowDays?.find((d) => d.slots.length > 0)?.date ??
    null;
  const slots = windowDays?.find((d) => d.date === day)?.slots ?? [];
  const slot = startAt ? (slots.find((s) => s.startAt === startAt) ?? null) : null;
  const insideNotice = useInsideNotice(slot?.startAt, notice);

  const back = (
    <Link
      href={`/appointments/${r.id}` as Route}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden /> Back to the booking
    </Link>
  );

  if (!live || !r.policy.canReschedule) {
    return (
      <div className="flex max-w-xl flex-col gap-5">
        {back}
        <Alert tone="wait" title="This visit can’t be moved any more">
          {live
            ? `It’s inside ${possessive(r.business.name)} notice period. You can still cancel it, or contact the business.`
            : 'Only upcoming visits can be moved.'}
        </Alert>
      </div>
    );
  }

  const move = async () => {
    if (!slot) return;
    setBusy(true);
    setProblem(null);
    try {
      const moved = await moveVisit(r.id, { startAt: slot.startAt, staffId });
      queryClient.setQueryData(RECEIPT_KEY(moved.id), moved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RECEIPT_KEY(r.id) }),
        queryClient.invalidateQueries({ queryKey: ['visits'] }),
      ]);
      router.replace(`/appointments/${moved.id}?moved=1` as Route);
      return; // stays busy while the new booking opens
    } catch (err) {
      setBusy(false);
      const code = err instanceof ApiError ? err.code : undefined;
      if (code?.startsWith('SLOT_')) {
        setStartAt(null);
        await queryClient.invalidateQueries({ queryKey: availabilityKey });
        setProblem({
          title: 'That time was just taken.',
          detail: 'The free times are up to date. Choose another.',
        });
      } else if (code === 'CANCELLATION_WINDOW_PASSED') {
        await queryClient.invalidateQueries({ queryKey: RECEIPT_KEY(r.id) });
      } else if (code === 'APPOINTMENT_OVERLAP') {
        setProblem({
          title: 'You already have a visit booked at that time.',
          detail: 'Choose another time.',
        });
      } else {
        setProblem(problemFrom(err, 'Moving the visit didn’t work. Please try again.'));
      }
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        {back}
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">Move your visit</h1>
        <p className="text-ink-2">
          {r.service.name} at {r.business.name}. Now:{' '}
          <span className="font-medium text-ink">
            {dayParts(r.local.date).label}, {clockLabel(r.local.startTime)}
            {r.staff && ` with ${r.staff.displayName}`}
          </span>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {people.length > 0 && (
            <Step number={1} title="Who">
              <PersonChoice
                staff={people}
                value={staffId}
                onChange={(next) => {
                  setStaffId(next);
                  setStartAt(null);
                }}
              />
            </Step>
          )}
          <Step number={people.length > 0 ? 2 : 1} title="New time">
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
                  value={day}
                  onChange={(d) => {
                    setDate(d);
                    setStartAt(null);
                  }}
                  onEarlier={
                    windowStart > today ? () => setWindowStart(addDays(windowStart, -WINDOW_DAYS)) : undefined
                  }
                  onLater={
                    addDays(windowStart, WINDOW_DAYS) <= lastDay
                      ? () => setWindowStart(addDays(windowStart, WINDOW_DAYS))
                      : undefined
                  }
                />
                {windowDays && !day && (
                  <p className="text-ink-2">No free times in these two weeks. Try later dates.</p>
                )}
                {day && slots.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="font-medium text-ink">{dayParts(day).label}</p>
                    <TimeChoice
                      slots={slots}
                      value={slot?.startAt ?? null}
                      onChange={(s) => {
                        setDate(day);
                        setStartAt(s);
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </Step>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-soft">
            <h2 className="text-xl tracking-[-0.02em] font-semibold text-ink">The new time</h2>
            <p className="text-ink-2">
              {slot && day ? (
                <span className="font-medium text-ink">
                  {dayParts(day).label}, {clockLabel(slot.time)}
                </span>
              ) : (
                'Choose a day and a time.'
              )}
            </p>
            {insideNotice && (
              <Alert tone="wait" title={`Less than ${duration(notice * 60)} away`}>
                That’s inside the notice period: if you cancel it later, it counts as late, and it can’t be
                moved again.
              </Alert>
            )}
            {problem && (
              <Alert tone="danger" title={problem.title}>
                {problem.detail && <p>{problem.detail}</p>}
                {problem.reference && <p className="font-mono text-xs">Reference: {problem.reference}</p>}
              </Alert>
            )}
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!slot}
              loading={busy}
              onClick={() => void move()}
            >
              Move to this time
            </Button>
            <p className="text-sm text-ink-3">
              Your visit gets a new booking code; the old time is given back to the business.
              {menu.data?.booking.confirmationMode === 'manual' && ' The business confirms the new time.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
