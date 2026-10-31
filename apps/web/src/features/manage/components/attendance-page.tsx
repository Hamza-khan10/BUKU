'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, LogIn, LogOut, Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ME_KEY, fetchMe } from '@/features/auth/api';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import {
  can,
  fetchManaged,
  fetchStaff,
  managedKey,
  staffKey,
  type ManagedBusiness,
  type ManagedStaff,
} from '../api';
import { clockTime, correctionProblems, duration, wallClock, zonedToIso, type Shift } from '../attendance';
import {
  attendanceKey,
  clockIn,
  clockOut,
  correctShift,
  fetchPresent,
  fetchShifts,
  presentKey,
  shiftsKey,
} from '../attendance-api';
import { dateIn, dayLabel, shiftDate } from '../visits';
import { useNow } from './today';

/** /business/[id]/attendance: the business loaded first; the whole team uses it. */
export function AttendancePage({ id }: { id: string }) {
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (business.isPending) return <Skeleton className="h-80 max-w-3xl" />;
  if (business.isError) {
    const e = business.error instanceof ApiError ? business.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this business' : 'We couldn’t load this business'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.requestId}
      />
    );
  }
  const b = business.data;
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeading
        compact
        eyebrow={b.name}
        title="Attendance"
        description="Who’s at work, and when everyone came and went. Times are in the business’s own time."
      />
      <WhoIsIn business={b} />
      <Shifts business={b} />
    </div>
  );
}

/**
 * Everyone customers book, in or out: the front desk (and managers) clock anyone, everyone else
 * themselves. Who's in also tells the queue how many people serve (its wait estimates).
 */
