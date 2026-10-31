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
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Set up two-step sign-in</h1>
        <SignOut />
      </div>
      <Card>
        <TwoStepSetup />
      </Card>
    </div>
  );
}
