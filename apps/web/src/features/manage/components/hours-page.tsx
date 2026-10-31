'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, managedKey, type ManagedBusiness } from '../api';
import { groupEntries, groupWhen, scheduleInput, scheduleProblems, type ScheduleGroup } from '../schedule';
import { addClosure, closuresKey, fetchClosures, removeClosure } from '../schedule-api';
import { dayLabel as weekDayLabel, WEEK, weekFromApi } from '../setup';
import { dateIn } from '../visits';
import { OpeningHoursForm } from './opening-hours-form';

const REASON = zText({ kind: 'line', max: 200 });

/** /business/[id]/hours: the business loaded first; the whole team can look, owners and managers change. */
export function HoursPage({ id }: { id: string }) {
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
        title="Hours"
        description={`When people can come, in ${b.name}’s time (${b.timezone.replaceAll('_', ' ')}): the usual week, and the days that are different.`}
      />
      <OpeningHours business={b} />
      <ClosedDays business={b} />
    </div>
  );
}

/** The usual week: a summary, changed in place by those who may. */
function OpeningHours({ business }: { business: ManagedBusiness }) {
  const [editing, setEditing] = useState(false);
  const canChange = can(business.myRole, 'business.hours');
  const week = weekFromApi(business.hours);
  return (
    <section aria-labelledby="opening-hours" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="opening-hours" className="type-heading">
          Opening hours
        </h2>
        {canChange && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Change
          </Button>
        )}
      </div>
      {editing ? (
        <OpeningHoursForm
          business={business}
          onSaved={() => {
            setEditing(false);
            toast.success('Opening hours saved. Free times follow them from now on.');
          }}
        />
      ) : (
        <ul className="grid gap-1.5 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:grid-cols-2 sm:p-6">
          {WEEK.map(({ day, short }) => (
            <li key={day} className="flex gap-3 text-[0.95rem]">
              <span className="w-10 font-medium text-ink">{short}</span>
              <span className="tabular text-ink-2">{weekDayLabel(week[day])}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Days the business is closed, or open only part of the day: a holiday, a half day, a repair. */
function ClosedDays({ business }: { business: ManagedBusiness }) {
  const queryClient = useQueryClient();
  const canChange = can(business.myRole, 'schedule.manage_all');
  const today = dateIn(business.timezone);
  const closures = useQuery({
    queryKey: closuresKey(business.id),
    queryFn: () => fetchClosures(business.id),
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | undefined>();

  const remove = async (group: ScheduleGroup) => {
    setRemoving(group.ids[0]!);
    setProblem(undefined);
    try {
      // One row per day: a stretch goes day by day, and what's left is shown if one fails.
      for (const id of group.ids) await removeClosure(business.id, id);
      toast.success(`Open again ${groupWhen(group, today).replace(/^[A-Z]/, (c) => c.toLowerCase())}.`);
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
    } finally {
      await queryClient.invalidateQueries({ queryKey: closuresKey(business.id) });
      setRemoving(null);
    }
  };

  const groups = closures.data ? groupEntries(closures.data) : [];
  return (
    <section aria-labelledby="closed-days" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="closed-days" className="type-heading">
          Closed days
        </h2>
        <p className="text-ink-2">
          Holidays, half days, a day off for everyone: no free times are offered then. Bookings already made
          for those days stay — look at them in Appointments.
        </p>
      </div>
      <ProblemAlert problem={problem} />
      {closures.isPending ? (
        <Skeleton className="h-24" />
      ) : closures.isError ? (
        <ErrorState title="Closed days aren’t loading" message="Please refresh the page in a moment." />
      ) : groups.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No closed days coming up">
          {canChange ? 'Add one below when you’ll be closed.' : 'The business is open as usual.'}
        </EmptyState>
      ) : (
        <ul aria-label="Coming closed days" className="flex flex-col gap-2">
          {groups.map((g) => {
            const when = groupWhen(g, today);
            return (
              <li
                key={g.ids[0]}
                aria-label={when}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium text-ink">{when}</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                    <Badge tone={g.startTime ? 'wait' : 'neutral'}>
                      {g.startTime
                        ? 'Closed part of the day'
                        : g.ids.length > 1
                          ? `${g.ids.length} days`
                          : 'All day'}
                    </Badge>
                    {g.reason && <span className="truncate">{g.reason}</span>}
                  </div>
                </div>
                {canChange && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={removing === g.ids[0]}
                    disabled={removing !== null}
                    onClick={() => void remove(g)}
                  >
                    <Trash2 aria-hidden />
                    Remove<span className="sr-only"> ({when})</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canChange && <ClosureForm business={business} today={today} />}
    </section>
  );
}

const EMPTY = { from: '', to: '', partDay: false, startTime: '', endTime: '', reason: '' };

function ClosureForm({ business, today }: { business: ManagedBusiness; today: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [shown, setShown] = useState<ReturnType<typeof scheduleProblems>>({});
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<typeof EMPTY>) => {
    const next = { ...form, ...change };
    setForm(next);
    // Problems clear as they're fixed, never appear while typing.
    if (Object.keys(shown).length > 0) setShown(scheduleProblems(next, today));
  };

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problems = scheduleProblems(form, today);
    setShown(problems);
    const reason = form.reason.trim() ? REASON.safeParse(form.reason.trim()) : null;
    setReasonError(reason && !reason.success ? reason.error.issues[0]?.message : undefined);
    if (Object.keys(problems).length > 0 || (reason && !reason.success)) return;
    setProblem(undefined);
    setBusy(true);
    try {
      await addClosure(business.id, scheduleInput(form));
      toast.success('Closed days added. Nobody can book them.');
      setForm(EMPTY);
    } catch (err) {
      setProblem(problemFrom(err, 'The closed days couldn’t be added. Please try again.'));
    } finally {
      await queryClient.invalidateQueries({ queryKey: closuresKey(business.id) });
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void add(e)}
      aria-labelledby="add-closure"
      className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6"
    >
      <h3 id="add-closure" className="type-subheading">
        Add closed days
      </h3>
      <ProblemAlert problem={problem} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={form.partDay ? 'The day' : 'First day'}
          required
          optionalLabel={false}
          error={shown.from}
        >
          <Input type="date" min={today} value={form.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        {!form.partDay && (
          <Field label="Last day" hint="Leave it empty for one day." error={shown.to}>
            <Input
              type="date"
              min={form.from || today}
              value={form.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </Field>
        )}
      </div>
      <Checkbox
        label="Only part of the day"
        description="Closed from one time to another, open the rest of the day."
        checked={form.partDay}
        onCheckedChange={(v) => set({ partDay: v === true, to: '' })}
      />
      {form.partDay && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Closed from" required optionalLabel={false} error={shown.startTime}>
            <Input type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          </Field>
          <Field label="Until" required optionalLabel={false} error={shown.endTime}>
            <Input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Why" hint="For your team, e.g. “Eid holidays”." error={reasonError}>
        <CleanTextInput
          kind="line"
          value={form.reason}
          onChange={(e) => set({ reason: e.target.value })}
          maxLength={200}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Add closed days
        </Button>
      </div>
    </form>
  );
}
