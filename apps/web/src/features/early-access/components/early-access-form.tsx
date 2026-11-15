'use client';

import { ISO_COUNTRY_CODES } from '@buku/validation';
import { CalendarCheck, CircleCheck, Store } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
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
const KINDS_OF_BUSINESS = [
  'Barbershop',
  'Beauty salon',
  'Clinic',
  'Dental clinic',
  'Hospital',
  'Veterinary clinic',
  'Spa',
  'Gym',
  'Laboratory',
  'Bank or office',
];

const BRANCH_LABEL: Record<(typeof BRANCHES)[number], string> = {
  '1': 'One',
  '2-5': '2 to 5',
  '6-20': '6 to 20',
  '21+': 'More than 20',
};

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
  initialCountry,
  tags,
}: {
  siteKey: string | null;
  nonce: string | undefined;
  initialKind: Kind;
  initialCountry: string;
  tags: Tags;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [values, setValues] = useState<Values>({
    country: initialCountry,
    branches: '1',
    planInterest: 'not_sure',
  });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string } | null>(null);
  const token = useRef<string | null>(null);
  const widget = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return [...ISO_COUNTRY_CODES]
      .map((code) => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

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
      <div
        role="status"
        className="flex flex-col items-start gap-4 rounded-3xl bg-surface p-7 shadow-lift ring-1 ring-line sm:p-9"
      >
        <span aria-hidden className="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok">
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
        required={opts.required}
      />
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-5 rounded-3xl bg-surface p-6 shadow-lift ring-1 ring-line sm:p-8"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">Who are you?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'business', label: 'I run a business', Icon: Store },
              { value: 'customer', label: 'I book appointments', Icon: CalendarCheck },
            ] as const
          ).map(({ value, label, Icon }) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-2xl p-4 text-sm font-medium ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                kind === value
                  ? 'bg-brand-soft text-brand-ink ring-brand/40'
                  : 'bg-sunken/60 text-ink ring-line hover:bg-sunken',
              )}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                  setErrors({});
                }}
                className="sr-only"
              />
              <Icon aria-hidden className="size-5" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'business' ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            {field('name', 'Your name', { required: true, autoComplete: 'name', maxLength: 120 })}
            {field('businessName', 'Business name', {
              required: true,
              autoComplete: 'organization',
              maxLength: 160,
            })}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {field('businessType', 'What kind of business', {
              required: true,
              maxLength: 80,
              list: 'early-access-kinds',
              hint: 'Like barbershop, clinic or salon.',
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
        </>
      ) : (
        field('name', 'Your name', { autoComplete: 'name', maxLength: 120 })
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {field('email', 'Email', {
          required: true,
          type: 'email',
          inputMode: 'email',
          autoComplete: 'email',
          maxLength: 254,
        })}
        {kind === 'business' &&
          field('whatsapp', 'WhatsApp number', {
            type: 'tel',
            inputMode: 'tel',
            autoComplete: 'tel',
            maxLength: 24,
            hint: 'With the country code. Only to help you set up.',
          })}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {field('city', 'City', { required: true, autoComplete: 'address-level2', maxLength: 80 })}
        <Field label="Country" required error={errors.country}>
          <Select name="country" value={values.country} onChange={(e) => set('country', e.target.value)}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {kind === 'business' && (
        <Field
          label="Which plan would you consider"
          hint="Prices come with launch; this helps us set them fairly."
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
      )}

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-sm text-ink-2">
          <input
            type="checkbox"
            name="consent"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? 'consent-error' : undefined}
            className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
          />
          <span>
            Email me when BUKU opens{kind === 'business' ? ', and contact me to help set up my business' : ''}
            . I can ask to be removed at any time (
            <Link href="/legal/privacy#early-access" className="font-medium text-brand-ink underline">
              privacy
            </Link>
            ).
          </span>
        </label>
        {errors.consent && (
          <p id="consent-error" className="text-sm font-medium text-danger">
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
      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full sm:w-fit">
        Join the early-access list
      </Button>
    </form>
  );
}
