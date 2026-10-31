'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Check,
  ExternalLink,
  Pause,
  Play,
  Power,
  Star,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { PageHeading } from '@/components/ui/layout';
import { LiveDot } from '@/components/ui/live-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { useLiveQueue } from '@/features/queue/use-live-queue';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { can, fetchManaged, managedKey, type ManagedBusiness } from '../api';
import {
  canWork,
  entryActions,
  noShowAllowed,
  sessionActions,
  sessionLabel,
  waited,
  type BoardEntry,
  type EntryAction,
  type QueueBoard,
  type SessionAction,
} from '../queue';
import {
  addWalkIn,
  callNext,
  changeSession,
  entryStep,
  fetchBoard,
  queueKey,
  setPriority,
} from '../queue-api';
import { useNow } from './today';

const NAME = zText({ kind: 'personName', min: 1, max: 100 });

/** /business/[id]/queue: the business loaded first; anyone on the team may look, the desk may act. */
export function QueuePage({ id }: { id: string }) {
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (business.isPending) return <Skeleton className="h-80 max-w-4xl" />;
  if (business.isError) {
    const e = business.error instanceof ApiError ? business.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this business' : 'We couldn’t load this business'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.requestId}
      />
    );
  }
  return <QueueBoardView business={business.data} />;
}

/**
 * The front desk's queue (3.5c): open it for the day, call people up, serve them, add walk-ins,
 * put someone in the priority lane, pause it or close it. It follows the queue live — a change on
 * another tablet, or a customer joining from their phone, shows here within a second — and
 * refreshes itself every half minute in case the live link drops.
 */
function QueueBoardView({ business }: { business: ManagedBusiness }) {
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const operator = can(business.myRole, 'queue.operate');
  const board = useQuery({
    queryKey: queueKey(business.id),
    queryFn: () => fetchBoard(business.id),
    refetchInterval: 30_000,
  });
  // The public stream says when anything changed (ticket numbers only); the board then reloads
  // its own view, with names, from the API.
  const live = useLiveQueue(business.slug);
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    const seen = live.state ? JSON.stringify(live.state) : null;
    if (seen === null || seen === lastState.current) return;
    const first = lastState.current === null;
    lastState.current = seen;
    if (!first) void queryClient.invalidateQueries({ queryKey: queueKey(business.id) });
  }, [live.state, queryClient, business.id]);

  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | undefined>();
  /** Runs one step, reloads the board, says what happened (or why it didn't). */
  const run = async (key: string, step: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setProblem(undefined);
    try {
      await step();
      toast.success(done);
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
    } finally {
      await queryClient.invalidateQueries({ queryKey: queueKey(business.id) });
      setBusy(null);
    }
  };

  const heading = (
    <PageHeading
      compact
      eyebrow={business.name}
      title="Queue"
      description="The walk-in line, live: call people up, serve them, and add people who come in without a phone."
    />
  );

  if (board.isError) {
    const e = board.error instanceof ApiError ? board.error : null;
    return (
      <div className="flex max-w-4xl flex-col gap-8">
        {heading}
        <ErrorState
          title="The queue isn’t loading"
          message={e?.message ?? 'Please try again in a moment.'}
          reference={e?.requestId}
        />
      </div>
    );
  }
  if (board.isPending) {
    return (
      <div className="flex max-w-4xl flex-col gap-8">
        {heading}
        <Skeleton className="h-28" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  const data = board.data;
  const status = data.session?.status ?? null;
  const working = canWork(status);
  const first = data.waiting[0];

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      {heading}
      <SessionBar
        board={data}
        live={live.live}
        operator={operator}
        busy={busy}
        onChange={(action) =>
          void run(`session:${action}`, () => changeSession(business.id, action), SESSION_DONE[action])
        }
      />
      <ProblemAlert problem={problem} />
      {!operator && (
        <p className="text-ink-2">
          You can follow the queue here. Calling people and adding walk-ins is for the owner, managers and the
          front desk.
        </p>
      )}

      {operator && working && (
        <div className="flex flex-col gap-4 rounded-xl bg-brand-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-2">Next in line</p>
            <p className="text-xl font-semibold text-ink">
              {first ? (
                <>
                  <span className="tabular font-mono">{first.ticket}</span>
                  {first.name && <span className="text-ink-2"> · {first.name}</span>}
                </>
              ) : (
                'Nobody is waiting'
              )}
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            disabled={!first || busy !== null}
            onClick={() =>
              void run(
                'call-next',
                () => callNext(business.id),
                first ? `${first.ticket} is called. Their phone tells them.` : 'Called.',
              )
            }
          >
            <BellRing aria-hidden />
            Call next
          </Button>
        </div>
      )}

      <Lane
        title="Being served"
        entries={data.serving}
        empty="Nobody is being served right now."
        render={(e) => (
          <EntryRow
            key={e.id}
            entry={e}
            now={now}
            operator={operator}
            busy={busy}
            onStep={(action) =>
              void run(`${e.id}:${action}`, () => entryStep(business.id, e.id, action), stepDone(action, e))
            }
          />
        )}
      />
      <Lane
        title="Called"
        entries={data.called}
        empty="Nobody has been called and not come up yet."
        render={(e) => (
          <EntryRow
            key={e.id}
            entry={e}
            now={now}
            operator={operator}
            busy={busy}
            onStep={(action) =>
              void run(`${e.id}:${action}`, () => entryStep(business.id, e.id, action), stepDone(action, e))
            }
          />
        )}
      />
      <Lane
        title="Waiting"
        entries={data.waiting}
        ordered
        empty={
          status === 'open'
            ? 'Nobody is waiting. People can join from the business’s page, nearby.'
            : 'Nobody is waiting.'
        }
        render={(e) => (
          <EntryRow
            key={e.id}
            entry={e}
            now={now}
            operator={operator}
            busy={busy}
            onStep={(action) =>
              void run(`${e.id}:${action}`, () => entryStep(business.id, e.id, action), stepDone(action, e))
            }
            onPriority={(priority) =>
              void run(
                `${e.id}:priority`,
                () => setPriority(business.id, e.id, priority),
                priority
                  ? `${e.ticket} is in the priority lane.`
                  : `${e.ticket} is back in the regular line.`,
              )
            }
          />
        )}
      />

      {operator && working && <WalkInForm businessId={business.id} />}

      <p className="text-sm text-ink-2">
        <Link
          href={`/b/${business.slug}/screen` as Route}
          target="_blank"
          className="inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          Open the waiting-room screen
          <ExternalLink aria-hidden className="size-4" />
        </Link>{' '}
        — ticket numbers only, for a TV or tablet people can see. It needs no sign-in.
      </p>
    </div>
  );
}

