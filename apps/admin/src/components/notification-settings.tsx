'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MESSAGE_TYPES, type NotificationSettings, type WhatsappTemplate } from '@admin/lib/notifications';
import { post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * How BUKU tells people things (3.6k). WhatsApp costs money per message beyond Meta's free
 * conversations, so turning it on is asked twice: the switch, then a line to confirm.
 */
export function NotificationSettingsForm({
  settings: s,
  templates,
}: {
  settings: NotificationSettings;
  templates: WhatsappTemplate[];
}) {
  const router = useRouter();
  const [whatsapp, setWhatsapp] = useState(s.whatsappEnabled);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const turningOn = whatsapp && !s.whatsappEnabled;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    const on = (k: string) => f.get(k) === 'on';
    setBusy(true);
    setSaid(null);
    const result = await post('/api/notifications/settings', {
      emailEnabled: on('email'),
      whatsappEnabled: whatsapp,
      whatsappPaidTypes: templates.map((t) => t.type).filter((t) => on(`paid-${t}`)),
      whatsappMonthlyBudgetCents: Math.round(num('budget') * 100),
      whatsappMessageCostCents: num('cost'),
      whatsappFreeWindowPerMonth: Math.round(num('free')),
      reminder24h: on('r24'),
      reminder2h: on('r2'),
      quietStartHour: num('quietStart'),
      quietEndHour: num('quietEnd'),
      suggestionsEnabled: on('suggestions'),
      suggestionMinDays: Math.round(num('minDays')),
      suggestionMaxPer30Days: Math.round(num('max30')),
      suggestionMaxIgnored: Math.round(num('maxIgnored')),
    });
    setBusy(false);
    if (result.ok) {
      setConfirmed(false);
      setSaid({ ok: true, text: 'Saved. Every service follows within 30 seconds.' });
      router.refresh();
    } else
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
  };

  const box = 'flex flex-col gap-4 rounded-xl bg-sunken/60 p-4 ring-1 ring-line ring-inset';
  const check = 'size-4 accent-[var(--brand)]';
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <fieldset className={box}>
        <legend className="mb-1 text-sm font-semibold text-ink">Channels</legend>
        <label className="flex items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="email" defaultChecked={s.emailEnabled} className={check} />
          Send emails
        </label>
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            role="switch"
            checked={whatsapp}
            onChange={(e) => {
              setWhatsapp(e.target.checked);
              setConfirmed(false);
            }}
            className={`mt-0.5 ${check}`}
          />
          <span>
            Send WhatsApp messages
            <span className="block text-xs text-ink-3">
              Only to people who turned WhatsApp on in their settings.
            </span>
          </span>
        </label>
        {turningOn && (
          <label className="flex items-start gap-3 rounded-lg bg-wait-soft p-3 text-sm text-ink ring-1 ring-wait/30 ring-inset">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className={`mt-0.5 ${check}`}
            />
            I understand: messages beyond Meta’s free conversations are charged, up to the monthly budget
            below.
          </label>
        )}
      </fieldset>

      <fieldset className={box}>
        <legend className="mb-1 text-sm font-semibold text-ink">What WhatsApp may cost</legend>
        <div className="grid items-end gap-4 sm:grid-cols-3">
          <Field label="Monthly budget (USD)" hint="0: never pay.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                name="budget"
                type="number"
                min={0}
                step={0.01}
                defaultValue={s.whatsappMonthlyBudgetCents / 100}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Cost per message (US cents)" hint="Meta’s rate for your market.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                name="cost"
                type="number"
                min={0}
                max={1000}
                step={0.01}
                defaultValue={s.whatsappMessageCostCents}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Free replies a month" hint="In a person’s 24-hour window.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                name="free"
                type="number"
                min={0}
                step={1}
                defaultValue={s.whatsappFreeWindowPerMonth}
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-2">
            Worth paying for (a template message, outside the free window)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <label key={t.type} className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name={`paid-${t.type}`}
                  defaultChecked={s.whatsappPaidTypes.includes(t.type)}
                  className={check}
                />
                {MESSAGE_TYPES[t.type] ?? t.type.replaceAll('_', ' ')}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className={box}>
        <legend className="mb-1 text-sm font-semibold text-ink">Reminders and quiet hours</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" name="r24" defaultChecked={s.reminder24h} className={check} />
            The day before
          </label>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" name="r2" defaultChecked={s.reminder2h} className={check} />
            Two hours before
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quiet from" hint="Local time: nothing but what can’t wait.">
            {({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                name="quietStart"
                defaultValue={s.quietStartHour}
                className={inputClass}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Quiet until">
            {({ id }) => (
              <select id={id} name="quietEnd" defaultValue={s.quietEndHour} className={inputClass}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className={box}>
        <legend className="mb-1 text-sm font-semibold text-ink">
          Suggestions (“time for your next visit?”)
        </legend>
        <label className="flex items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="suggestions" defaultChecked={s.suggestionsEnabled} className={check} />
          Send suggestions
        </label>
        <div className="grid items-end gap-4 sm:grid-cols-3">
          <Field label="At least days apart">
            {({ id }) => (
              <input
                id={id}
                name="minDays"
                type="number"
                min={0}
                max={365}
                defaultValue={s.suggestionMinDays}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="At most in 30 days">
            {({ id }) => (
              <input
                id={id}
                name="max30"
                type="number"
                min={0}
                max={30}
                defaultValue={s.suggestionMaxPer30Days}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Stop after ignored">
            {({ id }) => (
              <input
                id={id}
                name="maxIgnored"
                type="number"
                min={0}
                max={100}
                defaultValue={s.suggestionMaxIgnored}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy} disabled={turningOn && !confirmed}>
          Save settings
        </Button>
        {said && (
          <span className="min-w-0 flex-1">
            <Notice tone={said.ok ? 'ok' : 'danger'} title={said.text} />
          </span>
        )}
      </div>
    </form>
  );
}
