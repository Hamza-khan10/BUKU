'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ErrorState } from '@/components/ui/states';
import { ME_KEY, fetchMe, type Me } from '@/features/auth/api';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { choiceCard, Step } from '@/features/booking/components/step';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import {
  canSetUp,
  createService,
  createStaff,
  fetchManaged,
  fetchMenu,
  fetchStaff,
  managedKey,
  menuKey,
  setStaffHours,
  staffKey,
  updateStaff,
  type ManagedBusiness,
  type ManagedMenu,
  type ManagedStaff,
} from '../api';
import { dayLabel, DURATIONS, durationLabel, parsePrice, WEEK, weekFromApi, weekToStaffDays } from '../setup';
import { BusinessPictures } from './business-pictures';
import { OpeningHoursForm } from './opening-hours-form';
import { PeopleSection } from './people';
import { ServiceForm } from './service-form';

/**
 * The rest of setting up, right after registering (3.5a): opening hours, then the first service
 * and who does it (the owner, or someone named), working the same hours. Each step is saved as
 * it's done, so leaving half-way loses nothing: the business's page brings people back here.
 */
export function SetupFlow({ id }: { id: string }) {
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const ready = business.isSuccess && canSetUp(business.data.myRole);
  const menu = useQuery({ queryKey: menuKey(id), queryFn: () => fetchMenu(id), enabled: ready });
  const staff = useQuery({ queryKey: staffKey(id), queryFn: () => fetchStaff(id), enabled: ready });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const [editingHours, setEditingHours] = useState(false);

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
  if (business.isPending || (ready && (menu.isPending || staff.isPending)) || me.isPending) {
    return <Skeleton className="h-96 max-w-2xl" />;
  }
  const b = business.data;
  if (!canSetUp(b.myRole)) {
    return (
      <p className="max-w-xl text-ink-2">
        Only the owner or a manager can set up {b.name}.{' '}
        <Link
          href={`/business/${b.id}` as Route}
          className="font-medium text-brand-ink underline underline-offset-4"
        >
          Back to {b.name}
        </Link>
      </p>
    );
  }
  if (menu.isError || staff.isError || me.isError) {
    return (
      <ErrorState title="Part of this page didn’t load" message="Please refresh the page to try again." />
    );
  }

  const services = menu.data!.categories.flatMap((c) => c.services);
  const hoursSet = b.hours.length > 0;
  const hasService = services.length > 0;
  const week = weekFromApi(b.hours);

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <Step
        number={1}
        title="Opening hours"
        done={hoursSet && !editingHours}
        onChange={() => setEditingHours(true)}
        summary={
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {WEEK.map(({ day, short }) => (
              <li key={day} className="flex gap-3">
                <span className="w-10 font-medium text-ink">{short}</span>
                <span className="tabular">{dayLabel(week[day])}</span>
              </li>
            ))}
          </ul>
        }
      >
        <OpeningHoursForm business={b} onSaved={() => setEditingHours(false)} />
      </Step>

      <Step number={2} title={hasService ? 'Your services' : 'Your first service'}>
        {!hoursSet ? (
          <p className="text-ink-3">Your opening hours first: services are booked inside them.</p>
        ) : !hasService ? (
          <FirstServiceForm business={b} me={me.data} staff={staff.data!} />
        ) : (
          <MoreServices business={b} menu={menu.data!} staff={staff.data!} />
        )}
      </Step>

      {hasService && (
        <Step number={3} title="Your team">
          <p className="-mt-1 text-ink-2">
            Optional: anyone else customers can book, with what they do and when they work. Logins for them
            are on the Team page.
          </p>
          <PeopleSection business={b} />
        </Step>
      )}

      <Step number={hasService ? 4 : 3} title="Your logo and photos">
        <p className="-mt-1 text-ink-2">
          Optional, and worth it: a page with the business’s own pictures is the one people choose.
        </p>
        <BusinessPictures business={b} />
      </Step>

      {hoursSet && hasService && (
        <section
          aria-labelledby="live"
          className="flex flex-col gap-4 rounded-2xl bg-brand-soft p-6 animate-rise sm:p-8"
        >
          <h2 id="live" className="type-heading">
            Your page is live
          </h2>
          <p className="text-ink-2">
            People can find {b.name} and book {services[0]?.name.toLowerCase()} in the free times you’ve set.
            It shows “Not verified” until BUKU has checked your registration details and a document.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="primary">
              <Link href={`/b/${b.slug}` as Route}>See your page</Link>
            </Button>
            <Button asChild>
              <Link href={`/business/${b.id}` as Route}>Go to {b.name}</Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function MoreServices({
  business,
  menu,
  staff,
}: {
  business: ManagedBusiness;
  menu: ManagedMenu;
  staff: ManagedStaff[];
}) {
  const [adding, setAdding] = useState(false);
  const services = menu.categories.flatMap((c) => c.services).filter((s) => s.isActive);
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
        {services.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <span className="font-medium text-ink">{s.name}</span>
            <span className="tabular text-sm text-ink-3">
              {durationLabel(s.durationMinutes)} · {money(s.price, business.currency)}
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <ServiceForm
          business={business}
          menu={menu}
          staff={staff}
          onDone={(s) => {
            setAdding(false);
            toast.success(`${s.name} is on your menu.`);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add another service
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/business/${business.id}/services` as Route}>Groups, changes and more</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

const SERVICE_NAME = zText({ kind: 'title', min: 2, max: 200 });
const PERSON_NAME = zText({ kind: 'personName', min: 2, max: 100 });

function FirstServiceForm({
  business,
  me,
  staff,
}: {
  business: ManagedBusiness;
  me: Me;
  staff: ManagedStaff[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState('');
  const [who, setWho] = useState<'me' | 'someone'>('me');
  const [other, setOther] = useState('');
  const [errors, setErrors] = useState<{ name?: string; price?: string; other?: string }>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  // Saved parts survive a failed step, so trying again never adds the service twice.
  const madeService = useRef<string | null>(null);
  const mine = staff.find((s) => s.userId === me.id && s.isActive !== false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: typeof errors = {};
    const n = SERVICE_NAME.safeParse(name);
    if (!name.trim()) found.name = 'Please name the service, like “Haircut”.';
    else if (!n.success) found.name = n.error.issues[0]?.message;
    const amount = parsePrice(price);
    if (amount === null) found.price = `Write the price in ${business.currency}, like 1200.`;
    const person = PERSON_NAME.safeParse(other);
    if (who === 'someone' && !other.trim()) found.other = 'Please write their name.';
    else if (who === 'someone' && !person.success) found.other = person.error.issues[0]?.message;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setProblem(undefined);
    setBusy(true);
    try {
      madeService.current ??= (
        await createService(business.id, {
          name: n.data!,
          durationMinutes: duration,
          price: amount!,
        })
      ).id;
      const serviceId = madeService.current;
      let staffId: string;
      if (who === 'me' && mine) {
        await updateStaff(business.id, mine.id, {
          serviceIds: [...new Set([...mine.serviceIds, serviceId])],
        });
        staffId = mine.id;
      } else {
        staffId = (
          await createStaff(business.id, {
            displayName: who === 'me' ? me.name : person.data!,
            ...(who === 'me' && { userId: me.id }),
            serviceIds: [serviceId],
          })
        ).id;
      }
      // They work when the business is open.
      await setStaffHours(business.id, staffId, weekToStaffDays(weekFromApi(business.hours)));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: menuKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: staffKey(business.id) }),
      ]);
    } catch (err) {
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'name') : undefined;
      if (issue) setErrors({ name: issue.message });
      else setProblem(problemFrom(err, 'The service couldn’t be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
      <p className="text-ink-2">What people book first. It’s paid at your business.</p>
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
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How long it takes" required optionalLabel={false}>
          <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[0.95rem] font-medium text-ink">Who does it</legend>
        {(
          [
            { value: 'me', title: `Me, ${me.name}`, text: 'Customers see your name on their booking.' },
            {
              value: 'someone',
              title: 'Someone on my team',
              text: 'Customers see their name on the booking.',
            },
          ] as const
        ).map((o) => (
          <label
            key={o.value}
            className={cn(choiceCard, 'cursor-pointer has-checked:border-brand has-checked:bg-brand-soft')}
          >
            <input
              type="radio"
              name="who"
              value={o.value}
              checked={who === o.value}
              onChange={() => setWho(o.value)}
              className="mt-1 size-4 accent-(--brand)"
            />
            <span className="flex flex-col">
              <span className="font-medium text-ink">{o.title}</span>
              <span className="text-sm text-ink-3">{o.text}</span>
            </span>
          </label>
        ))}
        {who === 'someone' && (
          <Field label="Their name" required optionalLabel={false} error={errors.other} className="mt-2">
            <CleanTextInput
              kind="personName"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              maxLength={100}
            />
          </Field>
        )}
        <p className="text-sm text-ink-3">They work your opening hours.</p>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Add this service
        </Button>
      </div>
    </form>
  );
}
