'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { fetchMe, fetchTwoStepStatus, ME_KEY } from '@/features/auth/api';
import { codeDigits } from '@/features/auth/codes';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { confirmTwoStep, startTwoStep, TWO_STEP_KEY } from '../api';
import { groupedKey } from '../two-step';
import { RecoveryCodes } from './recovery-codes';

type Stage =
  { at: 'intro' } | { at: 'scan'; secret: string; otpauthUri: string } | { at: 'codes'; codes: string[] };

/**
 * Turning on two-step sign-in, one step at a time: what it is, then the app
 * (scan the QR code or type the key), then a code to prove the app works,
 * then the recovery codes — shown once. Nothing changes until the code is
 * right; leaving half-way leaves the account as it was.
 */
export function TwoStepSetup() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: TWO_STEP_KEY, queryFn: fetchTwoStepStatus });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const [stage, setStage] = useState<Stage>({ at: 'intro' });
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);

  if (status.isPending || me.isPending) return <Skeleton className="h-72 max-w-xl" />;
  if (status.isError || me.isError) {
    const e =
      (status.error ?? me.error) instanceof ApiError ? ((status.error ?? me.error) as ApiError) : null;
    return (
      <ErrorState
        title="We couldn’t load your sign-in settings"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }
  // Already on (and not just turned on here, while the codes are showing).
  if (status.data.enabled && stage.at !== 'codes') {
    return (
      <Alert tone="ok" title="Two-step sign-in is already on">
        <Link href="/account/settings" className="font-medium underline underline-offset-4">
          Back to settings
        </Link>
      </Alert>
    );
  }

  const begin = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      setStage({ at: 'scan', ...(await startTwoStep()) });
    } catch (err) {
      setProblem(problemFrom(err, 'Setting it up didn’t start. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    toast.success('Two-step sign-in is on.');
    router.push('/account/settings');
  };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <ProblemAlert problem={problem} />
      {stage.at === 'intro' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 text-ink-2">
            <p>
              Each time you sign in, BUKU will also ask for a 6-digit code from an authenticator app on your
              phone. Someone who gets hold of{' '}
              {me.data.account.type === 'employee' ? 'your password' : 'the account you sign in with'} still
              can’t get into BUKU without it.
            </p>
            <p>
              You need an authenticator app: Google Authenticator, Microsoft Authenticator, 1Password or any
              other that shows 6-digit codes. It takes about two minutes.
            </p>
          </div>
          <Button variant="primary" size="lg" loading={busy} onClick={() => void begin()} className="w-fit">
            Start
          </Button>
        </div>
      )}
      {stage.at === 'scan' && (
        <ScanAndConfirm
          secret={stage.secret}
          otpauthUri={stage.otpauthUri}
          onConfirmed={async (codes) => {
            await queryClient.invalidateQueries({ queryKey: TWO_STEP_KEY });
            setStage({ at: 'codes', codes });
          }}
        />
      )}
      {stage.at === 'codes' && (
        <section aria-label="Recovery codes" className="flex flex-col gap-4">
          <Alert tone="ok" title="Two-step sign-in is on" />
          <h2 className="font-display text-2xl font-semibold">Last step: save your recovery codes</h2>
          <RecoveryCodes codes={stage.codes} account={me.data.email ?? me.data.name} onDone={finish} />
        </section>
      )}
    </div>
  );
}

function ScanAndConfirm({
  secret,
  otpauthUri,
  onConfirmed,
}: {
  secret: string;
  otpauthUri: string;
  onConfirmed: (codes: string[]) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (digits: string) => {
    setBusy(true);
    setFieldError(undefined);
    setProblem(undefined);
    try {
      const { recoveryCodes } = await confirmTwoStep(digits);
      await onConfirmed(recoveryCodes);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'MFA_INVALID_CODE') {
        setFieldError(
          'That code isn’t right. Check the app shows BUKU, and enter the code showing now (they change every 30 seconds).',
        );
        setCode('');
        input.current?.focus();
      } else {
        setProblem(problemFrom(err, 'Checking the code didn’t work. Please try again.'));
      }
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (code.length === 6) void send(code);
    else setFieldError('Enter the 6 digits your app shows for BUKU.');
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Key copied.');
    } catch {
      toast.error('Copying didn’t work here. Type the key instead.');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Add BUKU to your app" className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold">1. Add BUKU to your app</h2>
        <p className="text-ink-2">In your authenticator app, add an account and scan this code.</p>
        <div
          role="img"
          aria-label="QR code to add BUKU to your authenticator app"
          className="w-fit rounded-lg border border-line bg-white p-3"
        >
          <QRCodeSVG value={otpauthUri} size={184} level="M" aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-2">Can’t scan it? Choose to enter a key, and type this one:</p>
          <div className="flex flex-wrap items-center gap-3">
            <code
              aria-label="Setup key"
              className="rounded-md bg-sunken px-3 py-2 font-mono text-base tracking-wider text-ink"
            >
              {groupedKey(secret)}
            </code>
            <Button variant="ghost" size="sm" onClick={() => void copyKey()}>
              <Copy aria-hidden /> Copy key
            </Button>
          </div>
          <p className="text-sm text-ink-3">Keep this key to yourself: anyone with it can make your codes.</p>
        </div>
      </section>

      <section aria-label="Check it works" className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold">2. Check it works</h2>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <ProblemAlert problem={problem} />
          <Field
            label="6-digit code"
            required
            optionalLabel={false}
            hint="The code your app now shows for BUKU."
            error={fieldError}
          >
            <Input
              ref={input}
              name="code"
              value={code}
              onChange={(e) => {
                const digits = codeDigits(e.target.value);
                setCode(digits);
                setFieldError(undefined);
                if (digits.length === 6 && !busy) void send(digits);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              readOnly={busy}
              className="h-14 max-w-64 text-center font-mono text-2xl tracking-[0.5em]"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Turn on two-step sign-in
            </Button>
            <Button asChild variant="ghost">
              <Link href="/account/settings">
                <ArrowLeft aria-hidden /> Not now
              </Link>
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
