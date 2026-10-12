'use client';

import { zText } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextarea, CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import {
  createGroup,
  createService,
  menuKey,
  staffKey,
  updateService,
  type ManagedBusiness,
  type ManagedMenu,
  type ManagedService,
  type ManagedStaff,
} from '../api';
import { CLEANUP, DURATIONS, durationLabel, parsePrice } from '../setup';

const NAME = zText({ kind: 'title', min: 1, max: 200 });
const GROUP = zText({ kind: 'title', min: 1, max: 100 });
const DESCRIPTION = zText({ kind: 'text', max: 2000 });
const NEW_GROUP = '__new__';

type Errors = Partial<Record<'name' | 'price' | 'group' | 'description', string>>;

/**
 * Adding or changing one service: what it's called, its group on the menu (optional), how long
 * it takes, clean-up time after it (for free times only, never shown), its price, and who does
 * it. Someone has to do a service for it to be bookable; the form says so rather than refusing.
 */
export function ServiceForm({
  business,
  menu,
  staff,
  service,
  onDone,
  onCancel,
}: {
  business: ManagedBusiness;
  menu: ManagedMenu;
  staff: ManagedStaff[];
  service?: ManagedService;
  onDone: (service: ManagedService) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const active = staff.filter((s) => s.isActive);
  const groups = menu.categories.filter((c): c is typeof c & { id: string } => c.id !== null);
  const [name, setName] = useState(service?.name ?? '');
  const [group, setGroup] = useState(service?.categoryId ?? '');
  const [newGroup, setNewGroup] = useState('');
  const [duration, setDuration] = useState(service?.durationMinutes ?? 30);
  const [cleanup, setCleanup] = useState(service?.bufferMinutes ?? 0);
  const [price, setPrice] = useState(service ? String(Number(service.price)) : '');
  const [description, setDescription] = useState(service?.description ?? '');
  // A new service is done by everyone by default when there's one person; otherwise they choose.
  const [who, setWho] = useState<string[]>(
    service ? service.staffIds : active.length === 1 ? [active[0]!.id] : [],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const durations = DURATIONS.includes(duration as (typeof DURATIONS)[number])
    ? DURATIONS
    : [...DURATIONS, duration].sort((a, b) => a - b);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: Errors = {};
    const n = NAME.safeParse(name);
    if (!name.trim()) found.name = 'Please name the service, like “Haircut”.';
    else if (!n.success) found.name = n.error.issues[0]?.message;
    const amount = parsePrice(price);
    if (amount === null) found.price = `Write the price in ${business.currency}, like 1200.`;
    const g = GROUP.safeParse(newGroup);
    if (group === NEW_GROUP && !newGroup.trim()) found.group = 'Please name the group, like “Beard”.';
    else if (group === NEW_GROUP && !g.success) found.group = g.error.issues[0]?.message;
    const d = DESCRIPTION.safeParse(description);
    if (!d.success) found.description = d.error.issues[0]?.message;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setProblem(undefined);
    setBusy(true);
    try {
      const categoryId = group === NEW_GROUP ? (await createGroup(business.id, g.data!)).id : group || null;
      const input = {
        name: n.data!,
        categoryId,
        durationMinutes: duration,
        bufferMinutes: cleanup,
        price: amount!,
        description: d.data || null,
        staffIds: who,
      };
      const saved = service
        ? await updateService(business.id, service.id, input)
        : await createService(business.id, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: menuKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: staffKey(business.id) }),
      ]);
      onDone(saved);
    } catch (err) {
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'name') : undefined;
      if (issue) setErrors({ name: issue.message });
      else setProblem(problemFrom(err, 'The service couldn’t be saved. Please try again.'));
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
      <h3 className="type-subheading">{service ? `Change ${service.name}` : 'A new service'}</h3>
      <ProblemAlert problem={problem} />
      <Field label="Service" required optionalLabel={false} error={errors.name}>
        <CleanTextInput
          kind="title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Haircut"
          maxLength={200}
        />
      </Field>
      <Field
        label="Group on your menu"
        hint="Like “Hair” or “Beard”. Services without one are listed together."
        error={errors.group}
      >
        <Select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">No group</option>
          {groups.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_GROUP}>A new group…</option>
        </Select>
      </Field>
      {group === NEW_GROUP && (
        <Field label="New group’s name" required optionalLabel={false} error={errors.group}>
          <CleanTextInput
            kind="title"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            maxLength={100}
          />
        </Field>
      )}
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="How long it takes" required optionalLabel={false}>
          <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Clean-up after" required optionalLabel={false}>
          <Select value={cleanup} onChange={(e) => setCleanup(Number(e.target.value))}>
            {CLEANUP.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'None' : durationLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Price (${business.currency})`} required optionalLabel={false} error={errors.price}>
          <Input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="1200"
            maxLength={14}
            className="tabular"
          />
        </Field>
      </div>
      <p className="-mt-2 text-sm text-ink-3">
        Clean-up time keeps the next booking from starting straight away; customers never see it.
      </p>
      <Field label="About it" hint="What’s included, in a sentence." error={errors.description}>
        <CleanTextarea
          kind="text"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </Field>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[0.95rem] font-medium text-ink">Who does it</legend>
        {active.length === 0 ? (
          <p className="text-sm text-ink-3">
            Add the people who do it on the Team page; until then it can’t be booked.
          </p>
        ) : (
          active.map((s) => (
            <Checkbox
              key={s.id}
              label={s.displayName}
              checked={who.includes(s.id)}
              onCheckedChange={(on) =>
                setWho((w) => (on === true ? [...w, s.id] : w.filter((x) => x !== s.id)))
              }
            />
          ))
        )}
        {active.length > 0 && who.length === 0 && (
          <p className="text-sm font-medium text-wait-ink">
            Nobody chosen: it can’t be booked until someone does it.
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          {service ? 'Save changes' : 'Add this service'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
