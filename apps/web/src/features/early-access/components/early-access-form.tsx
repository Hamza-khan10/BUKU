'use client';

import { CalendarCheck, CircleCheck, Store } from 'lucide-react';
import { KINDS_OF_BUSINESS } from '../kinds';
import Link from 'next/link';
import Script from 'next/script';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import type { Option } from '@/features/manage/setup';
import { cn } from '@/lib/cn';
import { BRANCHES, EarlyAccessInput, fieldProblems, PLAN_INTEREST, PLAN_LABEL, type Kind } from '../schema';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The kinds of business people name most; any other can be typed. */
// The kinds the field suggests: features/early-access/kinds.ts (shared with /for-business).

const BRANCH_LABEL: Record<(typeof BRANCHES)[number], string> = {
  '1': 'One',
  '2-5': '2 to 5',
  '6-9': '6 to 9',
  '10-20': '10 to 20',
  '21+': 'More than 20',
};

/** Who's signing up: a business first (that's who BUKU needs first), or someone who books. */
const WHO = [
  { value: 'business', label: 'I run a business', detail: 'Bookings and a walk-in queue', Icon: Store },
  {
    value: 'customer',
    label: 'I book appointments',
    detail: 'Book or queue from your phone',
    Icon: CalendarCheck,
  },
] as const;

/*
 * Shape (globals.css): the form is a 16px panel; every field and choice inside it is 8px; the
 * button is a pill, as everywhere on the site. Groups are set apart by a hairline, not more boxes.
 */
const PANEL = 'rounded-lg bg-surface p-5 shadow-soft ring-1 ring-line sm:p-8';
const GROUP = 'flex min-w-0 flex-col gap-5';
const GROUP_TITLE = 'text-[0.95rem] font-semibold tracking-[-0.01em] text-ink';
const DIVIDED = 'border-t border-line pt-6';
const ROW = 'grid items-start gap-5 sm:grid-cols-2';

export interface Tags {
  source?: string | undefined;
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
}

type Values = Record<string, string>;

/**
 * The early-access form (D-134): a business or someone who books, then only the fields that
 * matter for them. Checked here as the server checks it, problems next to each field; a bot
 * check (Cloudflare Turnstile) when the site has one. Done, it says so plainly, the same whether
 * or not the email was already on the list.
 */
