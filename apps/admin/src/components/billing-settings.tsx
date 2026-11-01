'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Settings } from '@admin/lib/billing';
import { fieldText, post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

/**
 * Billing's settings for businesses (3.6i). Charging on or off changes what every business may do
 * at once, so a change there asks to be confirmed in words before it's sent.
 */
export function BillingSettings({
  settings,
  plans,
}: {
  settings: Settings;
  plans: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [charging, setCharging] = useState(settings.enabled);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const flipping = charging !== settings.enabled;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const trialOn = form.get('trial') === 'on';
    const days = Number(fieldText(form, 'trialDays'));
    const changes = {
      ...(flipping && { enabled: charging }),
      defaultPlanCode: fieldText(form, 'defaultPlan'),
      planWhenDisabledCode: fieldText(form, 'whenOff'),
      trialEnabled: trialOn,
      ...(trialOn && { trialDays: days, trialPlanCode: fieldText(form, 'trialPlan') }),
    };
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/settings/${settings.audience}`, changes);
    setBusy(false);
    if (result.ok) {
      setConfirmed(false);
      setSaid({ ok: true, text: 'Saved. Every business shard follows within moments.' });
      router.refresh();
    } else
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={charging}
          onChange={(e) => {
            setCharging(e.target.checked);
            setConfirmed(false);
          }}
          className="mt-0.5 size-5 accent-[var(--brand)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink">Charge businesses</span>
          <span className="text-sm text-ink-3">
            {charging
              ? 'On: each business gets what its plan includes; without one, the default plan.'
              : `Off: every business has the ${settings.planWhenDisabled.name} plan. Subscriptions stay recorded.`}
          </span>
        </span>
      </label>
      {flipping && (
        <div className="rounded-xl bg-wait-soft p-4 ring-1 ring-wait/30 ring-inset">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            {charging
              ? 'I understand: from now on businesses are held to their plan’s limits, and paid plans are charged.'
              : 'I understand: every business gets the unlimited plan at once, until charging is turned back on.'}
          </label>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default plan" hint="For a business without a subscription.">
          {({ id, describedBy }) => (
            <select
              id={id}
              aria-describedby={describedBy}
              name="defaultPlan"
              defaultValue={settings.defaultPlan.code}
              className={inputClass}
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Plan while charging is off" hint="Everyone has it while off.">
          {({ id, describedBy }) => (
            <select
              id={id}
              aria-describedby={describedBy}
              name="whenOff"
              defaultValue={settings.planWhenDisabled.code}
              className={inputClass}
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3 rounded-xl bg-sunken/60 p-4 ring-1 ring-line ring-inset">
        <legend className="sr-only">Free trial</legend>
        <label className="flex items-center gap-3 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            name="trial"
            defaultChecked={settings.trial.enabled}
            className="size-4 accent-[var(--brand)]"
          />
          Offer a free trial (once per business)
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trial length (days)">
            {({ id }) => (
              <input
                id={id}
                name="trialDays"
                type="number"
                min={1}
                max={365}
                defaultValue={settings.trial.days}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Trial plan">
            {({ id }) => (
              <select
                id={id}
                name="trialPlan"
                defaultValue={settings.trial.plan?.code ?? plans.at(-1)?.code}
                className={inputClass}
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy} disabled={flipping && !confirmed}>
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
