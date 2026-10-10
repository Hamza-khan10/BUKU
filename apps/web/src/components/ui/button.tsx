import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

/**
 * Buttons. `primary` (emerald) is the one next step on a screen: book, join,
 * save. Use it once per view; everything else is secondary, quiet or ghost.
 * Pills, with feedback on press (not on release) that springs back
 * (WEB_PLAN §2). Touch targets are at least 44 px tall (md and up).
 */
export const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.005em] whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-(--ease-out)',
    'active:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-[1.1em] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-on-brand shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(var(--shadow-color)/0.12)] hover:bg-brand-hover',
        secondary: 'border border-line bg-surface text-ink shadow-soft hover:border-control',
        quiet: 'bg-sunken text-ink hover:bg-line',
        ghost: 'text-ink hover:bg-sunken',
        danger: 'bg-danger text-surface hover:opacity-90',
        link: 'h-auto rounded-sm px-0 font-medium text-brand-ink underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-9 px-3.5 text-sm',
        md: 'h-11 px-5 text-[0.95rem]',
        lg: 'h-13 px-7 text-base',
        icon: 'size-11',
      },
      block: { true: 'w-full' },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonStyles> {
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
  /** Busy: shows a spinner, keeps the width, and ignores clicks. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild,
  loading,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonStyles({ variant, size, block }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-[1.1em]" />}
      {children}
    </button>
  );
}
