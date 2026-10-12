'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { zText } from '@buku/validation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import {
  createMember,
  createStaff,
  fetchMembers,
  MANAGEABLE_ROLES,
  membersKey,
  removeMember,
  resetMemberPassword,
  ROLE_LABELS,
  ROLE_TEXT,
  staffKey,
  updateMember,
  type ManagedBusiness,
  type Member,
} from '../api';

const NAME = zText({ kind: 'personName', min: 1, max: 100 });
const USERNAME = /^[A-Za-z0-9._-]{3,40}$/;

/** The site's own address, known once the page has come to life (for the sign-in link). */
const noChange = () => () => undefined;
const useOrigin = () =>
  useSyncExternalStore(
    noChange,
    () => window.location.origin,
    () => '',
  );

/**
 * Team logins (3.5d): employee accounts that sign in with a username at this business, each with
 * a role — managers run the business with the owner, front desk takes bookings and runs the
 * queue, staff see their own visits. The temporary password is shown once, to hand over in
 * person; they choose their own at their first sign-in. Managers manage front desk and staff
 * only, and nobody changes their own access (the API enforces both).
 */
export function LoginsSection({ business }: { business: ManagedBusiness }) {
  const members = useQuery({ queryKey: membersKey(business.id), queryFn: () => fetchMembers(business.id) });
  const [adding, setAdding] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const roles = MANAGEABLE_ROLES[business.myRole];

  if (members.isPending) return <Skeleton className="h-40" />;
  if (members.isError) {
    const e = members.error instanceof ApiError ? members.error : null;
    return (
      <ErrorState
        title="The logins didn’t load"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-ink-2">
          For people who use BUKU at work: they sign in with a username at {business.name}, and see only what
          their role allows.
        </p>
        {!adding && roles.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add a login
          </Button>
        )}
      </div>

      {handover && (
        <PasswordHandover business={business} handover={handover} onDone={() => setHandover(null)} />
      )}
      {adding && (
        <NewLogin
          business={business}
          roles={roles}
          onDone={(h) => {
            setAdding(false);
            setHandover(h);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {members.data.length === 0 ? (
        <p className="text-sm text-ink-3">No logins yet. Only you can sign in to {business.name}.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface shadow-soft ring-1 ring-line">
          {members.data.map((m) => (
            <MemberRow
              key={m.id}
              business={business}
              member={m}
              manageable={(roles as readonly string[]).includes(m.role)}
              onPassword={(h) => setHandover(h)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface Handover {
  member: Member;
  password: string;
  fresh: boolean;
}

function NewLogin({
  business,
  roles,
  onDone,
  onCancel,
}: {
  business: ManagedBusiness;
  roles: readonly Member['role'][];
  onDone: (h: Handover) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Member['role']>(roles.includes('staff') ? 'staff' : roles[0]!);
  const [errors, setErrors] = useState<{ name?: string; username?: string }>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = NAME.safeParse(name);
    const found = {
      ...(!name.trim()
        ? { name: 'Please write their name.' }
        : !n.success && { name: n.error.issues[0]?.message }),
      ...(!USERNAME.test(username.trim()) && {
        username: '3 to 40 letters or numbers; dots, dashes and underscores are fine.',
      }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setProblem(undefined);
    setBusy(true);
    try {
      const made = await createMember(business.id, { name: n.data!, username: username.trim(), role });
      await queryClient.invalidateQueries({ queryKey: membersKey(business.id) });
      onDone({ member: made.member, password: made.temporaryPassword, fresh: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
        setErrors({ username: 'Someone at this business already has that username. Try another.' });
      } else {
        setProblem(problemFrom(err, 'The login couldn’t be made. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void save(e)}
      className="flex flex-col gap-5 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line animate-rise sm:p-6"
    >
      <h3 className="type-subheading">A new login</h3>
      <ProblemAlert problem={problem} />
      <Field label="Their name" required optionalLabel={false} error={errors.name}>
        <CleanTextInput
          kind="personName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </Field>
      <Field
        label="Username"
        required
        optionalLabel={false}
        hint="What they type to sign in, with your business. Not their email."
        error={errors.username}
      >
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          placeholder="ali.raza"
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium text-ink">What they can do</legend>
        {roles.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3 has-checked:border-brand has-checked:bg-brand-soft"
          >
            <input
              type="radio"
              name="role"
              checked={role === r}
              onChange={() => setRole(r)}
              className="mt-1 size-4 accent-(--brand)"
            />
            <span className="flex flex-col">
              <span className="font-medium text-ink">{ROLE_LABELS[r]}</span>
              <span className="text-sm text-ink-3">{ROLE_TEXT[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          Make the login
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The temporary password, shown once. It isn't kept anywhere readable: hand it over in person,
 * and they choose their own at their first sign-in.
 */
function PasswordHandover({
  business,
  handover,
  onDone,
}: {
  business: ManagedBusiness;
  handover: Handover;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const origin = useOrigin();
  const [bookable, setBookable] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = `${origin}/signin/business?business=${business.slug}`;
  const { member, password } = handover;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast('Copying isn’t allowed here; select it and copy it instead.');
    }
  };

  const makeBookable = async () => {
    setBusy(true);
    try {
      await createStaff(business.id, { displayName: member.name, userId: member.userId, serviceIds: [] });
      await queryClient.invalidateQueries({ queryKey: staffKey(business.id) });
      setBookable(true);
      toast.success(`${member.name} is on your team. Choose what they do under People customers can book.`);
    } catch (err) {
      toast(problemFrom(err, 'That didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="handover"
      className="flex flex-col gap-4 rounded-xl bg-brand-soft p-5 animate-rise sm:p-6"
    >
      <h3 id="handover" className="type-subheading">
        {handover.fresh ? `${member.name}’s login is ready` : `A new password for ${member.name}`}
      </h3>
      <p className="text-ink-2">
        Give them this password in person. It’s shown only now; at their first sign-in they choose their own.
      </p>
      <dl className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
        <dt className="text-sm text-ink-2">Username</dt>
        <dd className="font-mono text-lg font-semibold text-ink">{member.username}</dd>
        <dt className="text-sm text-ink-2">Temporary password</dt>
        <dd className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold tracking-wider text-ink">{password}</span>
          <Button size="sm" onClick={() => void copy(password, 'The password is')}>
            <Copy aria-hidden /> Copy
          </Button>
        </dd>
        <dt className="text-sm text-ink-2">Where they sign in</dt>
        <dd className="flex flex-wrap items-center gap-3">
          <span className="text-sm break-all text-ink">{link}</span>
          <Button size="sm" variant="ghost" onClick={() => void copy(link, 'The link is')}>
            <Copy aria-hidden /> Copy link
          </Button>
        </dd>
      </dl>
      <div className="flex flex-wrap gap-3">
        {handover.fresh && member.role !== 'front_desk' && !bookable && (
          <Button variant="primary" loading={busy} onClick={() => void makeBookable()}>
            Customers can book them too
          </Button>
        )}
        <Button onClick={onDone}>I’ve handed it over</Button>
      </div>
    </section>
  );
}

function MemberRow({
  business,
  member,
  manageable,
  onPassword,
}: {
  business: ManagedBusiness;
  member: Member;
  manageable: boolean;
  onPassword: (h: Handover) => void;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<'password' | 'off' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const roles = MANAGEABLE_ROLES[business.myRole];
  const off = member.status === 'disabled';

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: membersKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: staffKey(business.id) }),
      ]);
      setAsking(null);
      toast.success(done);
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  const ask = {
    password: {
      title: `A new password for ${member.name}?`,
      text: 'Their current one stops working and they’re signed out everywhere. It also unlocks a locked login.',
      button: 'Make a new password',
      go: async () => {
        setBusy(true);
        setProblem(null);
        try {
          const { temporaryPassword } = await resetMemberPassword(business.id, member.id);
          await queryClient.invalidateQueries({ queryKey: membersKey(business.id) });
          setAsking(null);
          onPassword({ member, password: temporaryPassword, fresh: false });
        } catch (err) {
          setProblem(problemFrom(err, 'That didn’t work. Please try again.').title);
        } finally {
          setBusy(false);
        }
      },
    },
    off: {
      title: `Turn off ${member.name}’s login?`,
      text: 'They’re signed out at once and can’t sign in until you turn it back on. Nothing is deleted.',
      button: 'Turn it off',
      go: () =>
        run(
          () => updateMember(business.id, member.id, { status: 'disabled' }),
          `${member.name}’s login is off.`,
        ),
    },
    remove: {
      title: `Remove ${member.name}?`,
      text: 'Their login is closed, the username is free again, and they stop taking bookings. Their past visits keep their name.',
      button: 'Remove them',
      go: () => run(() => removeMember(business.id, member.id), `${member.name} is removed.`),
    },
  } as const;

  return (
    <li className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold text-ink">{member.name}</span>
          <span className="text-sm text-ink-3">
            {member.username ? (
              <span className="font-mono">{member.username}</span>
            ) : (
              'Their own BUKU account'
            )}{' '}
            ·{' '}
            {member.lastSignInAt
              ? `last signed in ${new Date(member.lastSignInAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : 'not signed in yet'}
          </span>
          <span className="flex flex-wrap gap-1.5 pt-0.5">
            <Badge tone="brand">{ROLE_LABELS[member.role]}</Badge>
            {off && <Badge tone="neutral">Turned off</Badge>}
            {member.passwordChangePending && !off && (
              <Badge tone="wait">Still on the temporary password</Badge>
            )}
            {member.locked && <Badge tone="danger">Locked after wrong passwords</Badge>}
          </span>
        </div>
        {manageable && roles.length > 1 && !off && (
          <Select
            aria-label={`${member.name}’s role`}
            value={member.role}
            disabled={busy}
            onChange={(e) =>
              void run(
                () => updateMember(business.id, member.id, { role: e.target.value as Member['role'] }),
                `${member.name} is ${ROLE_LABELS[e.target.value as Member['role']].toLowerCase()} now.`,
              )
            }
            className="w-auto"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        )}
      </div>
      {manageable && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {member.accountType === 'employee' && !off && (
            <button type="button" className={link} onClick={() => setAsking('password')}>
              <KeyRound className="size-4" aria-hidden /> New password
            </button>
          )}
          {off ? (
            <button
              type="button"
              className={link}
              disabled={busy}
              onClick={() =>
                void run(
                  () => updateMember(business.id, member.id, { status: 'active' }),
                  `${member.name}’s login is on.`,
                )
              }
            >
              Turn it back on
            </button>
          ) : (
            <button type="button" className={link} onClick={() => setAsking('off')}>
              Turn off
            </button>
          )}
          <button type="button" className={cn(link, 'text-danger')} onClick={() => setAsking('remove')}>
            Remove
          </button>
        </div>
      )}
      {problem && !asking && <Alert tone="danger" title={problem} />}
      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        {asking && (
          <DialogContent title={ask[asking].title} description={ask[asking].text}>
            <div className="flex flex-col gap-4">
              {problem && <Alert tone="danger" title={problem} />}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <DialogClose asChild>
                  <Button variant="secondary">Keep it as it is</Button>
                </DialogClose>
                <Button
                  variant={asking === 'password' ? 'primary' : 'danger'}
                  loading={busy}
                  onClick={() => void ask[asking].go()}
                >
                  {ask[asking].button}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </li>
  );
}

const link =
  'inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-ink underline-offset-4 hover:underline disabled:opacity-50';
