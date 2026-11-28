'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { HeldDot } from '@/components/brand/held-dot';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import { fetchMine, MINE_KEY } from '@/features/manage/api';
import { MyBusinesses } from '@/features/manage/components/my-businesses';

/**
 * Right after signing in, when nothing asked for a page: the person's own place. Someone with one
 * business goes straight to its workspace; someone with several picks one (or books something for
 * themself); everyone else goes home, which is theirs once signed in. If the businesses can't be
 * read, home: it works without them.
 */
export function StartHere() {
  const router = useRouter();
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: fetchMine });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });

  const only = mine.data?.length === 1 ? mine.data[0] : undefined;
  const go: string | null =
    mine.isError || mine.data?.length === 0 ? '/' : only ? `/business/${only.id}` : null;
  useEffect(() => {
    if (go) router.replace(go as Route);
  }, [go, router]);

  if (mine.isPending || go) {
    return (
      <p role="status" className="type-heading py-16 text-ink-2">
        Opening BUKU
        <HeldDot />
      </p>
    );
  }

  const first = me.data?.name.split(' ')[0];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="type-app-title">
          {first ? `Where to, ${first}?` : 'Where to?'}
          <HeldDot />
        </h1>
        <p className="max-w-[52ch] text-lg text-ink-2">
          Open one of your businesses, or find a place to book for yourself.
        </p>
      </div>
      <MyBusinesses />
      <Link
        href="/"
        className="group flex max-w-3xl items-center gap-4 rounded-xl bg-sunken p-4 ring-1 ring-line transition-[box-shadow] duration-300 hover:ring-control sm:p-5"
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-surface text-ink-2">
          <Search className="size-6" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">For yourself</span>
          <span className="text-sm text-ink-3">Find a place near you, book a time or take a number.</span>
        </span>
      </Link>
    </div>
  );
}
