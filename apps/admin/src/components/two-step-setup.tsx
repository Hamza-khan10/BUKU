'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

type Stage =
  { at: 'intro' } | { at: 'scan'; secret: string; otpauthUri: string } | { at: 'codes'; codes: string[] };

/**
 * Two-step sign-in is required for every admin: nothing here works until it's
 * set up. Scan or type the key, prove the app works, keep the recovery codes.
 */
export function TwoStepSetup() {
  const [stage, setStage] = useState<Stage>({ at: 'intro' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const begin = async () => {
    setBusy(true);
    setError(null);
    const result = await post<{ secret: string; otpauthUri: string }>('/api/two-step/start');
    setBusy(false);
    if (result.ok) setStage({ at: 'scan', ...result.data });
    else setError(result.message);
  };

  const confirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = fieldText(new FormData(e.currentTarget), 'code').replace(/\D/g, '');
    setBusy(true);
    setError(null);
    const result = await post<{ recoveryCodes: string[] }>('/api/two-step/confirm', { code });
    setBusy(false);
    if (result.ok) setStage({ at: 'codes', codes: result.data.recoveryCodes });
    else
      setError(
        result.code === 'MFA_INVALID_CODE'
          ? 'That code isn’t right. Enter the one your app shows now.'
          : result.message,
      );
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Notice tone="danger" title={error} />}
      {stage.at === 'intro' && (
        <>
          <p className="text-ink-2">
            Admin accounts must use two-step sign-in: a 6-digit code from an authenticator app each time you
            sign in.
          </p>
          <Button onClick={() => void begin()} busy={busy} className="w-fit">
            Set it up
          </Button>
        </>
      )}
      {stage.at === 'scan' && (
        <form noValidate onSubmit={(e) => void confirm(e)} className="flex flex-col gap-5">
          <div
            role="img"
            aria-label="QR code to add BUKU admin to your authenticator app"
            className="w-fit rounded-md bg-white p-3"
          >
            <QRCodeSVG value={stage.otpauthUri} size={176} level="M" aria-hidden />
          </div>
          <p className="text-sm text-ink-2">
            Can’t scan it? Enter this key:{' '}
            <code aria-label="Setup key" className="rounded bg-sunken px-2 py-1 font-mono tracking-wider">
              {stage.secret.match(/.{1,4}/g)?.join(' ')}
            </code>
          </p>
          <Field label="6-digit code" hint="The code your app now shows for BUKU.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                className={`${inputClass} max-w-48 font-mono tracking-widest`}
              />
            )}
          </Field>
          <Button type="submit" busy={busy} className="w-fit">
            Turn on two-step sign-in
          </Button>
        </form>
      )}
      {stage.at === 'codes' && (
        <div className="flex flex-col gap-4">
          <Notice tone="wait" title="Save these recovery codes now: they won’t be shown again">
            Each one signs you in once if you lose the phone with your app.
          </Notice>
          <ol
            aria-label="Your recovery codes"
            className="grid grid-cols-2 gap-2 rounded-md bg-sunken p-4 font-mono tracking-wider"
          >
            {stage.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="size-4"
            />
            I’ve saved my recovery codes somewhere safe
          </label>
          <Button disabled={!saved} onClick={() => window.location.assign('/')} className="w-fit">
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
