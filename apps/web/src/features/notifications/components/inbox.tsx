'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useMinute } from '@/features/booking/notice';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { fetchInbox, INBOX_KEY, markAllRead, markRead, removeFromInbox, type InboxItem } from '../api';
import { linkFor } from '../links';
import { ago } from '../time';

function Item({ item, onOpen, onRemove }: { item: InboxItem; onOpen: () => void; onRemove: () => void }) {
  const now = useMinute();
  const href = linkFor(item.data);
  const unread = item.readAt === null;
  const content = (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-2">
        {unread && <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand" />}
        <span className={cn('truncate text-ink', unread ? 'font-semibold' : 'font-medium')}>
          {item.title}
        </span>
        {unread && <span className="sr-only">(unread)</span>}
      </span>
      <span className="text-sm text-ink-2">{item.body}</span>
      {now !== null && <span className="text-xs text-ink-3">{ago(item.createdAt, now)}</span>}
    </span>
  );
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-4',
        unread ? 'border-brand/30 bg-brand-soft/40' : 'border-line bg-surface',
      )}
    >
      {href ? (
        <Link
          href={href as Route}
          onClick={onOpen}
          className="flex min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25"
        >
          {content}
        </Link>
      ) : (
        content
      )}
      <Button
        variant="ghost"
        size="icon"
        className="-my-2 -mr-2 shrink-0"
        onClick={onRemove}
        aria-label={`Remove “${item.title}” from your inbox`}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Every message BUKU has sent this account, newest first: booking updates,
 * reminders, queue alerts, suggestions (if chosen). Opening one marks it read
 * and goes where it leads; nothing is lost by removing one but the copy here.
 */
export function Inbox() {
  const queryClient = useQueryClient();
  const inbox = useInfiniteQuery({
    queryKey: INBOX_KEY,
    queryFn: ({ pageParam }) => fetchInbox(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: INBOX_KEY });

  if (inbox.isPending) {
    return (
      <div role="status" aria-label="Loading your notifications" className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (inbox.isError) {
    const e = inbox.error instanceof ApiError ? inbox.error : null;
    return (
      <ErrorState
        title="We couldn’t load your notifications"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
        action={
          <Button variant="secondary" onClick={() => void inbox.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const items = inbox.data.pages.flatMap((p) => p.items);
  const unread = inbox.data.pages[0]?.meta.unread ?? 0;
  if (items.length === 0) {
    return (
      <EmptyState icon={Bell} title="Nothing here yet">
        Booking updates, reminders and queue alerts show up here.
      </EmptyState>
    );
  }

  const open = (item: InboxItem) => {
    if (item.readAt === null)
      void markRead(item.id)
        .then(refresh)
        .catch(() => undefined);
  };
  const remove = async (item: InboxItem) => {
    try {
      await removeFromInbox(item.id);
      await refresh();
    } catch {
      toast.error('That didn’t work. Please try again.');
    }
  };
  const readAll = async () => {
    try {
      await markAllRead();
      await refresh();
    } catch {
      toast.error('That didn’t work. Please try again.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {unread === 0 ? 'All read.' : `${unread} unread`}
        </p>
        {unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void readAll()}>
            Mark all as read
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <Item item={item} onOpen={() => open(item)} onRemove={() => void remove(item)} />
          </li>
        ))}
      </ul>
      {inbox.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
