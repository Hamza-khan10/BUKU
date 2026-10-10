'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A dialog: focus moves in and is kept inside, Escape and the close button
 * leave, focus returns to what opened it. Every dialog has a title (read out
 * when it opens). Full-width sheet on phones, centred card from `sm` up.
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { title: ReactNode; description?: ReactNode }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-night/45 backdrop-blur-sm animate-[rise_240ms_var(--ease-out)_both]" />
      <RadixDialog.Content
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-6 pt-5 shadow-lift animate-rise',
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7',
          className,
        )}
        data-lenis-prevent
        {...props}
      >
        {/* A sheet's handle on phones: it reads as something that slid up and can go back down. */}
        <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-line sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <RadixDialog.Title className="text-xl font-semibold tracking-[-0.02em]">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-sm text-ink-2">{description}</RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close
            className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden />
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
