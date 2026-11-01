import type { Metadata, Route } from 'next';
import { MessageSquareOff, Star } from 'lucide-react';
import { Empty } from '@admin/components/empty';
import { RowActions, type RowAction } from '@admin/components/row-actions';
import { Tabs } from '@admin/components/tabs';
import { Initials, Notice, PageTitle, Pill, beat, cx } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';
import { reportOf, type AdminReview } from '@admin/lib/reviews';

export const metadata: Metadata = { title: 'Reviews' };

const VIEWS = [
  { value: 'reported', label: 'Reported' },
  { value: 'hidden', label: 'Hidden' },
] as const;

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

function stepsFor(r: AdminReview): RowAction[] {
  const base = `/api/reviews/${r.id}` as const;
  if (!r.visible) return [{ path: `${base}/restore`, label: 'Put it back', tone: 'primary' }];
  return [
    { path: `${base}/keep`, label: 'Keep it', tone: 'secondary' },
    {
      path: `${base}/hide`,
      label: 'Hide',
      tone: 'danger-quiet',
      reason: 'Why hide it? Kept with the review and in the audit log; it stops showing and counting.',
      reasonMax: 300,
    },
  ];
}

/**
 * Reviews businesses reported (3.6g): read what was written and why it was reported, then hide it
 * (stored, but no longer shown or counted in the rating) or keep it. Hidden ones can be put back.
 */
export default async function ReviewsPage({ searchParams }: PageProps<'/reviews'>) {
  const gate = await requireAdmin('/reviews');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const query = await searchParams;
  const view = VIEWS.find((v) => v.value === query.view)?.value ?? 'reported';
  const list = await callApi<AdminReview[]>({
    path: `/v1/admin/reviews?status=${view}&limit=50`,
    accessToken: gate.accessToken,
    incoming: gate.incoming,
    requestId: gate.requestId,
  });

  return (
    <>
      <PageTitle
        title="Reviews"
        description="Reviews a business reported as fake, offensive or private. Hide one that breaks the rules: it stays stored, but stops showing and counting in the rating."
      />
      <Tabs
        label="Which reviews"
        items={VIEWS.map((v) => ({
          href: `/reviews?view=${v.value}` as Route,
          label: v.label,
          current: v.value === view,
        }))}
      />
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message}>
          {list.requestId && <span className="font-mono text-xs">Reference: {list.requestId}</span>}
        </Notice>
      ) : list.data.length === 0 ? (
        <Empty
          icon={MessageSquareOff}
          title="Nothing here"
          text={view === 'reported' ? 'No review is waiting for a decision.' : 'No review is hidden.'}
        />
      ) : (
        <ul aria-label="Reviews" className="flex flex-col gap-4">
          {list.data.map((r, i) => {
            const report = reportOf(r.report.reason);
            return (
              <li
                key={r.id}
                style={beat(i + 1)}
                className={cx('panel rise flex flex-col gap-4 p-4 sm:p-5', !r.visible && 'border-danger/40')}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Initials name={r.business.name} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        {r.business.name}
                        {r.visible ? <Pill tone="wait">Reported</Pill> : <Pill tone="danger">Hidden</Pill>}
                      </p>
                      <p className="text-xs text-ink-3">
                        <span className="font-mono">{r.business.id}</span> · review{' '}
                        <span className="font-mono">{r.id}</span>
                      </p>
                    </div>
                  </div>
                  <RowActions subject={`review of ${r.business.name} by ${r.author}`} actions={stepsFor(r)} />
                </div>

                <div className="flex flex-col gap-2 rounded-xl bg-sunken/60 p-4 ring-1 ring-line ring-inset">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="flex items-center gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          strokeWidth={1.8}
                          className={cx(
                            'size-4',
                            n <= r.rating.overall ? 'fill-spark text-spark' : 'text-line-strong',
                          )}
                        />
                      ))}
                    </span>
                    <span className="font-semibold text-ink">{r.rating.overall} of 5</span>
                    <span className="text-ink-2">
                      {r.author}
                      {r.service && <> · {r.service}</>}
                      {r.staff && <> with {r.staff}</>}
                      {r.visitedIn && <> · visited {r.visitedIn}</>}
                    </span>
                  </p>
                  {r.comment ? (
                    <p className="max-w-prose text-[0.95rem] leading-relaxed text-ink">“{r.comment}”</p>
                  ) : (
                    <p className="text-sm text-ink-3">Stars only, no words.</p>
                  )}
                  <p className="text-xs text-ink-3">
                    Posted {day(r.createdAt)}
                    {r.edited && ' · edited'}
                  </p>
                  {r.response && (
                    <div className="mt-1 border-l-2 border-line-strong pl-3 text-sm text-ink-2">
                      <span className="font-medium text-ink">The business replied:</span> “{r.response.text}”
                    </div>
                  )}
                </div>

                {r.visible && r.report.at && (
                  <p className="text-sm text-ink-2">
                    <span className="font-semibold text-wait">{report.reason}</span>
                    {report.note && <> · “{report.note}”</>}
                    <span className="text-ink-3"> · reported {day(r.report.at)}</span>
                  </p>
                )}
                {r.hidden && (
                  <p className="text-sm text-ink-2">
                    <span className="font-semibold text-danger">Hidden {day(r.hidden.at)}</span>
                    {r.hidden.reason && <> · “{r.hidden.reason}”</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