const SESSION_DONE: Record<SessionAction, string> = {
  open: 'The queue is open. People nearby can join from your page.',
  pause: 'Paused: nobody new can join. You can still call people.',
  resume: 'The queue is open again.',
  close: 'The queue is closed for today. Everyone still waiting was told.',
};

const SESSION_BUTTON: Record<SessionAction, { label: string; icon: ReactNode }> = {
  open: { label: 'Open the queue', icon: <Play aria-hidden /> },
  pause: { label: 'Pause new joins', icon: <Pause aria-hidden /> },
  resume: { label: 'Take new people again', icon: <Play aria-hidden /> },
  close: { label: 'Close for today', icon: <Power aria-hidden /> },
};

function SessionBar({
  board,
  live,
  operator,
  busy,
  onChange,
}: {
  board: QueueBoard;
  live: boolean;
  operator: boolean;
  busy: string | null;
  onChange: (action: SessionAction) => void;
}) {
  const session = board.session;
  const status = session?.status ?? null;
  const [closing, setClosing] = useState(false);
  const waiting = board.waiting.length;
  const facts = [
    `${waiting} waiting`,
    session ? `${session.totalServed} served today` : null,
    session ? `about ${Math.max(1, session.avgServiceMinutes)} min each` : null,
    `${board.staffOnShift} on shift`,
  ].filter((f): f is string => f !== null);

  return (
    <section
      aria-label="Today’s queue"
      className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-lg font-semibold text-ink">
          {status === 'open' && <LiveDot label="Live" />}
          <span>{sessionLabel(session)}</span>
        </p>
        <p className="tabular text-sm text-ink-2">{facts.join(' · ')}</p>
        {!live && canWork(status) && (
          <p className="text-sm text-ink-3">Reconnecting… the board still refreshes every half minute.</p>
        )}
      </div>
      {operator && (
        <div className="flex flex-wrap gap-2">
          {sessionActions(status).map((action) => (
            <Button
              key={action}
              variant={action === 'open' ? 'primary' : action === 'close' ? 'quiet' : 'secondary'}
              disabled={busy !== null}
              onClick={() =>
                action === 'close' && waiting + board.called.length > 0 ? setClosing(true) : onChange(action)
              }
            >
              {SESSION_BUTTON[action].icon}
              {SESSION_BUTTON[action].label}
            </Button>
          ))}
        </div>
      )}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent
          title="Close the queue for today?"
          description={`${waiting + board.called.length} ${waiting + board.called.length === 1 ? 'person is' : 'people are'} still in line. Their tickets end and their phones tell them the queue has closed.`}
        >
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button>Keep it open</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                setClosing(false);
                onChange('close');
              }}
            >
              Close for today
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Lane({
  title,
  entries,
  empty,
  ordered = false,
  render,
}: {
  title: string;
  entries: BoardEntry[];
  empty: string;
  ordered?: boolean;
  render: (entry: BoardEntry) => ReactNode;
}) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="type-subheading flex items-center gap-2">
        {title}
        <Badge tone={entries.length ? 'brand' : 'neutral'}>{entries.length}</Badge>
      </h2>
      {entries.length === 0 ? (
        <p className="text-ink-2">{empty}</p>
      ) : (
        <List className="flex flex-col gap-2">{entries.map(render)}</List>
      )}
    </section>
  );
}

