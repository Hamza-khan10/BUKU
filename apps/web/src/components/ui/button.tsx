import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

/**
 * Buttons. `primary` (coral) is the one next step on a screen — book, join,
 * save; use it once per view. Everything else is secondary, quiet or ghost.
 * Touch targets are at least 44 px tall (md and up).
 */
export const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none',
    'transition-[background-color,color,box-shadow,transform] duration-150',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-55',
    '[&_svg]:size-[1.15em] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-on-brand shadow-soft hover:bg-brand-hover',
        secondary: 'border border-control bg-surface text-ink hover:bg-sunken',
        quiet: 'bg-sunken text-ink hover:bg-line',
        ghost: 'text-ink hover:bg-sunken',
        danger: 'bg-danger text-surface hover:opacity-90',
        link: 'h-auto px-0 text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[0.95rem]',
        lg: 'h-13 px-6 text-base',
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
