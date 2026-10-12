'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextarea, CleanTextInput } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { fetchMe, ME_KEY, type Me } from '@/features/auth/api';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import {
  can,
  createStaff,
  deactivateStaff,
  fetchMembers,
  fetchMenu,
  fetchStaff,
  fetchStaffHours,
  membersKey,
  menuKey,
  ROLE_LABELS,
  setStaffHours,
  staffHoursKey,
  staffKey,
  updateStaff,
  type ManagedBusiness,
  type ManagedService,
  type ManagedStaff,
  type Member,
} from '../api';
import {
  weekFromApi,
  weekFromStaffDays,
  weekProblems,
  weekSummary,
  weekToApi,
  weekToStaffDays,
  type Week,
} from '../setup';
import { StaffPhoto } from './staff-photo';
import { WeekEditor } from './week-editor';

const NAME = zText({ kind: 'personName', min: 1, max: 100 });
const BIO = zText({ kind: 'text', max: 1000 });

/**
 * The people customers can book (3.5d): each with what they do and when they work (the opening
 * hours, or their own), an optional photo given with their agreement, and — if they sign in to
 * BUKU — their login, so they can keep their own hours. Taking someone off bookings keeps their
 * history; they can be brought back.
 */
export function PeopleSection({ business }: { business: ManagedBusiness }) {
  const manageLogins = can(business.myRole, 'members.manage');
  const menu = useQuery({ queryKey: menuKey(business.id), queryFn: () => fetchMenu(business.id) });
  const staff = useQuery({ queryKey: staffKey(business.id), queryFn: () => fetchStaff(business.id) });
  const members = useQuery({
    queryKey: membersKey(business.id),
    queryFn: () => fetchMembers(business.id),
    enabled: manageLogins,
  });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (menu.isPending || staff.isPending || me.isPending || (manageLogins && members.isPending)) {
    return <Skeleton className="h-56" />;
  }
  if (menu.isError || staff.isError || me.isError || members.isError) {
    return <ErrorState title="Your team didn’t load" message="Please refresh the page to try again." />;
  }

  const services = menu.data.categories.flatMap((c) => c.services).filter((s) => s.isActive);
  const people = staff.data.filter((s) => s.isActive);
  const away = staff.data.filter((s) => !s.isActive);
  const context = { business, services, staff: staff.data, members: members.data ?? [], me: me.data };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-2">
          {people.length === 0
            ? 'Nobody can be booked yet.'
            : `${people.length} ${people.length === 1 ? 'person' : 'people'} customers can book.`}
        </p>
        {!adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add a person
          </Button>
        )}
      </div>

      {adding && (
        <PersonForm
          {...context}
          onSaved={(p) => {
            setAdding(false);
            // Straight on to their details, where a photo can be added now that they exist.
            setEditing(p.id);
            toast.success(`${p.displayName} can be booked now.`);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {people.length === 0 && !adding ? (
        <EmptyState icon={UsersRound} title="No one here yet">
          Add the people who do your services. Each one’s working hours make the free times customers see.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map((p) =>
            editing === p.id ? (
              <li key={p.id}>
                <PersonForm
                  {...context}
                  person={p}
                  onSaved={() => {
                    setEditing(null);
                    toast.success('Your changes are saved.');
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <PersonRow key={p.id} {...context} person={p} onEdit={() => setEditing(p.id)} />
            ),
          )}
        </ul>
      )}

      {away.length > 0 && <Away business={business} people={away} />}
    </div>
  );
}

interface Context {
  business: ManagedBusiness;
  services: ManagedService[];
  staff: ManagedStaff[];
  members: Member[];
  me: Me;
}

/** Whose login a profile is linked to, said plainly. */
function loginLabel(person: ManagedStaff, members: Member[], me: Me): string {
  if (!person.userId) return 'No BUKU login';
  if (person.userId === me.id) return 'You';
  const m = members.find((x) => x.userId === person.userId);
  return m ? `${ROLE_LABELS[m.role]} login${m.username ? ` · ${m.username}` : ''}` : 'Has a BUKU login';
}

function PersonRow({
  business,
  services,
  members,
  me,
  person,
  onEdit,
}: Context & { person: ManagedStaff; onEdit: () => void }) {
  const hours = useQuery({
    queryKey: staffHoursKey(business.id, person.id),
    queryFn: () => fetchStaffHours(business.id, person.id),
  });
  const does = services.filter((s) => person.serviceIds.includes(s.id));
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <Avatar name={person.displayName} src={person.photoUrl} size={56} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold text-ink">{person.displayName}</span>
          <span className={cn('text-sm', does.length > 0 ? 'text-ink-2' : 'font-medium text-wait-ink')}>
            {does.length > 0
              ? does.map((s) => s.name).join(', ')
              : 'No services yet, so nobody can book them.'}
          </span>
          <span className="tabular text-sm text-ink-3">
            {hours.isSuccess ? weekSummary(weekFromStaffDays(hours.data)) : ' '}
          </span>
          <span className="text-sm text-ink-3">{loginLabel(person, members, me)}</span>
        </div>
      </div>
      <div className="shrink-0">
        <Button size="sm" onClick={onEdit}>
          Change<span className="sr-only"> {person.displayName}</span>
        </Button>
      </div>
    </li>
  );
}

function PersonForm({
  business,
  services,
  staff,
  members,
  me,
  person,
  onSaved,
  onCancel,
}: Context & { person?: ManagedStaff; onSaved: (p: ManagedStaff) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const opening = weekFromApi(business.hours);
  const theirs = useQuery({
    queryKey: person ? staffHoursKey(business.id, person.id) : ['none'],
    queryFn: () => fetchStaffHours(business.id, person!.id),
    enabled: Boolean(person),
  });
  if (person && theirs.isPending) return <Skeleton className="h-72" />;
  const start = person && theirs.data ? weekFromStaffDays(theirs.data) : opening;
  return (
    <PersonFields
      key={person?.id ?? 'new'}
      {...{ business, services, staff, members, me, person, onSaved, onCancel, opening, start, queryClient }}
    />
  );
}

function PersonFields({
  business,
  services,
  staff,
  members,
  me,
  person,
  onSaved,
  onCancel,
  opening,
  start,
  queryClient,
}: Context & {
  person?: ManagedStaff;
  onSaved: (p: ManagedStaff) => void;
  onCancel: () => void;
  opening: Week;
  start: Week;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const same = JSON.stringify(weekToApi(start)) === JSON.stringify(weekToApi(opening));
  const [name, setName] = useState(person?.displayName ?? '');
  const [bio, setBio] = useState(person?.bio ?? '');
  const [does, setDoes] = useState<string[]>(person?.serviceIds ?? []);
  const [mode, setMode] = useState<'opening' | 'own'>(same ? 'opening' : 'own');
  const [week, setWeek] = useState<Week>(start);
  const [login, setLogin] = useState(person?.userId ?? '');
  const [errors, setErrors] = useState<{
    name?: string;
    bio?: string;
    hours?: Record<number, string>;
    week?: string;
  }>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  // A login can be linked to one profile: those already linked elsewhere aren't offered.
  const taken = new Set(staff.filter((s) => s.id !== person?.id && s.userId).map((s) => s.userId));
  const logins = [
    ...(taken.has(me.id) ? [] : [{ value: me.id, label: `You (${me.name})` }]),
    ...members
      .filter((m) => m.status === 'active' && !taken.has(m.userId))
      .map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]}` })),
  ];

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = NAME.safeParse(name);
    const b = BIO.safeParse(bio);
    const hours = mode === 'own' ? weekProblems(week) : { days: {} };
    const found = {
      ...(!name.trim()
        ? { name: 'Please write their name.' }
        : !n.success && { name: n.error.issues[0]?.message }),
      ...(!b.success && { bio: b.error.issues[0]?.message }),
      ...(Object.keys(hours.days).length > 0 && { hours: hours.days }),
      ...('week' in hours && hours.week && { week: hours.week }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setProblem(undefined);
    setBusy(true);
    try {
      const input = { displayName: n.data!, bio: b.data || null, serviceIds: does, userId: login || null };
      const saved = person
        ? await updateStaff(business.id, person.id, input)
        : await createStaff(business.id, input);
      await setStaffHours(business.id, saved.id, weekToStaffDays(mode === 'opening' ? opening : week));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: staffKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: menuKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: staffHoursKey(business.id, saved.id) }),
      ]);
      onSaved(saved);
    } catch (err) {
      const issue =
        err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'displayName') : undefined;
      if (issue) setErrors({ name: issue.message });
      else setProblem(problemFrom(err, 'Their details couldn’t be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await deactivateStaff(business.id, person!.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: staffKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: menuKey(business.id) }),
      ]);
      setConfirm(false);
      toast(`${person!.displayName} isn’t taking bookings now.`);
      onCancel();
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void save(e)}
      className="flex flex-col gap-5 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line animate-rise sm:p-6"
    >
      <h3 className="type-subheading">{person ? person.displayName : 'Someone customers can book'}</h3>
      <ProblemAlert problem={problem} />
      <Field
        label="Name"
        required
        optionalLabel={false}
        hint="As customers see it on their booking."
        error={errors.name}
      >
        <CleanTextInput
          kind="personName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </Field>
      <Field
        label="About them"
        hint="A line customers read, like “Fades and beard trims, 8 years”."
        error={errors.bio}
      >
        <CleanTextarea
          kind="text"
          rows={2}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={1000}
        />
      </Field>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[0.95rem] font-medium text-ink">What they do</legend>
        {services.length === 0 ? (
          <p className="text-sm text-ink-3">Add your services first; then choose who does which.</p>
        ) : (
          services.map((s) => (
            <Checkbox
              key={s.id}
              label={s.name}
              checked={does.includes(s.id)}
              onCheckedChange={(on) =>
                setDoes((d) => (on === true ? [...d, s.id] : d.filter((x) => x !== s.id)))
              }
            />
          ))
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[0.95rem] font-medium text-ink">When they work</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(
            [
              { value: 'opening', title: 'Your opening hours', text: weekSummary(opening) },
              { value: 'own', title: 'Their own hours', text: 'A day off, shorter days, a later start.' },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              className="flex flex-1 cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3 has-checked:border-brand has-checked:bg-brand-soft"
            >
              <input
                type="radio"
                name={`hours-${person?.id ?? 'new'}`}
                checked={mode === o.value}
                onChange={() => setMode(o.value)}
                className="mt-1 size-4 accent-(--brand)"
              />
              <span className="flex flex-col">
                <span className="font-medium text-ink">{o.title}</span>
                <span className="text-sm text-ink-3">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === 'own' && (
          <>
            <WeekEditor
              week={week}
              onChange={setWeek}
              problems={errors.hours ?? {}}
              label="Their working hours"
            />
            {errors.week && (
              <p className="text-sm font-medium text-danger">
                {errors.week.replace('people can come', 'customers can book them')}
              </p>
            )}
          </>
        )}
      </fieldset>

      {logins.length > 0 || person?.userId ? (
        <Field
          label="Their BUKU login"
          hint="Linked, they can keep their own hours and see their own visits when they sign in."
        >
          <Select value={login} onChange={(e) => setLogin(e.target.value)}>
            <option value="">No login</option>
            {logins.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {person?.userId && !logins.some((l) => l.value === person.userId) && (
              <option value={person.userId}>{loginLabel(person, members, me)}</option>
            )}
          </Select>
        </Field>
      ) : null}

      {person && <StaffPhoto businessId={business.id} person={person} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          {person ? 'Save changes' : 'Add them'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {person ? 'Close' : 'Cancel'}
        </Button>
        {person && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-danger"
            onClick={() => setConfirm(true)}
          >
            Stop taking bookings
          </Button>
        )}
      </div>

      {person && (
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent
            title={`Stop bookings for ${person.displayName}?`}
            description="Customers can’t choose them any more. Visits already booked with them still happen; past ones keep their name. You can bring them back."
          >
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button variant="secondary">Keep them</Button>
              </DialogClose>
              <Button variant="danger" loading={busy} onClick={() => void stop()}>
                Stop bookings
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </form>
  );
}

function Away({ business, people }: { business: ManagedBusiness; people: ManagedStaff[] }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const restore = async (p: ManagedStaff) => {
    setBusy(p.id);
    setProblem(null);
    try {
      await updateStaff(business.id, p.id, { isActive: true });
      await queryClient.invalidateQueries({ queryKey: staffKey(business.id) });
      toast.success(`${p.displayName} can be booked again.`);
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.').title);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="rounded-xl border border-line p-4 sm:p-5">
      <summary className="cursor-pointer font-medium text-ink-2 marker:text-ink-3">
        Not taking bookings ({people.length})
      </summary>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-3">
              <Avatar name={p.displayName} src={p.photoUrl} size={36} />
              <span className="font-medium text-ink-2">{p.displayName}</span>
            </span>
            <Button size="sm" loading={busy === p.id} onClick={() => void restore(p)}>
              Bring them back<span className="sr-only"> ({p.displayName})</span>
            </Button>
          </li>
        ))}
      </ul>
      {problem && <Alert tone="danger" title={problem} className="mt-3" />}
    </details>
  );
}
