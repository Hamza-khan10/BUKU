'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Flag, MessageSquareReply } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select, Textarea, Input } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { Stars } from '@/features/business/components/rating';
import { Summary } from '@/features/business/components/reviews';
import { ApiError } from '@/lib/api/errors';
import { monthLabel } from '@/lib/format';
import { can, fetchManaged, managedKey } from '../api';
import {
  allTeamReviewsKey,
  fetchTeamReviews,
  removeReply,
  replyToReview,
  REPORT_REASONS,
  reportReview,
  teamReviewsKey,
  type ReportReason,
  type TeamReview,
  type TeamReviewFilter,
} from '../reviews-api';

const FILTERS: { value: TeamReviewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unanswered', label: 'Not replied' },
  { value: 'reported', label: 'Reported' },
  { value: 'hidden', label: 'Hidden by BUKU' },
];

/**
 * /business/[id]/reviews (3.5i): what customers wrote, for the owner and managers. Reply (a reply
 * shows under the review on the business's page; the customer is told the first time), change or
 * remove a reply, or report a review that isn't fair play: BUKU's moderators decide.
 */
export function BusinessReviews({ id }: { id: string }) {
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const [filter, setFilter] = useState<TeamReviewFilter>('all');
  const [rating, setRating] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const allowed = business.data ? can(business.data.myRole, 'reviews.respond') : false;
  const list = useQuery({
    queryKey: teamReviewsKey(id, filter, rating, page),
    queryFn: () => fetchTeamReviews(id, filter, rating, page),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (business.isError || list.isError) {
    const e =
      (business.error ?? list.error) instanceof ApiError
        ? ((business.error ?? list.error) as ApiError)
        : null;
    return (
      <ErrorState
        title="We couldn’t load the reviews"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }
  if (!business.data) return <Skeleton className="h-96 max-w-3xl" />;
  if (!allowed)
    return (
      <EmptyState title="Reviews are for the owner and managers">
        Ask them to reply to or report a review.
      </EmptyState>
    );

  const meta = list.data?.meta;
  const count = (f: TeamReviewFilter) => (f === 'all' ? null : meta ? meta.counts[f] : null);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeading
        compact
        eyebrow={business.data.name}
        title="Reviews"
        description="What customers wrote after their visits. Reply where it helps: your reply shows under the review on your page."
      />
      {meta && meta.summary.count > 0 && <Summary summary={meta.summary} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Which reviews"
          className="inline-flex flex-wrap gap-1 rounded-xl bg-sunken p-1"
        >
          {FILTERS.map((f) => {
            const n = count(f.value);
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                }}
                className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                  filter === f.value ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {f.label}
                {n !== null && n > 0 && <span className="ml-1.5 text-xs text-ink-3">{n}</span>}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Stars
          <Select
            value={rating ?? ''}
            onChange={(e) => {
              setRating(e.target.value ? Number(e.target.value) : null);
              setPage(1);
            }}
            className="h-10 w-auto"
          >
            <option value="">Any</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'star' : 'stars'}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : list.data.data.length === 0 ? (
        <EmptyState title={filter === 'all' && !rating ? 'No reviews yet' : 'Nothing here'}>
          {filter === 'all' && !rating
            ? 'After a visit, customers are asked how it went.'
            : 'No review matches this choice.'}
        </EmptyState>
      ) : (
        <ul aria-label="Reviews" className="flex flex-col gap-4">
          {list.data.data.map((r) => (
            <TeamReviewCard key={r.id} id={id} review={r} />
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-ink-3">
          <span>
            Page {meta.page} of {meta.totalPages}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </span>
        </nav>
      )}
    </div>
  );
}

/** A text field's value from a submitted form ("" for anything else). */
function textOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function TeamReviewCard({ id, review: r }: { id: string; review: TeamReview }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'idle' | 'reply' | 'report' | 'remove'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: allTeamReviewsKey(id) });

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode('idle');
      toast.success(done);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const reply = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = textOf(new FormData(e.currentTarget), 'text');
    void run(() => replyToReview(id, r.id, text), r.response ? 'Reply changed.' : 'Reply posted.');
  };
  const report = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const note = textOf(form, 'note');
    void run(
      () => reportReview(id, r.id, form.get('reason') as ReportReason, note || undefined),
      'Reported. BUKU’s moderators will look at it.',
    );
  };

  return (
    <li
      aria-label={`Review by ${r.author}`}
      className={`flex flex-col gap-3 rounded-lg border bg-surface p-5 ${r.visible ? 'border-line' : 'border-line opacity-80'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Stars value={r.rating.overall} />
          <span className="sr-only">{r.rating.overall} out of 5</span>
          <span className="font-medium text-ink">{r.author}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          {!r.visible && (
            <Badge tone="danger">
              <EyeOff aria-hidden className="size-3.5" /> Hidden by BUKU
            </Badge>
          )}
          {r.reported && r.visible && (
            <Badge tone="wait">
              <Flag aria-hidden className="size-3.5" /> Reported
            </Badge>
          )}
          Visited {monthLabel(r.visitedIn)}
          {r.edited && ' · edited'}
        </span>
      </div>
      {(r.service || r.staff) && (
        <p className="text-sm text-ink-3">
          {[r.service, r.staff && `with ${r.staff}`].filter(Boolean).join(' ')}
        </p>
      )}
      {r.comment ? (
        <p className="whitespace-pre-line text-ink-2">{r.comment}</p>
      ) : (
        <p className="text-sm text-ink-3">Stars only, no words.</p>
      )}
      {!r.visible && (
        <p className="text-sm text-ink-2">
          It doesn’t show on your page or count in your rating. Think that’s wrong? Contact BUKU.
        </p>
      )}
      {r.response && mode !== 'reply' && (
        <div className="flex gap-3 rounded-md bg-sunken p-4">
          <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">Your reply</p>
            <p className="whitespace-pre-line text-sm text-ink-2">{r.response.text}</p>
          </div>
        </div>
      )}

      {mode === 'reply' && (
        <form onSubmit={reply} className="flex flex-col gap-3">
          <Field
            label={r.response ? 'Change your reply' : 'Your reply'}
            hint="Shows under the review on your page. Be kind and specific."
          >
            <Textarea
              name="text"
              required
              minLength={2}
              maxLength={1000}
              rows={3}
              defaultValue={r.response?.text ?? ''}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              {r.response ? 'Save the reply' : 'Post the reply'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === 'report' && (
        <form onSubmit={report} className="flex flex-col gap-3 rounded-md bg-sunken p-4">
          <Field label="Why report it?">
            <Select name="reason" required defaultValue="fake">
              {Object.entries(REPORT_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Anything BUKU should know" hint="For example: no booking under that name that day.">
            <Input name="note" maxLength={150} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Report it
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === 'remove' && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-sunken p-4 text-sm">
          <span className="text-ink-2">Remove your reply from your page?</span>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            onClick={() => void run(() => removeReply(id, r.id), 'Reply removed.')}
          >
            Remove it
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode('idle')}>
            Keep it
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {mode === 'idle' && r.visible && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => setMode('reply')}>
            {r.response ? 'Change the reply' : 'Reply'}
            <span className="sr-only"> to {r.author}</span>
          </Button>
          {r.response && (
            <Button variant="ghost" size="sm" onClick={() => setMode('remove')}>
              Remove the reply<span className="sr-only"> to {r.author}</span>
            </Button>
          )}
          {!r.reported && (
            <Button variant="ghost" size="sm" onClick={() => setMode('report')}>
              <Flag aria-hidden /> Report<span className="sr-only"> {r.author}’s review</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
