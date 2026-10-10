'use client';

import { Toaster as Sonner } from 'sonner';

/**
 * Short confirmations and background failures ("Saved", "Couldn't refresh,
 * retrying"). Never the only place an error appears for something the person
 * is doing: forms show errors next to the field.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border border-line bg-surface text-ink shadow-lift font-sans',
          description: 'text-ink-2',
          actionButton: 'rounded-full bg-brand text-on-brand',
          cancelButton: 'rounded-full bg-sunken text-ink',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
