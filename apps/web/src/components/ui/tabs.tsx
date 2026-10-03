'use client';

import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Tabs (arrow keys move between them, as screen-reader users expect). */
export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-md bg-sunken p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'h-9 rounded-sm px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors',
        'hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-soft',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />;
}
