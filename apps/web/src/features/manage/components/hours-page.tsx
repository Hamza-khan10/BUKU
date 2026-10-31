'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Pencil, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ME_KEY, fetchMe } from '@/features/auth/api';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, fetchStaff, managedKey, staffKey, type ManagedBusiness } from '../api';
import {
  groupEntries,
  groupWhen,
  scheduleInput,
  scheduleProblems,
  type EntryKind,
  type ScheduleEntry,
  type ScheduleGroup,
  type ScheduleInput,
} from '../schedule';
import {
  addClosure,
  addTimeOff,
  closuresKey,
  fetchClosures,
  fetchTimeOff,
  removeClosure,
  removeTimeOff,
  timeOffKey,
} from '../schedule-api';
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
      <TimeOff business={b} />
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: closuresKey(business.id) });
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
      <ScheduleList
        label="Coming closed days"
        query={closures}
        today={today}
        canChange={canChange}
        empty={{
          title: 'No closed days coming up',
          body: canChange ? 'Add one below when you’ll be closed.' : 'The business is open as usual.',
        }}
        remove={async (id) => {
          await removeClosure(business.id, id);
        }}
        removed={(g) => `Open again ${lower(groupWhen(g, today))}.`}
        refresh={refresh}
      />
      {canChange && (
        <DaysForm
          title="Add closed days"
          today={today}
          added="Closed days added. Nobody can book them."
          failed="The closed days couldn’t be added. Please try again."
          partLabel="Closed from"
          add={(input) => addClosure(business.id, input)}
          refresh={refresh}
        />
      )}
    </section>
  );
}

/**
 * One person's days that differ from their usual week: time off (a day, a stretch, an afternoon)
 * and extra hours (staying late one day). Owners and managers keep anyone's; everyone else keeps
 * their own — the profile customers book that is linked to their login.
 */
