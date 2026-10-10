import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card } from '@admin/components/ui';
import { VerifyForm } from '@admin/components/verify-form';
import { readChallenge } from '@admin/lib/session';

export const metadata: Metadata = { title: 'Two-step sign-in' };

export default async function VerifyPage() {
  if (!readChallenge(await cookies())) redirect('/signin?error=expired');
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Enter your code</h1>
      <Card>
        <VerifyForm />
      </Card>
    </div>
  );
}
