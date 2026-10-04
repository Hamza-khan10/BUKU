'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, ME_KEY, mustChangePassword, signOut } from '../api';

/** The session is over (signed out elsewhere, expired, account closed) — not a passing hiccup. */
const sessionOver = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * "Sign in", or the signed-in person's menu. Whether someone is signed in is
 * known on the server (no flash); who they are is fetched once and cached.
 * A session that ended elsewhere is cleared here, and "Sign in" comes back.
 */
export function AccountControl({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ended, setEnded] = useState(false);
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    enabled: signedIn && !ended,
    retry: (n, e) => !sessionOver(e) && n < 2,
  });

  useEffect(() => {
    if (!sessionOver(me.error)) return;
    void signOut().then(() => {
      setEnded(true);
      queryClient.removeQueries({ queryKey: ME_KEY });
      router.refresh();
    });
  }, [me.error, queryClient, router]);

  if (!signedIn || ended) {
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <Button asChild size="sm" variant="secondary">
        <Link href={`/signin${next}` as Route}>Sign in</Link>
      </Button>
    );
  }

  if (!me.data) {
    return <Skeleton className="size-9 rounded-full" aria-label="Loading your account" />;
  }

  const user = me.data;
  const first = user.name.split(' ')[0];
  const leave = async () => {
    await signOut();
    queryClient.clear();
    toast('You’re signed out');
    router.replace('/');
    router.refresh();
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 hover:bg-sunken sm:pr-3"
        aria-label={`Account: ${user.name}`}
      >
        <Avatar name={user.name} src={user.avatarUrl} size={34} />
        <span className="hidden max-w-32 truncate text-sm font-medium text-ink sm:inline">{first}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-64 rounded-lg border border-line bg-surface p-1.5 shadow-lift animate-rise"
        >
          <DropdownMenu.Label className="flex flex-col px-3 py-2">
            <span className="font-medium text-ink">{user.name}</span>
            {user.email && <span className="truncate text-sm text-ink-3">{user.email}</span>}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {mustChangePassword(user) && (
            <DropdownMenu.Item asChild>
              <Link
                href="/signin/new-password"
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-brand-ink outline-none data-[highlighted]:bg-sunken"
              >
                <KeyRound className="size-4" aria-hidden /> Choose your own password
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild>
            <Link
              href="/signout"
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken"
            >
              <MonitorSmartphone className="size-4 text-ink-3" aria-hidden /> Sign out of every device…
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void leave()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken"
          >
            <LogOut className="size-4 text-ink-3" aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