function WhoIsIn({ business }: { business: ManagedBusiness }) {
  const queryClient = useQueryClient();
  const now = useNow();
  const desk = can(business.myRole, 'attendance.manage');
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const staff = useQuery({ queryKey: staffKey(business.id), queryFn: () => fetchStaff(business.id) });
  const present = useQuery({
    queryKey: presentKey(business.id),
    queryFn: () => fetchPresent(business.id),
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | undefined>();

  const people = (staff.data ?? []).filter((p) => p.isActive);
  const mine = (p: ManagedStaff) => Boolean(p.userId) && p.userId === me.data?.id;
  const since = new Map((present.data ?? []).map((p) => [p.staffId, p.since]));

  const toggle = async (person: ManagedStaff) => {
    const isIn = since.has(person.id);
    setBusy(person.id);
    setProblem(undefined);
    try {
      if (isIn) await clockOut(business.id, person.id);
      else await clockIn(business.id, person.id);
      const who = mine(person) ? 'You’re' : `${person.displayName} is`;
      toast.success(isIn ? `${who} clocked out.` : `${who} clocked in.`);
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
    } finally {
      await queryClient.invalidateQueries({ queryKey: attendanceKey(business.id) });
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="who-is-in" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="who-is-in" className="type-heading">
          Who’s in
        </h2>
        <p className="text-ink-2">
          {desk
            ? 'Clock people in when they arrive and out when they leave.'
            : 'Clock yourself in when you arrive and out when you leave.'}
        </p>
      </div>
      <ProblemAlert problem={problem} />
      {staff.isPending || present.isPending || me.isPending ? (
        <Skeleton className="h-32" />
      ) : staff.isError || present.isError || me.isError ? (
        <ErrorState title="Attendance isn’t loading" message="Please refresh the page in a moment." />
      ) : people.length === 0 ? (
        <EmptyState icon={Clock} title="Nobody to clock in yet">
          The people customers book are added on the Team page.
        </EmptyState>
      ) : (
        <ul aria-label="The team" className="flex flex-col gap-2">
          {people.map((p) => {
            const at = since.get(p.id);
            const name = mine(p) ? `${p.displayName} (you)` : p.displayName;
            const allowed = desk || mine(p);
            return (
              <li
                key={p.id}
                aria-label={name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-ink">{name}</p>
                  <p className="text-sm text-ink-2">
                    {at ? (
                      <>
                        <Badge tone="ok">In</Badge> since {clockTime(at, business.timezone)} ·{' '}
                        {duration((now - Date.parse(at)) / 60_000)}
                      </>
                    ) : (
                      <Badge tone="neutral">Out</Badge>
                    )}
                  </p>
                </div>
                {allowed && (
                  <Button
                    size="sm"
                    variant={at ? 'secondary' : 'primary'}
                    loading={busy === p.id}
                    disabled={busy !== null}
                    onClick={() => void toggle(p)}
                  >
                    {at ? <LogOut aria-hidden /> : <LogIn aria-hidden />}
                    {at ? 'Clock out' : 'Clock in'}
                    <span className="sr-only"> ({p.displayName})</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One day's shifts (today first); owners and managers can correct a forgotten or wrong time. */
function Shifts({ business }: { business: ManagedBusiness }) {
  const today = dateIn(business.timezone);
  const [date, setDate] = useState(today);
  const managing = can(business.myRole, 'schedule.manage_all');
  const day = useQuery({
    queryKey: shiftsKey(business.id, date),
    queryFn: () => fetchShifts(business.id, date),
    refetchInterval: date === today ? 30_000 : false,
  });
  const [correcting, setCorrecting] = useState<Shift | null>(null);
  const total = (day.data?.items ?? []).reduce((sum, s) => sum + s.minutes, 0);

  return (
    <section aria-labelledby="shifts" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="shifts" className="type-heading">
            Shifts
          </h2>
          <p className="text-ink-2">
            {managing
              ? 'Everyone’s comings and goings, day by day.'
              : 'Your own comings and goings, day by day.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="The day before"
            onClick={() => setDate(shiftDate(date, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="tabular min-w-28 text-center font-medium text-ink" aria-live="polite">
            {dayLabel(date, today)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="The day after"
            disabled={date >= today}
            onClick={() => setDate(shiftDate(date, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      {day.isPending ? (
        <Skeleton className="h-28" />
      ) : day.isError ? (
        <ErrorState title="These shifts aren’t loading" message="Please try again in a moment." />
      ) : day.data.items.length === 0 ? (
        <EmptyState icon={Clock} title="No shifts this day">
          Clocking in starts one.
        </EmptyState>
      ) : (
        <>
          <ul aria-label={`Shifts, ${dayLabel(date, today)}`} className="flex flex-col gap-2">
            {day.data.items.map((s) => {
              const span = `${clockTime(s.checkInAt, business.timezone)} – ${
                s.checkOutAt ? clockTime(s.checkOutAt, business.timezone) : 'still in'
              }`;
              return (
                <li
                  key={s.id}
                  aria-label={`${s.displayName}, ${span}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium text-ink">{s.displayName}</p>
                    <p className="tabular text-sm text-ink-2">
                      {span} · {duration(s.minutes)}
                      {s.open && (
                        <>
                          {' '}
                          <Badge tone="ok">On shift</Badge>
                        </>
                      )}
                    </p>
                    {s.note && <p className="text-sm text-ink-3">{s.note}</p>}
                  </div>
                  {managing && (
                    <Button size="sm" variant="ghost" onClick={() => setCorrecting(s)}>
                      <Pencil aria-hidden />
                      Correct
                      <span className="sr-only">
                        {' '}
                        ({s.displayName}, {span})
                      </span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="tabular text-sm text-ink-2">Worked this day, all together: {duration(total)}</p>
        </>
      )}
      {correcting && (
        <CorrectShift business={business} shift={correcting} onClose={() => setCorrecting(null)} />
      )}
    </section>
  );
}

/** A forgotten clock-out, a wrong time: fixed by a manager, kept in the audit log with the old times. */
function CorrectShift({
  business,
  shift,
  onClose,
}: {
  business: ManagedBusiness;
  shift: Shift;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const tz = business.timezone;
  const [form, setForm] = useState({
    checkIn: wallClock(shift.checkInAt, tz),
    checkOut: shift.checkOutAt ? wallClock(shift.checkOutAt, tz) : '',
  });
  const [shown, setShown] = useState<ReturnType<typeof correctionProblems>>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problems = correctionProblems(form, tz, Date.now());
    setShown(problems);
    if (Object.keys(problems).length > 0) return;
    setProblem(undefined);
    setBusy(true);
    try {
      const checkInAt = zonedToIso(form.checkIn, tz)!;
      const checkOutAt = form.checkOut ? zonedToIso(form.checkOut, tz)! : undefined;
      await correctShift(business.id, shift.id, { checkInAt, ...(checkOutAt && { checkOutAt }) });
      await queryClient.invalidateQueries({ queryKey: attendanceKey(business.id) });
      toast.success(`${shift.displayName}’s shift is corrected. The old times are kept in the audit log.`);
      onClose();
    } catch (err) {
      setProblem(problemFrom(err, 'The shift couldn’t be corrected. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Correct ${shift.displayName}’s shift`}
        description="In the business’s own time. The change is recorded, with the times it replaces."
      >
        <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <ProblemAlert problem={problem} />
          <Field label="Clocked in" required optionalLabel={false} error={shown.checkIn}>
            <Input
              type="datetime-local"
              value={form.checkIn}
              onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            />
          </Field>
          <Field
            label="Clocked out"
            hint={shift.open ? 'Leave it empty while they’re still in.' : undefined}
            error={shown.checkOut}
          >
            <Input
              type="datetime-local"
              value={form.checkOut}
              onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button">Keep it</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={busy}>
              Save the correction
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
