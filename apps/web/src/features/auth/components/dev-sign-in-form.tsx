'use client';

import { zText } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ShieldCheck, User } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { RadioGroup } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { isSignedIn } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { devSignIn, ME_KEY, type DevRole } from '../api';

const ROLES: { value: DevRole; label: string; text: string; Icon: typeof User }[] = [
  { value: 'user', label: 'Customer', text: 'Book and join queues.', Icon: User },
  { value: 'business_owner', label: 'Business owner', text: 'Run a business on BUKU.', Icon: Building2 },
  { value: 'super_admin', label: 'Platform admin', text: 'BUKU’s own tools.', Icon: ShieldCheck },
];

const EMAIL = z.email({ message: 'Please enter an email address like name@example.com.' });
const NAME = zText({ kind: 'personName', max: 100 });

interface Errors {
  email?: string | undefined;
  name?: string | undefined;
  form?: { message: string; reference?: string | undefined } | undefined;
}

/**
 * Development sign-in: any email, no password, a role to try. Only on
 * development and test sites (the server decides whether to show it, and the
 * API refuses it on the live site). The name follows the clean-text rules.
 */
export function DevSignInForm({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<DevRole>('user');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (key: string) => {
      const v = data.get(key);
      return typeof v === 'string' ? v : '';
    };
    const email = EMAIL.safeParse(field('email').trim().toLowerCase());
    const rawName = field('name');
    const name = rawName.trim() ? NAME.safeParse(rawName) : null;
    const found: Errors = {
      email: email.success ? undefined : email.error.issues[0]?.message,
      name: name && !name.success ? name.error.issues[0]?.message : undefined,
    };
    setErrors(found);
    if (!email.success || (name && !name.success)) return;

    setBusy(true);
    try {
      const result = await devSignIn({ email: email.data, name: name?.data, role });
      if ('mfaRequired' in result) {
        // Development sign-in counts as two-step; this only happens if the API changes.
        setErrors({
          form: { message: 'This account needs its two-step code, which development sign-in skips.' },
        });
        return;
      }
      if (!isSignedIn()) {
        setErrors({
          form: {
            message:
              'Your browser didn’t keep BUKU’s sign-in cookies. Allow cookies for this site and try again.',
          },
        });
        return;
      }
      queryClient.setQueryData(ME_KEY, result.user);
      const first = result.user.name.split(' ')[0];
      toast.success(result.isNewUser ? `Welcome to BUKU, ${first}` : `Welcome back, ${first}`);
      router.replace(next as Route);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const byField = Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message]));
        if (byField.email || byField.name) setErrors({ email: byField.email, name: byField.name });
        else setErrors({ form: { message: err.message, reference: err.requestId } });
      } else {
        setErrors({ form: { message: 'Signing in didn’t work. Please try again.' } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <Alert title="Development sign-in">
        Only on development and test sites: any email, no password. The live site uses Google.
      </Alert>
      {errors.form && (
        <Alert tone="danger" title={errors.form.message}>
          {errors.form.reference && (
            <span className="font-mono text-xs">Reference: {errors.form.reference}</span>
          )}
        </Alert>
      )}
      <Field label="Email" required error={errors.email}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoFocus maxLength={254} />
      </Field>
      <Field label="Name" hint="Leave empty to use the part of the email before the @." error={errors.name}>
        <CleanTextInput kind="personName" name="name" autoComplete="name" maxLength={100} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Sign in as</legend>
        <p className="mb-1.5 text-sm text-ink-3">
          For a new email. An email that has signed in before keeps its role.
        </p>
        <RadioGroup.Root
          value={role}
          onValueChange={(v) => setRole(v as DevRole)}
          aria-label="Sign in as"
          className="grid gap-2 sm:grid-cols-3"
        >
          {ROLES.map(({ value, label, text, Icon }) => (
            <RadioGroup.Item
              key={value}
              value={value}
              className={cn(
                'flex flex-col items-start gap-1 rounded-md border border-line bg-surface p-3 text-left transition-colors',
                'hover:border-ink-3 data-[state=checked]:border-brand data-[state=checked]:bg-brand-soft',
              )}
            >
              <Icon className="size-5 text-ink-2" aria-hidden />
              <span className="font-medium text-ink">{label}</span>
              <span className="text-xs text-ink-3">{text}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </fieldset>
      <Button type="submit" variant="primary" size="lg" loading={busy} block>
        Sign in
      </Button>
    </form>
  );
}