const STEP: Record<EntryAction, { label: string; icon: ReactNode }> = {
  call: { label: 'Call', icon: <BellRing aria-hidden /> },
  serve: { label: 'Serve now', icon: <Users aria-hidden /> },
  complete: { label: 'Done', icon: <Check aria-hidden /> },
  no_show: { label: 'Didn’t come', icon: <UserX aria-hidden /> },
};

function stepDone(action: EntryAction, e: BoardEntry): string {
  const who = e.name ? `${e.ticket} (${e.name})` : e.ticket;
  if (action === 'call') return `${who} is called. Their phone tells them.`;
  if (action === 'serve') return `${who} is being served.`;
  if (action === 'complete') return `${who} is done.`;
  return `${who} is marked as not having come.`;
}

function EntryRow({
  entry,
  now,
  operator,
  busy,
  onStep,
  onPriority,
}: {
  entry: BoardEntry;
  now: number;
  operator: boolean;
  busy: string | null;
  onStep: (action: EntryAction) => void;
  onPriority?: (priority: boolean) => void;
}) {
  const calledFor = entry.calledAt ? waited(entry.calledAt, now) : null;
  const since =
    entry.status === 'serving' && entry.servedAt
      ? `being served for ${waited(entry.servedAt, now)}`
      : entry.status === 'called' && calledFor
        ? `called ${calledFor === 'just now' ? calledFor : `${calledFor} ago`}`
        : `waiting ${waited(entry.joinedAt, now)}`;
  const actions = entryActions(entry, now);
  const noShowAt =
    entry.status === 'called' && !noShowAllowed(entry, now) && entry.noShowFrom
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
          new Date(entry.noShowFrom),
        )
      : null;
  return (
    <li
      aria-label={entry.name ? `${entry.ticket}, ${entry.name}` : entry.ticket}
      className={cn(
        'flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line sm:flex-row sm:items-center sm:justify-between',
        entry.status === 'called' && 'ring-wait/50',
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className="tabular shrink-0 font-mono text-2xl font-semibold tracking-[-0.02em] text-ink">
          {entry.ticket}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-medium text-ink">{entry.name ?? 'No name given'}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
            <span>{since}</span>
            {entry.priority && (
              <Badge tone="wait">
                <Star aria-hidden className="size-3.5" />
                Priority
              </Badge>
            )}
            {entry.walkIn && <Badge tone="outline">Walk-in</Badge>}
            {entry.joinedRemotely && <Badge tone="outline">Joined from their phone</Badge>}
            {entry.reliability && <Badge tone="neutral">{entry.reliability.label}</Badge>}
          </div>
        </div>
      </div>
      {operator && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {onPriority && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              aria-pressed={entry.priority}
              onClick={() => onPriority(!entry.priority)}
            >
              <Star aria-hidden />
              {entry.priority ? 'Regular line' : 'Priority'}
            </Button>
          )}
          {actions.map((action, i) => (
            <Button
              key={action}
              size="sm"
              variant={i === 0 ? 'primary' : 'secondary'}
              disabled={busy !== null}
              onClick={() => onStep(action)}
            >
              {STEP[action].icon}
              {action === 'serve' && entry.status === 'called' ? 'They’re here' : STEP[action].label}
            </Button>
          ))}
          {noShowAt && <span className="text-sm text-ink-3">Didn’t come: from {noShowAt}</span>}
        </div>
      )}
    </li>
  );
}

/** Someone at the counter without a phone gets a ticket of their own; a name is optional. */
function WalkInForm({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [priority, setPriorityLane] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<BoardEntry | null>(null);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    const n = trimmed ? NAME.safeParse(trimmed) : null;
    if (n && !n.success) {
      setError(n.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setProblem(undefined);
    setBusy(true);
    try {
      const entry = await addWalkIn(businessId, {
        ...(n?.data && { name: n.data }),
        ...(priority && { priority }),
      });
      setMade(entry);
      setName('');
      setPriorityLane(false);
      toast.success(`Ticket ${entry.ticket} added.`);
    } catch (err) {
      setProblem(problemFrom(err, 'The walk-in couldn’t be added. Please try again.'));
    } finally {
      await queryClient.invalidateQueries({ queryKey: queueKey(businessId) });
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="walk-in" className="flex flex-col gap-4">
      <h2 id="walk-in" className="type-subheading">
        Add a walk-in
      </h2>
      <form
        noValidate
        onSubmit={(e) => void add(e)}
        className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6"
      >
        <ProblemAlert problem={problem} />
        {made && (
          <p role="status" className="rounded-lg bg-ok-soft p-3 text-[0.95rem] text-ink">
            Their ticket is <span className="tabular font-mono font-semibold">{made.ticket}</span>. Tell them
            to listen for it.
          </p>
        )}
        <Field
          label="Their name"
          hint="To call them by. Leave it empty if they’d rather not say."
          error={error}
        >
          <CleanTextInput
            kind="personName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Checkbox
          label="Priority lane"
          description="Older people, someone disabled or pregnant: they go ahead of the regular line."
          checked={priority}
          onCheckedChange={(v) => setPriorityLane(v === true)}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={busy}>
            <UserPlus aria-hidden />
            Add to the queue
          </Button>
        </div>
      </form>
    </section>
  );
}