export function EarlyAccessForm({
  siteKey,
  nonce,
  initialKind,
  initialPlan = 'not_sure',
  initialBusiness,
  initialBranches = '1',
  initialCountry,
  countries,
  tags,
}: {
  siteKey: string | null;
  nonce: string | undefined;
  initialKind: Kind;
  /** The plan someone chose on the pricing page, if they came from there. */
  initialPlan?: (typeof PLAN_INTEREST)[number];
  /** The name and kind typed into "See your place on BUKU", already checked by the page. */
  initialBusiness?: { name?: string | undefined; type?: string | undefined };
  /** How many branches, when the pricing page's Enterprise band sent them here. */
  initialBranches?: (typeof BRANCHES)[number] | undefined;
  initialCountry: string;
  /** Countries by name, named on the server (the browser's names can differ: see countryOptions). */
  countries: Option[];
  tags: Tags;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [values, setValues] = useState<Values>({
    country: initialCountry,
    branches: initialBranches,
    planInterest: initialPlan,
    ...(initialBusiness?.name && { businessName: initialBusiness.name }),
    ...(initialBusiness?.type && { businessType: initialBusiness.type }),
  });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string } | null>(null);
  const token = useRef<string | null>(null);
  const widget = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const renderCheck = () => {
    if (!siteKey || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: siteKey,
      action: 'early_access',
      theme: 'auto',
      callback: (t: string) => {
        token.current = t;
      },
      'expired-callback': () => {
        token.current = null;
      },
    });
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProblem(null);
    const raw: Record<string, unknown> = {
      kind,
      email: values.email ?? '',
      city: values.city ?? '',
      country: values.country ?? '',
      consent,
      ...(values.name?.trim() && { name: values.name }),
      ...Object.fromEntries(Object.entries(tags).filter(([, v]) => v)),
    };
    if (kind === 'business') {
      Object.assign(raw, {
        name: values.name ?? '',
        businessName: values.businessName ?? '',
        businessType: values.businessType ?? '',
        branches: values.branches,
        planInterest: values.planInterest,
        ...(values.whatsapp?.trim() && { whatsapp: values.whatsapp }),
      });
    }
    const parsed = EarlyAccessInput.safeParse(raw);
    if (!parsed.success) {
      setErrors(fieldProblems(parsed.error));
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    if (siteKey && !token.current) {
      setProblem('Please complete the check above the button first.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-buku-csrf': '1' },
        body: JSON.stringify({ details: parsed.data, turnstileToken: token.current ?? undefined }),
      });
      if (res.ok) {
        setDone({ email: parsed.data.email });
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; fields?: Record<string, string> };
      } | null;
      if (body?.error?.fields) setErrors(body.error.fields);
      setProblem(body?.error?.message ?? 'That didn’t go through. Please try again.');
      // A token is good for one try: a fresh check for the next.
      token.current = null;
      if (widget.current) window.turnstile?.reset(widget.current);
    } catch {
      setProblem('We couldn’t reach BUKU. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div role="status" className={cn(PANEL, 'flex flex-col items-start gap-4')}>
        <span aria-hidden className="grid size-11 place-items-center rounded-full bg-ok-soft text-ok">
          <CircleCheck className="size-6" />
        </span>
        <h2 className="type-heading">You’re on the list</h2>
        <p className="text-ink-2">
          We’ll email <span className="font-semibold text-ink">{done.email}</span> when BUKU opens
          {values.city?.trim() ? ` in ${values.city.trim()}` : ''}.
          {kind === 'business' && ' We’ll also get in touch to help you set up.'}
        </p>
      </div>
    );

  const field = (
    key: string,
    label: string,
    opts: {
      required?: boolean;
      hint?: ReactNode;
      placeholder?: string;
      type?: string;
      autoComplete?: string;
      maxLength: number;
      list?: string;
      inputMode?: 'email' | 'tel' | 'text';
    },
  ) => (
    <Field label={label} hint={opts.hint} required={opts.required} error={errors[key]}>
      <Input
        name={key}
        value={values[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
        type={opts.type ?? 'text'}
        autoComplete={opts.autoComplete ?? 'off'}
        maxLength={opts.maxLength}
        list={opts.list}
        inputMode={opts.inputMode}
        placeholder={opts.placeholder}
        required={opts.required}
      />
    </Field>
  );

  const country = (
    <Field label="Country" required error={errors.country}>
      <Select name="country" value={values.country} onChange={(e) => set('country', e.target.value)}>
        {countries.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className={cn(PANEL, 'flex flex-col gap-7')}>
      <fieldset className="flex min-w-0 flex-col">
        <legend className={cn(GROUP_TITLE, 'mb-3')}>Who are you?</legend>
        <div className="grid gap-2.5">
          {WHO.map(({ value, label, detail, Icon }) => {
            const chosen = kind === value;
            return (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-sm border px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-200 ease-(--ease-out)',
                  'has-[:focus-visible]:border-focus has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-focus/15',
                  chosen
                    ? 'border-brand bg-brand-soft/45 shadow-[inset_0_0_0_1px_var(--brand)]'
                    : 'border-control bg-surface hover:border-ink-3',
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={chosen}
                  onChange={() => {
                    setKind(value);
                    setErrors({});
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-[6px] transition-colors duration-200',
                    chosen ? 'bg-brand text-on-brand' : 'bg-sunken text-ink-2',
                  )}
                >
                  <Icon className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-ink">{label}</span>
                  <span className="text-[0.8rem] leading-snug text-ink-2">{detail}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'ml-auto grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors duration-200',
                    chosen ? 'border-brand' : 'border-control',
                  )}
                >
                  <span
                    className={cn(
                      'size-2 rounded-full bg-brand transition-transform duration-200 ease-(--ease-out)',
                      chosen ? 'scale-100' : 'scale-0',
                    )}
                  />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {kind === 'business' ? (
        <>
          <section aria-labelledby="ea-business" className={GROUP}>
            <h2 id="ea-business" className={GROUP_TITLE}>
              Your business
            </h2>
            <div className={ROW}>
              {field('name', 'Your name', { required: true, autoComplete: 'name', maxLength: 120 })}
              {field('businessName', 'Business name', {
                required: true,
                autoComplete: 'organization',
                maxLength: 160,
              })}
            </div>
            <div className={ROW}>
              {field('businessType', 'What kind of business', {
                required: true,
                maxLength: 80,
                list: 'early-access-kinds',
                placeholder: 'e.g. Barbershop or clinic',
              })}
              <Field label="Branches" required error={errors.branches}>
                <Select
                  name="branches"
                  value={values.branches}
                  onChange={(e) => set('branches', e.target.value)}
                >
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {BRANCH_LABEL[b]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <datalist id="early-access-kinds">
              {KINDS_OF_BUSINESS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <Field
              label="Which plan would you consider"
              hint="Prices are set at launch. Your answer helps us set them fairly."
              required
              error={errors.planInterest}
            >
              <Select
                name="planInterest"
                value={values.planInterest}
                onChange={(e) => set('planInterest', e.target.value)}
              >
                {PLAN_INTEREST.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          <section aria-labelledby="ea-contact" className={cn(GROUP, DIVIDED)}>
            <h2 id="ea-contact" className={GROUP_TITLE}>
              How to reach you
            </h2>
            <div className={ROW}>
              {field('email', 'Email', {
                required: true,
                type: 'email',
                inputMode: 'email',
                autoComplete: 'email',
                maxLength: 254,
              })}
              {field('whatsapp', 'WhatsApp number', {
                type: 'tel',
                inputMode: 'tel',
                autoComplete: 'tel',
                maxLength: 24,
                placeholder: '+92 300 1234567',
                hint: 'Only to help you set up.',
              })}
            </div>
            <div className={ROW}>
              {field('city', 'City', { required: true, autoComplete: 'address-level2', maxLength: 80 })}
              {country}
            </div>
          </section>
        </>
      ) : (
        <section aria-labelledby="ea-you" className={GROUP}>
          <h2 id="ea-you" className={GROUP_TITLE}>
            About you
          </h2>
          <div className={ROW}>
            {field('name', 'Your name', { autoComplete: 'name', maxLength: 120 })}
            {field('email', 'Email', {
              required: true,
              type: 'email',
              inputMode: 'email',
              autoComplete: 'email',
              maxLength: 254,
            })}
          </div>
          <div className={ROW}>
            {field('city', 'City', { required: true, autoComplete: 'address-level2', maxLength: 80 })}
            {country}
          </div>
        </section>
      )}

      <div className={cn('flex flex-col gap-5', DIVIDED)}>
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink-2">
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? 'consent-error' : undefined}
              className="mt-[0.2rem] size-[1.05rem] shrink-0 cursor-pointer accent-[var(--brand)]"
            />
            <span>
              Email me when BUKU opens
              {kind === 'business' ? ', and contact me to help set up my business' : ''}. I can ask to be
              removed at any time (
              <Link href="/legal/privacy#early-access" className="font-medium text-brand-ink underline">
                privacy
              </Link>
              ).
            </span>
          </label>
          {errors.consent && (
            <p id="consent-error" className="pl-[1.8rem] text-sm font-medium text-danger">
              {errors.consent}
            </p>
          )}
        </div>

        {siteKey && (
          <>
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
              strategy="afterInteractive"
              nonce={nonce}
              onReady={renderCheck}
            />
            <div ref={box} className="min-h-[65px]" />
          </>
        )}

        {problem && (
          <p role="alert" className="text-sm font-medium text-danger">
            {problem}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} block>
          Join the early-access list
        </Button>
      </div>
    </form>
  );
}
