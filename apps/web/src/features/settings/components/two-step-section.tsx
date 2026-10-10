'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { fetchTwoStepStatus, type Me } from '@/features/auth/api';
import { problemFrom } from '@/features/auth/problems';
import { newRecoveryCodes, turnOffTwoStep, TWO_STEP_KEY } from '../api';
import { RecoveryCodes } from './recovery-codes';
import { SecondFactorForm } from './second-factor-form';
import { SettingsSection } from './section';

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/**
 * Two-step sign-in, on or off. Off: what it is, and where to turn it on. On:
 * since when, how many recovery codes are left, new codes, and turning it off
 * — both with a code from the app or, for a lost phone, a recovery code.
 */
export function TwoStepSection({ me }: { me: Me }) {
  const status = useQuery({ queryKey: TWO_STEP_KEY, queryFn: fetchTwoStepStatus });

  return (
    <SettingsSection
      title="Two-step sign-in"
      intro="A 6-digit code from an app on your phone, asked for each time you sign in."
    >
      {status.isPending ? (
        <Skeleton className="h-16" />
      ) : status.isError ? (
        <p className="text-sm text-danger">
          {problemFrom(status.error, 'We couldn’t check it just now. Please try again in a moment.').title}
        </p>
      ) : status.data.enabled ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="ok">
              <ShieldCheck aria-hidden /> On
            </Badge>
            <span className="text-sm text-ink-2">
              {status.data.since && <>Since {shortDate(status.data.since)}. </>}
              {status.data.recoveryCodesLeft === 0
                ? 'No recovery codes left. Get new ones.'
                : `${status.data.recoveryCodesLeft} recovery ${status.data.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <NewCodes account={me.email ?? me.name} />
            {status.data.required ? (
              <p className="self-center text-sm text-ink-3">Platform admins always keep it on.</p>
            ) : (
              <TurnOff />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">Off</Badge>
          <Button asChild variant="primary">
            <Link href="/account/settings/two-step">Turn on two-step sign-in</Link>
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function NewCodes({ account }: { account: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCodes(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Get new recovery codes</Button>
      </DialogTrigger>
      <DialogContent
        title={codes ? 'Your new recovery codes' : 'Get new recovery codes?'}
        description={codes ? undefined : 'Your old codes stop working, including any you saved.'}
      >
        {codes ? (
          <RecoveryCodes
            codes={codes}
            account={account}
            onDone={() => {
              setOpen(false);
              setCodes(null);
              toast.success('Your new recovery codes are ready to use.');
            }}
          />
        ) : (
          <SecondFactorForm
            action="Get new codes"
            onProof={async (proof) => {
              const { recoveryCodes } = await newRecoveryCodes(proof);
              await queryClient.invalidateQueries({ queryKey: TWO_STEP_KEY });
              setCodes(recoveryCodes);
            }}
          >
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
          </SecondFactorForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TurnOff() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Turn off</Button>
      </DialogTrigger>
      <DialogContent
        title="Turn off two-step sign-in?"
        description="Signing in won’t ask for a code any more, and your recovery codes stop working. You can turn it on again any time."
      >
        <SecondFactorForm
          action="Turn off"
          danger
          onProof={async (proof) => {
            await turnOffTwoStep(proof);
            await queryClient.invalidateQueries({ queryKey: TWO_STEP_KEY });
            setOpen(false);
            toast('Two-step sign-in is off.');
          }}
        >
          <DialogClose asChild>
            <Button variant="secondary">Keep it on</Button>
          </DialogClose>
        </SecondFactorForm>
      </DialogContent>
    </Dialog>
  );
}
