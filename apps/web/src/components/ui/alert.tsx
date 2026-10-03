import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const tones = {
  info: { box: 'bg-sunken text-ink', icon: Info, iconColor: 'text-ink-2' },
  ok: { box: 'bg-ok-soft text-ink', icon: CircleCheck, iconColor: 'text-ok' },
  wait: { box: 'bg-wait-soft text-ink', icon: TriangleAlert, iconColor: 'text-wait-ink' },
  danger: { box: 'bg-danger-soft text-ink', icon: CircleAlert, iconColor: 'text-danger' },
} as const;

/**
 * A message in the flow of the page. Errors are announced to screen readers
 * as they appear (role="alert"); other tones politely (role="status").
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md p-4 text-sm', t.box, className)}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', t.iconColor)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
