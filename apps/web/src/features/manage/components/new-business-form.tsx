'use client';

import { ISO_COUNTRY_CODES, zText, type TextKind } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import { LocateFixed, MapPin } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextarea, CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { Step } from '@/features/booking/components/step';
import type { CategoryNode } from '@/features/search/types';
import { zoneOptions } from '@/features/settings/zones';
import { ApiError } from '@/lib/api/errors';
import { BUSINESS_TERMS_VERSION } from '@/lib/legal-versions';
import { createBusiness, MINE_KEY, type NewBusiness } from '../api';
import {
  cleanPhone,
  coordinatesLabel,
  currencyFor,
  E164,
  mapsLink,
  parseCoordinates,
  roundCoordinates,
} from '../setup';

type Place = { lat: number; lng: number };

interface Draft {
  name: string;
  categoryId: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  place: Place | null;
  pasted: string;
  timezone: string;
  currency: string;
  terms: boolean;
}

type Errors = Partial<Record<keyof Draft | 'location', string>>;

const deviceZone = () => () => undefined;
const useDeviceZone = () =>
  useSyncExternalStore(
    deviceZone,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );

/** A text field's rule, the same as the API's (title, line, text). */
function checkText(kind: TextKind, value: string, min: number, max: number) {
  const parsed = zText({ kind, min, max }).safeParse(value);
  return parsed.success
    ? { ok: true as const, value: parsed.data }
    : { ok: false as const, message: parsed.error.issues[0]?.message };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The API's field names → this form's (the API calls the place lat/lng). */
const API_FIELD: Record<string, keyof Draft | 'location'> = {
  lat: 'location',
  lng: 'location',
  acceptedBusinessTermsVersion: 'terms',
};

/**
 * Registering a business (3.5a): what it is, where it is, and agreeing to the business terms.
 * The page goes live at once, marked "Not verified" until BUKU has checked its documents
 * (D-032). Where it is comes from this phone's location (asked only when pressed) or from
 * coordinates pasted from a map: there is no map on this site, and no address is sent to
 * anyone to look up.
 */
export function NewBusinessForm({ categories }: { categories: CategoryNode[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const device = useDeviceZone();
  // One key per form: sending twice (a double tap, a retry after a lost answer) registers once.
  const key = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState<Draft>({
    name: '',
    categoryId: '',
    description: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'PK',
    place: null,
    pasted: '',
    timezone: '',
    currency: 'PKR',
    terms: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const timezone = draft.timezone || device || 'Asia/Karachi';

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return [...ISO_COUNTRY_CODES]
      .map((code) => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);
  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames(['en'], { type: 'currency' });
    return Intl.supportedValuesOf('currency').map((code) => ({ code, name: names.of(code) ?? code }));
  }, []);
  const zones = useMemo(() => zoneOptions(timezone, new Date()), [timezone]);

  const chooseCountry = (country: string) =>
    setDraft((d) => ({ ...d, country, currency: currencyFor(country) ?? d.currency }));

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setErrors((e) => ({
        ...e,
        location: 'This browser can’t share its location. Paste it from a map instead.',
      }));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set('place', roundCoordinates(pos.coords.latitude, pos.coords.longitude));
        setErrors((e) => ({ ...e, location: undefined }));
      },
      (err) => {
        setLocating(false);
        setErrors((e) => ({
          ...e,
          location:
            err.code === err.PERMISSION_DENIED
              ? 'Location is turned off for BUKU. Allow it in your browser’s site settings, or paste it from a map.'
              : 'We couldn’t find where you are. Try again, or paste it from a map.',
        }));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const paste = (text: string) => {
    set('pasted', text);
    const place = parseCoordinates(text);
    if (place) {
      set('place', place);
      setErrors((e) => ({ ...e, location: undefined }));
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProblem(undefined);
    const found: Errors = {};
    const name = checkText('title', draft.name, 2, 200);
    if (!draft.name.trim()) found.name = 'Please enter the business’s name.';
    else if (!name.ok) found.name = name.message;
    if (!draft.categoryId) found.categoryId = 'Please choose what kind of business it is.';
    const description = checkText('text', draft.description, 0, 2000);
    if (!description.ok) found.description = description.message;
    const phone = cleanPhone(draft.phone);
    if (phone && !E164.test(phone)) found.phone = 'Write it with the country code, like +92 300 1234567.';
    if (draft.email.trim() && !EMAIL.test(draft.email.trim()))
      found.email = 'That doesn’t look like an email address.';
    if (draft.website.trim() && !/^https:\/\/[^\s]+\.[^\s]+$/.test(draft.website.trim())) {
      found.website = 'Write the full address, starting with https://';
    }
    const address = checkText('line', draft.address, 3, 500);
    if (!draft.address.trim()) found.address = 'Please enter the street address.';
    else if (!address.ok) found.address = address.message;
    const city = checkText('title', draft.city, 1, 100);
    if (!draft.city.trim()) found.city = 'Please enter the city.';
    else if (!city.ok) found.city = city.message;
    const state = checkText('title', draft.state, 0, 100);
    if (!state.ok) found.state = state.message;
    const postal = checkText('title', draft.postalCode, 0, 20);
    if (!postal.ok) found.postalCode = postal.message;
    if (!draft.place) {
      found.location = draft.pasted.trim()
        ? 'Those numbers aren’t a place. Copy them from a map, like 31.5204, 74.3587.'
        : 'Set where the business is: use your location, or paste it from a map.';
    }
    if (!draft.terms) found.terms = 'Please agree to the business terms to put your business on BUKU.';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Take people to the first thing to fix.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }

    const input: NewBusiness = {
      name: name.ok ? name.value : draft.name,
      categoryId: draft.categoryId,
      ...(description.ok && description.value && { description: description.value }),
      ...(phone && { phone }),
      ...(draft.email.trim() && { email: draft.email.trim() }),
      ...(draft.website.trim() && { website: draft.website.trim() }),
      address: address.ok ? address.value : draft.address,
      city: city.ok ? city.value : draft.city,
      ...(state.ok && state.value && { state: state.value }),
      ...(postal.ok && postal.value && { postalCode: postal.value }),
      country: draft.country,
      lat: draft.place!.lat,
      lng: draft.place!.lng,
      timezone,
      currency: draft.currency,
      acceptedBusinessTermsVersion: BUSINESS_TERMS_VERSION,
    };
    setBusy(true);
    try {
      const created = await createBusiness(input, key.current);
      await queryClient.invalidateQueries({ queryKey: MINE_KEY });
      router.push(`/business/${created.id}/setup` as Route);
    } catch (err) {
      const issues = err instanceof ApiError ? err.fieldIssues : [];
      const mapped: Errors = {};
      for (const issue of issues) {
        const field = API_FIELD[issue.path] ?? (issue.path as keyof Draft);
        if (field in draft || field === 'location') mapped[field] ??= issue.message;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else
        setProblem(
          problemFrom(
            err,
            err instanceof ApiError && err.code === 'PLAN_LIMIT_REACHED'
              ? 'You’ve added as many businesses as an account can have.'
              : 'Your business couldn’t be added. Please try again.',
          ),
        );
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-10">
      <ProblemAlert problem={problem} />

      <Step number={1} title="About the business">
        <div className="flex flex-col gap-5">
          <Field label="Business name" required optionalLabel={false} error={errors.name}>
            <CleanTextInput
              kind="title"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={200}
              autoComplete="organization"
            />
          </Field>
          <Field
            label="What kind of business"
            required
            optionalLabel={false}
            hint="People find you under it. Health businesses are asked for a licence before they’re verified."
            error={errors.categoryId}
          >
            <Select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose one</option>
              {categories.map((group) =>
                group.children.length > 0 ? (
                  <optgroup key={group.slug} label={group.name}>
                    {group.children.map((c) => (
                      <option key={c.slug} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={group.slug} value={group.id}>
                    {group.name}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field
            label="About it"
            hint="A sentence or two people read on your page: what you do, what you’re known for."
            error={errors.description}
          >
            <CleanTextarea
              kind="text"
              rows={3}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone" hint="With the country code: +92 300 1234567." error={errors.phone}>
              <Input
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                autoComplete="tel"
                maxLength={24}
              />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
                autoComplete="email"
                maxLength={254}
              />
            </Field>
          </div>
          <Field label="Website" hint="The full address, starting with https://" error={errors.website}>
            <Input
              type="url"
              inputMode="url"
              value={draft.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://"
              maxLength={500}
            />
          </Field>
        </div>
      </Step>

      <Step number={2} title="Where it is">
        <div className="flex flex-col gap-5">
          <Field label="Street address" required optionalLabel={false} error={errors.address}>
            <CleanTextInput
              kind="line"
              value={draft.address}
              onChange={(e) => set('address', e.target.value)}
              autoComplete="street-address"
              maxLength={500}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="City" required optionalLabel={false} error={errors.city}>
              <CleanTextInput
                kind="title"
                value={draft.city}
                onChange={(e) => set('city', e.target.value)}
                autoComplete="address-level2"
                maxLength={100}
              />
            </Field>
            <Field label="Province or state" error={errors.state}>
              <CleanTextInput
                kind="title"
                value={draft.state}
                onChange={(e) => set('state', e.target.value)}
                autoComplete="address-level1"
                maxLength={100}
              />
            </Field>
            <Field label="Postal code" error={errors.postalCode}>
              <CleanTextInput
                kind="title"
                value={draft.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
                autoComplete="postal-code"
                maxLength={20}
              />
            </Field>
            <Field label="Country" required optionalLabel={false}>
              <Select
                value={draft.country}
                onChange={(e) => chooseCountry(e.target.value)}
                autoComplete="country"
              >
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* The exact spot: used for "near me" and for how far away someone may join the queue. */}
          <fieldset
            aria-describedby="location-hint"
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
          >
            <legend className="px-1 text-[0.95rem] font-medium text-ink">The exact spot</legend>
            <p id="location-hint" className="text-sm text-ink-3">
              Used for “near me” and for how far away people can join your queue. Your location is asked for
              only when you press the button, and used once.
            </p>
            {draft.place ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink" role="status">
                <MapPin className="size-4 text-brand-ink" aria-hidden />
                <span className="tabular font-medium">{coordinatesLabel(draft.place)}</span>
                <a
                  href={mapsLink(draft.place)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand-ink underline underline-offset-4"
                >
                  Check it on a map<span className="sr-only"> (opens Google Maps)</span>
                </a>
              </p>
            ) : null}
            <div>
              <Button type="button" onClick={locate} disabled={locating}>
                {locating ? <Spinner className="size-4" /> : <LocateFixed aria-hidden />}
                {draft.place ? 'Use where I am now instead' : 'I’m at the business: use where I am'}
              </Button>
            </div>
            <Field
              label="Or paste it from a map"
              optionalLabel={false}
              hint="In Google Maps, press and hold the spot, then copy the numbers it shows (like 31.5204, 74.3587)."
              error={errors.location}
            >
              <Input
                inputMode="decimal"
                value={draft.pasted}
                onChange={(e) => paste(e.target.value)}
                placeholder="31.5204, 74.3587"
                maxLength={60}
              />
            </Field>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Time zone"
              required
              optionalLabel={false}
              hint="Opening hours and every visit are in this time."
            >
              <Select value={timezone} onChange={(e) => set('timezone', e.target.value)}>
                {zones.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" required optionalLabel={false} hint="Your prices are shown in it.">
              <Select value={draft.currency} onChange={(e) => set('currency', e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Step>

      <Step number={3} title="Before your page goes live">
        <div className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
            <li>Your page goes live as soon as you finish, marked “Not verified”. It can take bookings.</li>
            <li>To be verified, you send BUKU your registration details and a document; we check them.</li>
            <li>Customers pay you at your business. BUKU never takes payment for a visit.</li>
          </ul>
          <div className="flex flex-col gap-1">
            <Checkbox
              checked={draft.terms}
              onCheckedChange={(v) => set('terms', v === true)}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? 'terms-error' : undefined}
              label={
                <>
                  I agree to the{' '}
                  <Link
                    href={'/legal/business-terms' as Route}
                    target="_blank"
                    className="font-medium text-brand-ink underline underline-offset-4"
                  >
                    business terms<span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                </>
              }
            />
            {errors.terms && (
              <p id="terms-error" className="text-sm font-medium text-danger">
                {errors.terms}
              </p>
            )}
          </div>
        </div>
      </Step>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Put my business on BUKU
        </Button>
        <span className="text-sm text-ink-3">Next: your opening hours and your first service.</span>
      </div>
    </form>
  );
}
