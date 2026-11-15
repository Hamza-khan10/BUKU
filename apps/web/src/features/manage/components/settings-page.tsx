'use client';

import { zText, type TextKind } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, managedKey, MINE_KEY, type ManagedBusiness } from '../api';
import {
  BOOKING_LIMITS,
  changedSettings,
  profileChanges,
  profileDraft,
  QUEUE_LIMITS,
  reverifies,
  SLOT_STEPS,
  TICKET_PREFIX,
  wholeNumber,
  type BookingSettings,
  type ProfileDraft,
  type QueueSettings,
} from '../settings';
import {
  bookingSettingsKey,
  fetchBookingSettings,
  fetchQueueSettings,
  queueSettingsKey,
  saveBookingSettings,
  saveQueueSettings,
  updateProfile,
} from '../settings-api';
import { cleanPhone, coordinatesLabel, E164, mapsLink, parseCoordinates, roundCoordinates } from '../setup';

/** What went wrong, in the API's words when it said. */
const problem = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t save. Please try again.';

/** A text field checked as the API will check it (clean text, length). */
function checkText(kind: TextKind, value: string, min: number, max: number): string | null {
  const parsed = zText({ kind, min, max }).safeParse(value);
  if (parsed.success) return null;
  if (value.trim().length < min) return min <= 1 ? 'This is needed.' : `At least ${min} characters, please.`;
  return parsed.error.issues[0]?.message ?? `At most ${max} characters, please.`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /business/[id]/settings (3.5l): the business's profile, how bookings work and how the queue
 * works, for the owner and managers. Each part saves on its own and sends only what changed;
 * a change BUKU checked when it verified the business is announced before it's saved.
 */
export function SettingsPage({ id }: { id: string }) {
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  if (business.isError) {
    const e = business.error instanceof ApiError ? business.error : null;
    return (
      <ErrorState
        title="We couldn’t load the settings"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }
  if (!business.data) return <Skeleton className="h-96 max-w-3xl" />;
  if (!can(business.data.myRole, 'business.update'))
    return (
      <EmptyState title="Settings are for the owner and managers">
        Ask them to change how the business works on BUKU.
      </EmptyState>
    );
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeading
        compact
        eyebrow={business.data.name}
        title="Settings"
        description="The business’s details, how bookings work and how the queue works. Each part saves on its own."
      />
      {/* Keyed by when it last changed, so a save elsewhere refills the form. */}
      <ProfileForm key={business.data.updatedAt} business={business.data} />
      <BookingForm id={id} />
      <QueueForm id={id} />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `settings-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <h2 id={headingId} className="text-base font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Focus the first field with a problem, so people land on what to fix. */
const focusFirstProblem = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

// ── The profile ──────────────────────────────────────────────────────────────

type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;

function ProfileForm({ business }: { business: ManagedBusiness }) {
  const queryClient = useQueryClient();
  const start = profileDraft(business);
  const [draft, setDraft] = useState<ProfileDraft>(start);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [pasted, setPasted] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setConfirming(false);
  };

  const check = (d: ProfileDraft): ProfileErrors => {
    const found: ProfileErrors = {};
    const text = (key: keyof ProfileDraft, kind: TextKind, min: number, max: number, optional = false) => {
      const value = d[key] as string;
      if (optional && !value.trim()) return;
      const p = checkText(kind, value, min, max);
      if (p) found[key] = p;
    };
    text('name', 'title', 2, 200);
    text('description', 'text', 0, 2000, true);
    text('address', 'line', 3, 500);
    text('city', 'title', 1, 100);
    text('state', 'title', 0, 100, true);
    text('postalCode', 'title', 0, 20, true);
    if (d.phone.trim() && !E164.test(cleanPhone(d.phone)))
      found.phone = 'A phone number with its country code, like +92 42 3555 0000.';
    if (d.email.trim() && !EMAIL.test(d.email.trim()))
      found.email = 'That doesn’t look like an email address.';
    if (d.website.trim() && !/^https:\/\/\S+\.\S+/.test(d.website.trim()))
      found.website = 'A full address starting with https://';
    return found;
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const clean = { ...draft, phone: draft.phone.trim() ? cleanPhone(draft.phone) : '' };
    const found = check(clean);
    const { change, cleared } = profileChanges(start, clean);
    for (const key of cleared)
      found[key] ??= 'This can’t be emptied here yet. Change it instead, or ask BUKU to remove it.';
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstProblem();
    if (Object.keys(change).length === 0) {
      toast.message('Nothing has changed.');
      return;
    }
    if (reverifies(change, business.status) && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const saved = await updateProfile(business.id, change);
      queryClient.setQueryData(managedKey(business.id), saved);
      await queryClient.invalidateQueries({ queryKey: MINE_KEY });
      setConfirming(false);
      toast.success(
        saved.status === 'pending' && business.status !== 'pending'
          ? 'Saved. BUKU will check the changes.'
          : 'Saved.',
      );
    } catch (err) {
      setFailure(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const here = () => {
    if (!('geolocation' in navigator)) {
      setErrors((x) => ({
        ...x,
        place: 'This browser can’t share its location. Paste it from a map instead.',
      }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set('place', roundCoordinates(pos.coords.latitude, pos.coords.longitude));
        setErrors((x) => ({ ...x, place: undefined }));
      },
      () =>
        setErrors((x) => ({
          ...x,
          place: 'The location wasn’t shared. Paste it from a map instead, like 31.5204, 74.3587.',
        })),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const paste = (text: string) => {
    setPasted(text);
    const place = parseCoordinates(text);
    if (place) {
      set('place', place);
      setErrors((x) => ({ ...x, place: undefined }));
    } else if (text.trim()) {
      setErrors((x) => ({
        ...x,
        place: 'Those numbers aren’t a place. Copy them from a map, like 31.5204, 74.3587.',
      }));
    }
  };

  const textField = (
    key: Exclude<keyof ProfileDraft, 'place'>,
    label: string,
    props: { required?: boolean; hint?: string; type?: string; autoComplete?: string; maxLength: number },
  ) => (
    <Field label={label} hint={props.hint} required={props.required} error={errors[key]}>
      <Input
        name={key}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete ?? 'off'}
        maxLength={props.maxLength}
        required={props.required}
      />
    </Field>
  );

  return (
    <Section title="The business" description="What customers see on your page.">
      <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
        {textField('name', 'Name', { required: true, maxLength: 200 })}
        <Field label="About" hint="A few words customers read on your page." error={errors.description}>
          <Textarea
            name="description"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={2000}
            rows={4}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          {textField('phone', 'Phone', { type: 'tel', autoComplete: 'tel', maxLength: 30 })}
          {textField('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 254 })}
        </div>
        {textField('website', 'Website', { type: 'url', hint: 'Starting with https://', maxLength: 500 })}
        {textField('address', 'Address', { required: true, autoComplete: 'street-address', maxLength: 500 })}
        <div className="grid gap-5 sm:grid-cols-3">
          {textField('city', 'City', { required: true, autoComplete: 'address-level2', maxLength: 100 })}
          {textField('state', 'Province or state', { autoComplete: 'address-level1', maxLength: 100 })}
          {textField('postalCode', 'Postal code', { autoComplete: 'postal-code', maxLength: 20 })}
        </div>
        <Field
          label="Where it is on the map"
          hint={
            draft.place ? (
              <>
                Now at{' '}
                <a
                  href={mapsLink(draft.place)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-ink underline"
                >
                  {coordinatesLabel(draft.place)}
                </a>
                . To move it, use your location here, or paste it from a map.
              </>
            ) : (
              'Use your location here, or paste it from a map.'
            )
          }
          error={errors.place}
        >
          <Input
            name="place"
            value={pasted}
            onChange={(e) => paste(e.target.value)}
            placeholder="31.5204, 74.3587"
            inputMode="decimal"
            autoComplete="off"
          />
        </Field>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={here}>
          <LocateFixed aria-hidden className="size-4" />
          Use my location
        </Button>

        {confirming && (
          <Alert tone="wait" title="BUKU will check this again">
            The name, address and place are what BUKU checked when it verified {business.name}. Saving sends
            the business back for review; customers can still find and book you meanwhile. Press Save again to
            go ahead.
          </Alert>
        )}
        {failure && (
          <p role="alert" className="text-sm font-medium text-danger">
            {failure}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-fit" loading={busy}>
          {confirming ? 'Save, and have BUKU check it' : 'Save'}
        </Button>
      </form>
    </Section>
  );
}

// ── How bookings work ────────────────────────────────────────────────────────

type BookingNumbers = Record<keyof typeof BOOKING_LIMITS, string>;

const BOOKING_FIELDS: {
  key: Exclude<keyof typeof BOOKING_LIMITS, 'approvalBelowShowUpPercent'>;
  label: string;
  hint: string;
  unit: string;
}[] = [
  {
    key: 'bookingHorizonDays',
    label: 'How far ahead customers can book',
    hint: 'Up to 1,825 days (5 years).',
    unit: 'days',
  },
  {
    key: 'minNoticeMinutes',
    label: 'Shortest notice for a booking',
    hint: '0 lets people book right up to the start.',
    unit: 'minutes',
  },
  {
    key: 'cancellationWindowHours',
    label: 'Free cancellation until',
    hint: 'Cancelling later than this counts as late.',
    unit: 'hours before',
  },
  {
    key: 'maxFutureBookingsPerCustomer',
    label: 'Upcoming bookings per customer',
    hint: 'From 1 to 20.',
    unit: 'bookings',
  },
  {
    key: 'noShowGraceMinutes',
    label: 'Wait before marking a no-show',
    hint: 'After the start time.',
    unit: 'minutes',
  },
];

function BookingForm({ id }: { id: string }) {
  const settings = useQuery({ queryKey: bookingSettingsKey(id), queryFn: () => fetchBookingSettings(id) });
  return (
    <Section
      title="Bookings"
      description="How customers book you, cancel, and when a visit counts as missed."
    >
      {settings.isError ? (
        <p role="alert" className="text-sm text-danger">
          {problem(settings.error)}
        </p>
      ) : !settings.data ? (
        <Skeleton className="h-64" />
      ) : (
        <BookingFields key={JSON.stringify(settings.data)} id={id} saved={settings.data} />
      )}
    </Section>
  );
}

function BookingFields({ id, saved }: { id: string; saved: BookingSettings }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(saved.confirmationMode);
  const [step, setStep] = useState<BookingSettings['slotStepMinutes']>(saved.slotStepMinutes);
  const [screen, setScreen] = useState(saved.approvalBelowShowUpPercent !== null);
  const [numbers, setNumbers] = useState<BookingNumbers>({
    bookingHorizonDays: String(saved.bookingHorizonDays),
    maxFutureBookingsPerCustomer: String(saved.maxFutureBookingsPerCustomer),
    cancellationWindowHours: String(saved.cancellationWindowHours),
    minNoticeMinutes: String(saved.minNoticeMinutes),
    noShowGraceMinutes: String(saved.noShowGraceMinutes),
    approvalBelowShowUpPercent: String(saved.approvalBelowShowUpPercent ?? 80),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BookingNumbers, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const found: Partial<Record<keyof BookingNumbers, string>> = {};
    const value = (key: keyof BookingNumbers): number => {
      const r = wholeNumber(numbers[key], BOOKING_LIMITS[key]);
      if (r.ok) return r.value;
      found[key] = r.message;
      return NaN;
    };
    const next: BookingSettings = {
      confirmationMode: mode,
      slotStepMinutes: step,
      bookingHorizonDays: value('bookingHorizonDays'),
      maxFutureBookingsPerCustomer: value('maxFutureBookingsPerCustomer'),
      cancellationWindowHours: value('cancellationWindowHours'),
      minNoticeMinutes: value('minNoticeMinutes'),
      noShowGraceMinutes: value('noShowGraceMinutes'),
      approvalBelowShowUpPercent: screen && mode === 'automatic' ? value('approvalBelowShowUpPercent') : null,
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstProblem();
    const change = changedSettings(saved, next);
    if (Object.keys(change).length === 0) {
      toast.message('Nothing has changed.');
      return;
    }
    setBusy(true);
    try {
      queryClient.setQueryData(bookingSettingsKey(id), await saveBookingSettings(id, change));
      toast.success('Booking settings saved.');
    } catch (err) {
      setFailure(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const numberField = (key: keyof BookingNumbers, label: string, hint: string, unit: string) => (
    <Field key={key} label={label} hint={hint} required error={errors[key]}>
      <span className="flex items-center gap-2">
        <Input
          name={key}
          value={numbers[key]}
          onChange={(e) => setNumbers((n) => ({ ...n, [key]: e.target.value }))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          className="w-28"
          required
        />
        <span className="text-sm text-ink-2">{unit}</span>
      </span>
    </Field>
  );

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">Confirming bookings</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === 'automatic'}
            onChange={() => setMode('automatic')}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span>
            <span className="font-medium text-ink">Automatically</span>
            <span className="block text-ink-3">A booking is confirmed as soon as it’s made.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === 'manual'}
            onChange={() => setMode('manual')}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span>
            <span className="font-medium text-ink">I approve each one</span>
            <span className="block text-ink-3">Customers wait for your yes. Some plans include this.</span>
          </span>
        </label>
      </fieldset>
      {mode === 'automatic' && (
        <div className="flex flex-col gap-3 rounded-md bg-sunken p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={screen}
              onChange={(e) => setScreen(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span>
              <span className="font-medium text-ink">Approve customers who often don’t come</span>
              <span className="block text-ink-3">
                Their bookings wait for your yes; everyone else’s are confirmed. New customers are never held
                back.
              </span>
            </span>
          </label>
          {screen &&
            numberField(
              'approvalBelowShowUpPercent',
              'When they show up less than',
              'From 50% to 99% of their visits.',
              '%',
            )}
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {BOOKING_FIELDS.map((f) => numberField(f.key, f.label, f.hint, f.unit))}
        <Field label="Start times every" hint="How the free times are spaced." required>
          <Select
            name="slotStepMinutes"
            value={step}
            onChange={(e) => setStep(Number(e.target.value) as BookingSettings['slotStepMinutes'])}
            className="w-36"
          >
            {SLOT_STEPS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-fit" loading={busy}>
        Save booking settings
      </Button>
    </form>
  );
}

// ── How the queue works ──────────────────────────────────────────────────────

type QueueDraft = {
  remoteJoinRadiusMeters: string;
  maxQueueSize: string;
  gracePeriodSeconds: string;
  avgServiceMinutes: string;
  ticketPrefix: string;
};

function QueueForm({ id }: { id: string }) {
  const settings = useQuery({ queryKey: queueSettingsKey(id), queryFn: () => fetchQueueSettings(id) });
  return (
    <Section
      title="Queue"
      description="Who can join from their phone, how many can wait, and the tickets. Size, call time, estimate and ticket letters apply from the next day’s queue."
    >
      {settings.isError ? (
        <p role="alert" className="text-sm text-danger">
          {problem(settings.error)}
        </p>
      ) : !settings.data ? (
        <Skeleton className="h-48" />
      ) : (
        <QueueFields key={JSON.stringify(settings.data)} id={id} saved={settings.data} />
      )}
    </Section>
  );
}

function QueueFields({ id, saved }: { id: string; saved: QueueSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<QueueDraft>({
    remoteJoinRadiusMeters: String(saved.remoteJoinRadiusMeters),
    maxQueueSize: String(saved.maxQueueSize),
    gracePeriodSeconds: String(saved.gracePeriodSeconds),
    avgServiceMinutes: String(Math.max(1, Math.round(saved.avgServiceSeconds / 60))),
    ticketPrefix: saved.ticketPrefix,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof QueueDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const found: Partial<Record<keyof QueueDraft, string>> = {};
    const num = (key: keyof QueueDraft, range: { min: number; max: number }) => {
      const r = wholeNumber(draft[key], range);
      if (r.ok) return r.value;
      found[key] = r.message;
      return NaN;
    };
    const minutes = num('avgServiceMinutes', { min: 1, max: QUEUE_LIMITS.avgServiceSeconds.max / 60 });
    const prefix = draft.ticketPrefix.trim();
    if (!TICKET_PREFIX.test(prefix)) found.ticketPrefix = '1 to 3 letters, like A or VIP.';
    const next: QueueSettings = {
      remoteJoinRadiusMeters: num('remoteJoinRadiusMeters', QUEUE_LIMITS.remoteJoinRadiusMeters),
      maxQueueSize: num('maxQueueSize', QUEUE_LIMITS.maxQueueSize),
      gracePeriodSeconds: num('gracePeriodSeconds', QUEUE_LIMITS.gracePeriodSeconds),
      // Unchanged minutes keep the exact seconds saved before.
      avgServiceSeconds:
        minutes === Math.max(1, Math.round(saved.avgServiceSeconds / 60))
          ? saved.avgServiceSeconds
          : minutes * 60,
      ticketPrefix: prefix.toUpperCase(),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstProblem();
    const change = changedSettings(saved, next);
    if (Object.keys(change).length === 0) {
      toast.message('Nothing has changed.');
      return;
    }
    setBusy(true);
    try {
      queryClient.setQueryData(queueSettingsKey(id), await saveQueueSettings(id, change));
      toast.success('Queue settings saved.');
    } catch (err) {
      setFailure(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof QueueDraft, label: string, hint: string, unit: string, width = 'w-28') => (
    <Field label={label} hint={hint} required error={errors[key]}>
      <span className="flex items-center gap-2">
        <Input
          name={key}
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          inputMode={key === 'ticketPrefix' ? 'text' : 'numeric'}
          autoComplete="off"
          maxLength={key === 'ticketPrefix' ? 3 : 7}
          className={width}
          required
        />
        {unit && <span className="text-sm text-ink-2">{unit}</span>}
      </span>
    </Field>
  );

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {field('remoteJoinRadiusMeters', 'Join from up to', 'From 100 m to 100 km away.', 'metres')}
        {field('maxQueueSize', 'Most people waiting', 'Once reached, no one more can join.', 'people')}
        {field(
          'gracePeriodSeconds',
          'Time to come up when called',
          'Before they can be marked not here.',
          'seconds',
        )}
        {field(
          'avgServiceMinutes',
          'Starting estimate per person',
          'Until today’s own pace is known.',
          'minutes',
        )}
        {field(
          'ticketPrefix',
          'Ticket letters',
          'Tickets read like A-12. 1 to 3 letters.',
          '',
          'w-20 uppercase',
        )}
      </div>
      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-fit" loading={busy}>
        Save queue settings
      </Button>
    </form>
  );
}