function TimeOff({ business }: { business: ManagedBusiness }) {
  const queryClient = useQueryClient();
  const today = dateIn(business.timezone);
  const manageAll = can(business.myRole, 'schedule.manage_all');
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const staff = useQuery({ queryKey: staffKey(business.id), queryFn: () => fetchStaff(business.id) });
  const people = (staff.data ?? []).filter((p) => p.isActive && (manageAll || p.userId === me.data?.id));
  const [chosen, setChosen] = useState<string | null>(null);
  const person = people.find((p) => p.id === chosen) ?? people[0];
  const entries = useQuery({
    queryKey: timeOffKey(business.id, person?.id ?? ''),
    queryFn: () => fetchTimeOff(business.id, person!.id),
    enabled: Boolean(person),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: timeOffKey(business.id, person?.id ?? '') });

  return (
    <section aria-labelledby="time-off" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="time-off" className="type-heading">
          Time off and extra hours
        </h2>
        <p className="text-ink-2">
          When someone is away, or stays later one day. Customers can only book them when they work.
        </p>
      </div>
      {staff.isPending || me.isPending ? (
        <Skeleton className="h-24" />
      ) : staff.isError || me.isError ? (
        <ErrorState title="The team isn’t loading" message="Please refresh the page in a moment." />
      ) : !person ? (
        <p className="text-ink-2">
          {manageAll
            ? 'Nobody can be booked here yet. Add the people customers book on the Team page first.'
            : 'You aren’t one of the people customers book here, so there’s no time off to keep.'}
        </p>
      ) : (
        <>
          {people.length > 1 && (
            <Field label="Whose days">
              <Select value={person.id} onChange={(e) => setChosen(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.userId && p.userId === me.data?.id ? `${p.displayName} (you)` : p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <ScheduleList
            label={`${person.displayName}’s coming days off and extra hours`}
            query={entries}
            today={today}
            canChange
            empty={{
              title: `Nothing coming up for ${person.displayName}`,
              body: 'They work their usual week.',
            }}
            remove={async (id) => {
              await removeTimeOff(business.id, person.id, id);
            }}
            removed={(g) =>
              g.kind === 'extra_hours'
                ? `${person.displayName}’s extra hours ${lower(groupWhen(g, today))} are taken off.`
                : `${person.displayName} works ${lower(groupWhen(g, today))} again.`
            }
            refresh={refresh}
          />
          <DaysForm
            key={person.id}
            title={`Add days for ${person.displayName}`}
            today={today}
            extra
            added="Saved. Free times follow it from now on."
            failed="That couldn’t be saved. Please try again."
            partLabel="Away from"
            add={(input, kind) => addTimeOff(business.id, person.id, { ...input, kind })}
            refresh={refresh}
          />
        </>
      )}
    </section>
  );
}

const lower = (text: string) => text.replace(/^[A-Z]/, (c) => c.toLowerCase());

/** Coming days, a stretch to a row; each removable as a whole by those who may. */
function ScheduleList({
  label,
  query,
  today,
  canChange,
  empty,
  remove,
  removed,
  refresh,
}: {
  label: string;
  query: { isPending: boolean; isError: boolean; data?: ScheduleEntry[] | undefined };
  today: string;
  canChange: boolean;
  empty: { title: string; body: string };
  remove: (id: string) => Promise<void>;
  removed: (group: ScheduleGroup) => string;
  refresh: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | undefined>();
  const run = async (group: ScheduleGroup) => {
    setRemoving(group.ids[0]!);
    setProblem(undefined);
    try {
      // One row per day: a stretch goes day by day, and what's left is shown if one fails.
      for (const id of group.ids) await remove(id);
      toast.success(removed(group));
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
    } finally {
      await refresh();
      setRemoving(null);
    }
  };

  if (query.isPending) return <Skeleton className="h-24" />;
  if (query.isError)
    return <ErrorState title="These days aren’t loading" message="Please refresh the page in a moment." />;
  const groups = groupEntries(query.data ?? []);
  return (
    <>
      <ProblemAlert problem={problem} />
      {groups.length === 0 ? (
        <EmptyState icon={CalendarOff} title={empty.title}>
          {empty.body}
        </EmptyState>
      ) : (
        <ul aria-label={label} className="flex flex-col gap-2">
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
                    <Badge tone={g.kind === 'extra_hours' ? 'ok' : g.startTime ? 'wait' : 'neutral'}>
                      {g.kind === 'extra_hours'
                        ? 'Extra hours'
                        : g.startTime
                          ? 'Part of the day'
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
                    onClick={() => void run(g)}
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
    </>
  );
}

const EMPTY = { from: '', to: '', partDay: false, startTime: '', endTime: '', reason: '' };

/** Adds a day, a stretch of whole days, part of a day — or, with `extra`, extra hours one day. */
function DaysForm({
  title,
  today,
  extra = false,
  added,
  failed,
  partLabel,
  add,
  refresh,
}: {
  title: string;
  today: string;
  extra?: boolean;
  added: string;
  failed: string;
  partLabel: string;
  add: (input: ScheduleInput, kind: EntryKind) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const headingId = useId();
  const [form, setForm] = useState(EMPTY);
  const [kind, setKind] = useState<EntryKind>('time_off');
  const [shown, setShown] = useState<ReturnType<typeof scheduleProblems>>({});
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const isExtra = kind === 'extra_hours';
  const set = (change: Partial<typeof EMPTY>) => {
    const next = { ...form, ...change };
    setForm(next);
    // Problems clear as they're fixed, never appear while typing.
    if (Object.keys(shown).length > 0) setShown(scheduleProblems(next, today, isExtra));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problems = scheduleProblems(form, today, isExtra);
    setShown(problems);
    const reason = form.reason.trim() ? REASON.safeParse(form.reason.trim()) : null;
    setReasonError(reason && !reason.success ? reason.error.issues[0]?.message : undefined);
    if (Object.keys(problems).length > 0 || (reason && !reason.success)) return;
    setProblem(undefined);
    setBusy(true);
    try {
      await add(scheduleInput(form, isExtra), kind);
      toast.success(added);
      setForm(EMPTY);
      setShown({});
    } catch (err) {
      setProblem(problemFrom(err, failed));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const timed = form.partDay || isExtra;
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6"
    >
      <h3 id={headingId} className="type-subheading">
        {title}
      </h3>
      <ProblemAlert problem={problem} />
      {extra && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">What kind</legend>
          {(
            [
              ['time_off', 'Time off'],
              ['extra_hours', 'Extra hours'],
            ] as const
          ).map(([value, text]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-[0.95rem] has-checked:border-brand has-checked:bg-brand-soft"
            >
              <input
                type="radio"
                name={`${headingId}-kind`}
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                  setShown({});
                }}
                className="accent-brand"
              />
              {text}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={timed ? 'The day' : 'First day'} required optionalLabel={false} error={shown.from}>
          <Input type="date" min={today} value={form.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        {!timed && (
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
      {!isExtra && (
        <Checkbox
          label="Only part of the day"
          description="From one time to another; the rest of the day as usual."
          checked={form.partDay}
          onCheckedChange={(v) => set({ partDay: v === true, to: '' })}
        />
      )}
      {timed && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={isExtra ? 'Working from' : partLabel}
            required
            optionalLabel={false}
            error={shown.startTime}
          >
            <Input type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          </Field>
          <Field label="Until" required optionalLabel={false} error={shown.endTime}>
            <Input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Why" hint="For the team, e.g. “Eid holidays”." error={reasonError}>
        <CleanTextInput
          kind="line"
          value={form.reason}
          onChange={(e) => set({ reason: e.target.value })}
          maxLength={200}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {title}
        </Button>
      </div>
    </form>
  );
}
