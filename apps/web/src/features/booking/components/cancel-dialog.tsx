'use client';

import { zText } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import { RadioGroup } from 'radix-ui';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextarea } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toaster';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { cancelVisit, RECEIPT_KEY, RELIABILITY_KEY, type CancelReason } from '../api';
import { clockLabel, dayParts } from '../choices';
import type { Receipt } from '../types';
import { choiceCard } from './step';

/** The API's reasons, in words people use. */
export const CANCEL_REASONS: { value: CancelReason; label: string }[] = [
  { value: 'schedule_conflict', label: 'Something else came up' },
  { value: 'illness', label: 'I’m unwell' },
  { value: 'found_alternative', label: 'I found another time or place' },
  { value: 'not_needed', label: 'I don’t need it any more' },
  { value: 'too_expensive', label: 'It costs more than I expected' },
  { value: 'other', label: 'Another reason' },
];

/** How many days until the "book again?" reminder (the API's REBOOK_REMINDER_DAYS). */
const REMINDER_DAYS = 3;

const NOTE = zText({ kind: 'text', max: 500 });

/**
 * Cancelling a visit. Says plainly when it counts as late (inside the
 * business's notice period), asks why in a sentence, and offers one reminder
 * to book again. "Keep my visit" is as easy as cancelling — no guilt.
 */
export function CancelDialog({ receipt }: { receipt: Receipt }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [remind, setRemind] = useState(false);
  const [errors, setErrors] = useState<{ reason?: string; note?: string; form?: Problem }>({});
  const [busy, setBusy] = useState(false);
  // Moving is allowed only before the notice period; past it, a cancellation is late.
  const late = !receipt.policy.canReschedule;

  const submit = async () => {
    const trimmed = note.trim();
    const parsedNote = trimmed ? NOTE.safeParse(trimmed) : null;
    const found = {
      reason: reason ? undefined : 'Choose the reason that fits best.',
      note: parsedNote && !parsedNote.success ? parsedNote.error.issues[0]?.message : undefined,
    };
    setErrors(found);
    if (!reason || found.note) return;

    setBusy(true);
    try {
      const updated = await cancelVisit(receipt.id, {
        reasonCode: reason,
        ...(parsedNote?.success && { note: parsedNote.data }),
        ...(remind && { bookLater: true }),
      });
      queryClient.setQueryData(RECEIPT_KEY(receipt.id), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visits'] }),
        queryClient.invalidateQueries({ queryKey: RELIABILITY_KEY }),
      ]);
      setOpen(false);
      toast.success(
        remind
          ? `Visit cancelled. We’ll remind you in ${REMINDER_DAYS} days to book again.`
          : 'Visit cancelled.',
      );
    } catch (err) {
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'note') : undefined;
      setErrors(
        issue
          ? { note: issue.message }
          : { form: problemFrom(err, 'Cancelling didn’t work. Please try again.') },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Cancel visit</Button>
      </DialogTrigger>
      <DialogContent
        title="Cancel this visit?"
        description={`${receipt.service.name} at ${receipt.business.name}, ${dayParts(receipt.local.date).label} at ${clockLabel(receipt.local.startTime)}.`}
      >
        <div className="flex flex-col gap-5">
          {late && (
            <Alert tone="wait" title="This counts as a late cancellation">
              It’s inside {receipt.business.name}’s notice period. Late cancellations count half towards how
              reliably you keep bookings; cancelling earlier never counts at all.
            </Alert>
          )}
          {errors.form && (
            <Alert tone="danger" title={errors.form.title}>
              {errors.form.reference && (
                <p className="font-mono text-xs">Reference: {errors.form.reference}</p>
              )}
            </Alert>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">Why are you cancelling?</legend>
            <RadioGroup.Root
              value={reason ?? ''}
              onValueChange={(v) => setReason(v as CancelReason)}
              aria-label="Why are you cancelling?"
              aria-invalid={Boolean(errors.reason)}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {CANCEL_REASONS.map((r) => (
                <RadioGroup.Item key={r.value} value={r.value} className={choiceCard}>
                  <span className="text-sm text-ink">{r.label}</span>
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
            {errors.reason && <p className="text-sm font-medium text-danger">{errors.reason}</p>}
          </fieldset>

          <Field label="Note for the business" hint="They see it with the cancellation." error={errors.note}>
            <CleanTextarea
              kind="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </Field>

          <Checkbox
            label={`Remind me in ${REMINDER_DAYS} days to book again`}
            description="Just one reminder."
            checked={remind}
            onCheckedChange={(v) => setRemind(v === true)}
          />

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep my visit</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void submit()}>
              Cancel visit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
