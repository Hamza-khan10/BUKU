'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CleanTextarea } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { StarInput } from '@/components/ui/star-input';
import { toast } from '@/components/ui/toaster';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { fetchReceipt, RECEIPT_KEY } from '@/features/booking/api';
import { dayParts } from '@/features/booking/choices';
import { useMinute } from '@/features/booking/notice';
import type { Receipt } from '@/features/booking/types';
import { ApiError } from '@/lib/api/errors';
import { createReview, deleteReview, fetchMyReviews, MY_REVIEWS_KEY, updateReview } from '../api';
import {
  DETAILS,
  REVIEW_EDIT_DAYS,
  REVIEW_WINDOW_DAYS,
  reviewable,
  reviewerName,
  STAR_WORDS,
} from '../rules';
import type { MyReview, Ratings } from '../types';
import { possessive } from '@/lib/format';

const COMMENT = zText({ kind: 'text', max: 2000 });

/** "6 Oct" — when a review can last be changed. */
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

/**
 * Reviewing a visit: the overall stars (needed), four optional details, and
 * words. Says exactly how it will appear — first name and initial, the month
 * of the visit — that the business can reply, and that phone numbers and
 * emails are removed. Editable for 7 days; deletable any time.
 */
export function ReviewPage({ appointmentId }: { appointmentId: string }) {
  const receipt = useQuery({
    queryKey: RECEIPT_KEY(appointmentId),
    queryFn: () => fetchReceipt(appointmentId),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const mine = useQuery({ queryKey: MY_REVIEWS_KEY, queryFn: () => fetchMyReviews() });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const minute = useMinute();

  if (receipt.isPending || mine.isPending || minute === null) {
    return <Skeleton className="h-80 max-w-xl" />;
  }
  if (receipt.error || mine.error) {
    const e =
      (receipt.error ?? mine.error) instanceof ApiError ? ((receipt.error ?? mine.error) as ApiError) : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this visit' : 'We couldn’t load this visit'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.status === 404 ? undefined : e?.requestId}
      />
    );
  }

  const r = receipt.data;
  const existing = mine.data.items.find((v) => v.appointmentId === r.id) ?? null;
  const back = (
    <Link
      href={`/appointments/${r.id}` as Route}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden /> Back to the visit
    </Link>
  );

  if (!existing && !reviewable(r, minute)) {
    return (
      <div className="flex max-w-xl flex-col gap-5">
        {back}
        <Alert tone="wait" title="This visit can’t be reviewed">
          Reviews are for visits that happened, up to {REVIEW_WINDOW_DAYS} days afterwards.
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        {back}
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {existing ? 'Your review' : `How was your visit to ${r.business.name}?`}
        </h1>
        <p className="text-ink-2">
          {r.service.name}
          {r.staff && ` with ${r.staff.displayName}`}, {dayParts(r.local.date).label}.
        </p>
      </header>
      <ReviewForm receipt={r} existing={existing} author={me.data ? reviewerName(me.data.name) : null} />
    </div>
  );
}

function ReviewForm({
  receipt: r,
  existing,
  author,
}: {
  receipt: Receipt;
  existing: MyReview | null;
  author: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const locked = Boolean(existing && !existing.canEdit);
  const [ratings, setRatings] = useState<Ratings>(existing?.rating ?? { overall: 0 });
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [errors, setErrors] = useState<{ overall?: string; comment?: string; form?: Problem }>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = comment.trim();
    const parsed = trimmed ? COMMENT.safeParse(trimmed) : null;
    const found = {
      overall: ratings.overall ? undefined : 'Choose how many stars for the visit overall.',
      comment: parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined,
    };
    setErrors(found);
    if (found.overall || found.comment) return;

    setBusy(true);
    try {
      const input = { ...ratings, comment: parsed?.success ? parsed.data : undefined };
      await (existing ? updateReview(r.id, input) : createReview(r.id, input));
      await queryClient.invalidateQueries({ queryKey: MY_REVIEWS_KEY });
      toast.success(
        existing
          ? 'Your review is updated.'
          : `Thank you — your review is on ${possessive(r.business.name)} page.`,
      );
      router.push('/account/reviews');
    } catch (err) {
      setBusy(false);
      const e = err instanceof ApiError ? err : null;
      if (e?.code === 'REVIEW_EXISTS') {
        await queryClient.invalidateQueries({ queryKey: MY_REVIEWS_KEY });
        setErrors({
          form: {
            title: 'You’ve already reviewed this visit.',
            detail: 'It’s shown below — you can change it there.',
          },
        });
      } else if (e?.code === 'REVIEW_LOCKED') {
        await queryClient.invalidateQueries({ queryKey: MY_REVIEWS_KEY });
        setErrors({ form: { title: `Reviews can be changed for ${REVIEW_EDIT_DAYS} days after posting.` } });
      } else {
        const issue = e?.fieldIssues.find((i) => i.path === 'comment');
        setErrors(
          issue
            ? { comment: issue.message }
            : { form: problemFrom(err, 'Saving your review didn’t work. Please try again.') },
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {errors.form && (
        <Alert tone="danger" title={errors.form.title}>
          {errors.form.detail && <p>{errors.form.detail}</p>}
          {errors.form.reference && <p className="font-mono text-xs">Reference: {errors.form.reference}</p>}
        </Alert>
      )}
      {locked && existing && (
        <Alert title={`Reviews can be changed for ${REVIEW_EDIT_DAYS} days after posting`}>
          This one was posted on {shortDate(existing.createdAt)}. You can still delete it.
        </Alert>
      )}

      <fieldset
        disabled={locked}
        aria-label="Your ratings and words"
        className="flex flex-col gap-6 disabled:opacity-80"
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Overall</p>
          <StarInput
            label="Overall"
            words={STAR_WORDS}
            value={ratings.overall || undefined}
            onChange={(overall) => setRatings((v) => ({ ...v, overall }))}
            invalid={Boolean(errors.overall)}
          />
          {errors.overall && <p className="text-sm font-medium text-danger">{errors.overall}</p>}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <p className="text-sm font-medium text-ink">
            In more detail <span className="font-normal text-ink-3">(optional)</span>
          </p>
          {DETAILS.map(({ key, label }) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink-2">{label}</span>
              <div className="flex items-center gap-2">
                <StarInput
                  label={label}
                  words={STAR_WORDS}
                  size="sm"
                  value={ratings[key]}
                  onChange={(n) => setRatings((v) => ({ ...v, [key]: n }))}
                />
                {ratings[key] !== undefined && !locked && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRatings((v) => ({ ...v, [key]: undefined }))}
                  >
                    Clear<span className="sr-only"> {label.toLowerCase()}</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <Field
          label="Your words"
          hint="What went well, what could be better. Phone numbers and email addresses are removed."
          error={errors.comment}
        >
          <CleanTextarea
            kind="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            rows={5}
          />
        </Field>
      </fieldset>

      <p className="text-sm text-ink-3">
        Shown on {possessive(r.business.name)} page as{' '}
        <span className="font-medium text-ink-2">“{author ?? 'your first name and initial'}”</span> with the
        month of your visit, never your full name. {r.business.name} can reply publicly.
        {!existing && ` You can change it for ${REVIEW_EDIT_DAYS} days, and delete it any time.`}
      </p>

      <div className="flex flex-wrap gap-3">
        {!locked && (
          <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>
            {existing ? 'Save changes' : 'Post review'}
          </Button>
        )}
        {existing && <DeleteReview appointmentId={r.id} businessName={r.business.name} />}
      </div>
    </div>
  );
}

function DeleteReview({ appointmentId, businessName }: { appointmentId: string; businessName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteReview(appointmentId);
      await queryClient.invalidateQueries({ queryKey: MY_REVIEWS_KEY });
      toast('Your review is deleted.');
      router.push('/account/reviews');
    } catch (err) {
      setBusy(false);
      setError(problemFrom(err, 'Deleting didn’t work. Please try again.').title);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="lg">
          Delete review
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Delete your review?"
        description={`It disappears from ${possessive(businessName)} page, along with any reply.`}
      >
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger" title={error} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Delete review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
