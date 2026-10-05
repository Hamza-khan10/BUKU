'use client';

import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

export const controlStyles = cn(
  'w-full rounded-md border border-control bg-surface px-3.5 text-[0.95rem] text-ink',
  'placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150',
  'hover:border-ink-3 focus-visible:border-focus focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
);

/** A plain input (emails, phone numbers, codes). For names and free text use CleanTextInput. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  const { noticeId: _notice, ...field } = useFieldControl(props);
  return <input {...props} {...field} className={cn(controlStyles, 'h-11', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const { noticeId: _notice, ...field } = useFieldControl(props);
  return (
    <textarea
      {...props}
      {...field}
      className={cn(controlStyles, 'min-h-28 py-2.5 leading-relaxed', className)}
    />
  );
}

/** A native select that belongs to its Field (label, hint, error). */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  const { noticeId: _notice, ...field } = useFieldControl(props);
  return <select {...props} {...field} className={cn(controlStyles, 'h-11 pr-8', className)} />;
}
