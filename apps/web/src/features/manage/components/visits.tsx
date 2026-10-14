'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, CircleSlash, Clock, LogIn, UserX, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { cn } from '@/lib/cn';
import { duration, money } from '@/lib/format';
import type { TeamRole } from '../api';
import {
  actionsFor,
  dayLabel,
  STAGE_LABEL,
  stageOf,
  type Stage,
  type Visit,
  type VisitAction,
} from '../visits';
import {
  allVisitsKey,
  cancelVisit,
  checkInVisit,
  completeVisit,
  confirmVisit,
  declineVisit,
  noShowVisit,
} from '../visits-api';

const STAGE_TONE: Record<Stage, 'neutral' | 'brand' | 'ok' | 'wait' | 'danger' | 'outline'> = {
  to_confirm: 'wait',
  booked: 'neutral',
  here: 'brand',
  done: 'ok',
  missed: 'danger',
  cancelled: 'outline',
  moved: 'outline',
};

export function StageBadge({ visit }: { visit: Visit }) {
  const stage = stageOf(visit);
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

const ACTION: Record<VisitAction, { label: string; done: (name: string) => string; icon: ReactNode }> = {
  check_in: { label: 'Check in', done: (n) => `${n} is checked in.`, icon: <LogIn aria-hidden /> },
  complete: { label: 'Mark done', done: (n) => `${n}’s visit is done.`, icon: <CheckCircle2 aria-hidden /> },
  confirm: {
    label: 'Confirm',
    done: (n) => `${n}’s booking is confirmed; they’ve been told.`,
    icon: <Check aria-hidden />,
  },
  decline: {
    label: 'Decline',
    done: (n) => `${n}’s request is declined; they’ve been told.`,
    icon: <X aria-hidden />,
  },
  no_show: {
    label: 'Didn’t come',
    done: (n) => `${n} is marked as not having come.`,
    icon: <UserX aria-hidden />,
  },
  cancel: {
    label: 'Cancel booking',
    done: (n) => `${n}’s booking is cancelled; they’ve been told.`,
    icon: <CircleSlash aria-hidden />,
  },
};

/** Runs one action on a visit, refreshes every list of this business's visits, and says what happened. */
export function useVisitAction(businessId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<VisitAction | null>(null);
  const [problem, setProblem] = useState<Problem | undefined>();
  const run = async (visit: Visit, action: VisitAction, reason?: string): Promise<boolean> => {
    setBusy(action);
    setProblem(undefined);
    try {
      if (action === 'check_in') await checkInVisit(businessId, visit.id);
      else if (action === 'complete') await completeVisit(businessId, visit.id);
      else if (action === 'confirm') await confirmVisit(businessId, visit.id);
      else if (action === 'decline') await declineVisit(businessId, visit.id, reason);
      else if (action === 'no_show') await noShowVisit(businessId, visit.id);
      else await cancelVisit(businessId, visit.id, reason ?? '');
      await queryClient.invalidateQueries({ queryKey: allVisitsKey(businessId) });
      toast.success(ACTION[action].done(visit.customer.name));
      return true;
    } catch (err) {
      setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
      await queryClient.invalidateQueries({ queryKey: allVisitsKey(businessId) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, problem, clearProblem: () => setProblem(undefined) };
}

/** The one thing most worth doing next with a visit, shown on its row. */
const PRIMARY: VisitAction[] = ['check_in', 'complete', 'confirm'];

/** One visit in a list: when, who, what, where it stands, and the next step. */
export function VisitRow({
  visit,
  businessId,
  role,
  today,
  now,
  showDate = false,
}: {
  visit: Visit;
  businessId: string;
  role: TeamRole;
  today: string;
  now: number;
  showDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const act = useVisitAction(businessId);
  const actions = actionsFor(visit, role, now);
  const primary = PRIMARY.find((a) => actions.includes(a));
  const stage = stageOf(visit);
  const past = stage === 'cancelled' || stage === 'moved';
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line sm:flex-row sm:items-center sm:gap-5',
        past && 'bg-sunken/60 shadow-none',
      )}
    >
      <div className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:gap-0.5">
        {showDate && (
          <span className="text-sm font-medium text-ink-2">{dayLabel(visit.local.date, today)}</span>
        )}
        <span
          className={cn(
            'tabular text-lg font-semibold tracking-[-0.01em]',
            past && 'text-ink-2 line-through',
          )}
        >
          {visit.local.startTime}
        </span>
        <span className="tabular text-sm text-ink-3">to {visit.local.endTime}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-base font-semibold text-ink">{visit.customer.name}</h3>
          <StageBadge visit={visit} />
        </div>
        <p className="text-sm text-ink-2">
          {visit.service.name}
          {visit.staff && <> · with {visit.staff.displayName}</>}
          <span className="text-ink-3"> · </span>
          <span className="font-mono text-[0.8rem] tracking-wide">{visit.code}</span>
        </p>
        {visit.customer.reliability && stage !== 'done' && !past && (
          <p className="text-sm text-ink-3">{visit.customer.reliability.label}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {primary && (
          <Button
            size="sm"
            variant={primary === 'check_in' ? 'primary' : 'secondary'}
            loading={act.busy === primary}
            onClick={() => void act.run(visit, primary)}
          >
            {ACTION[primary].icon}
            {ACTION[primary].label}
            <span className="sr-only"> {visit.customer.name}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Details
          <span className="sr-only">
            {' '}
            for {visit.customer.name} at {visit.local.startTime}
          </span>
        </Button>
      </div>
      {act.problem && !open && (
        <Alert tone="danger" title={act.problem.title} className="sm:basis-full">
          {act.problem.detail}
        </Alert>
      )}
      <VisitDetails
        visit={visit}
        businessId={businessId}
        role={role}
        today={today}
        now={now}
        open={open}
        onOpenChange={setOpen}
      />
    </li>
  );
}

/** Everything about one visit, and every step that can be taken with it now. */
export function VisitDetails({
  visit,
  businessId,
  role,
  today,
  now,
  open,
  onOpenChange,
}: {
  visit: Visit;
  businessId: string;
  role: TeamRole;
  today: string;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const act = useVisitAction(businessId);
  const [asking, setAsking] = useState<'cancel' | 'decline' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const actions = actionsFor(visit, role, now);
  const close = (next: boolean) => {
    if (!next) {
      setAsking(null);
      setReason('');
      setReasonError(undefined);
      act.clearProblem();
    }
    onOpenChange(next);
  };
  const go = async (action: VisitAction) => {
    if (action === 'cancel' || action === 'decline') {
      const text = reason.trim();
      if (action === 'cancel' && text.length < 3) {
        setReasonError('Say why, in a few words: the customer is told.');
        return;
      }
      if (await act.run(visit, action, text || undefined)) close(false);
      return;
    }
    if (await act.run(visit, action)) close(false);
  };

  const rows: [string, ReactNode][] = [
    ['When', `${dayLabel(visit.local.date, today)}, ${visit.local.startTime}–${visit.local.endTime}`],
    ['Service', `${visit.service.name} (${duration(visit.service.durationMinutes)})`],
    ['With', visit.staff?.displayName ?? 'Anyone free'],
    ['Price', `${money(visit.price, visit.currency)}, paid here`],
    [
      'Code',
      <span key="code" className="font-mono tracking-wide">
        {visit.code}
      </span>,
    ],
  ];
  if (visit.customer.reliability) rows.push(['Reliability', visit.customer.reliability.label]);
  if (visit.checkedInAt) {
    rows.push([
      'Arrived',
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: visit.local.timezone,
      }).format(new Date(visit.checkedInAt)),
    ]);
  }
  if (visit.cancellation?.reason) rows.push(['Why cancelled', visit.cancellation.reason]);

  const steps = actions.filter((a) => a !== 'cancel' && a !== 'decline');
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title={visit.customer.name} description={<StageBadge visit={visit} />}>
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[0.95rem]">
            {rows.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-ink-2">{term}</dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {visit.notes && (
            <div className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
              <p className="text-sm font-medium text-ink-2">Their note</p>
              <p className="text-[0.95rem] text-ink">{visit.notes}</p>
            </div>
          )}
          {act.problem && (
            <Alert tone="danger" title={act.problem.title}>
              {act.problem.detail}
            </Alert>
          )}
          {asking ? (
            <div className="flex flex-col gap-3 rounded-xl ring-1 ring-line p-4">
              <Field
                label={asking === 'cancel' ? 'Why are you cancelling?' : 'Anything to tell them?'}
                hint={
                  asking === 'cancel'
                    ? 'The customer sees this. Cancelling counts against your business’s reliability.'
                    : 'The customer sees this.'
                }
                error={reasonError}
                required={asking === 'cancel'}
              >
                <Textarea
                  value={reason}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReasonError(undefined);
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" loading={act.busy === asking} onClick={() => void go(asking)}>
                  {asking === 'cancel' ? 'Cancel the booking' : 'Decline the request'}
                </Button>
                <Button variant="ghost" onClick={() => setAsking(null)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            (steps.length > 0 || actions.includes('cancel') || actions.includes('decline')) && (
              <div className="flex flex-wrap gap-2">
                {steps.map((a) => (
                  <Button
                    key={a}
                    variant={a === 'check_in' || a === 'confirm' ? 'primary' : 'secondary'}
                    loading={act.busy === a}
                    onClick={() => void go(a)}
                  >
                    {ACTION[a].icon}
                    {ACTION[a].label}
                  </Button>
                ))}
                {actions.includes('decline') && (
                  <Button variant="ghost" onClick={() => setAsking('decline')}>
                    {ACTION.decline.icon}
                    Decline
                  </Button>
                )}
                {actions.includes('cancel') && (
                  <Button variant="ghost" onClick={() => setAsking('cancel')}>
                    {ACTION.cancel.icon}
                    Cancel booking
                  </Button>
                )}
              </div>
            )
          )}
          {stageOf(visit) === 'booked' &&
            !actions.includes('check_in') &&
            now < Date.parse(visit.startAt) && (
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Clock aria-hidden className="size-4" />
                Check-in opens 2 hours before the start.
              </p>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
