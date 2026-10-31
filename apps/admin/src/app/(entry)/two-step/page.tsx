import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignOut } from '@admin/components/sign-out';
import { TwoStepSetup } from '@admin/components/two-step-setup';
import { Card, Notice } from '@admin/components/ui';
import { adminGate } from '@admin/lib/admin';

export const metadata: Metadata = { title: 'Set up two-step sign-in' };

/** Required before anything else: an admin without two-step sign-in sees only this. */
export default async function TwoStepPage() {
  const gate = await adminGate();
  if (gate.kind === 'signed-out') redirect('/signin');
  if (gate.kind === 'renew') redirect('/api/session/renew?next=%2Ftwo-step');
  if (gate.kind === 'not-admin') redirect('/api/session/end?reason=not-admin');
  if (gate.kind === 'ok') redirect('/');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="rise flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-brand-text">One more step</p>
          <h1 className="text-[1.9rem] leading-[1.1] font-semibold tracking-[-0.025em]">
            Set up two-step sign-in
          </h1>
        </div>
        <SignOut />
      </div>
      <Card className="rise">
        <TwoStepSetup />
      </Card>
    </div>
  );
}
