import { Inbox, type LucideIcon } from 'lucide-react';

/** A list with nothing in it: said calmly, with what it means, never a blank space. */
export function Empty({
  title,
  text,
  icon: Icon = Inbox,
}: {
  title: string;
  text?: string;
  icon?: LucideIcon;
}) {
  return (
    <div role="status" className="panel rise flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-sunken text-ink-3 ring-1 ring-line ring-inset">
        <Icon aria-hidden strokeWidth={1.7} className="size-6" />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {text && <p className="max-w-sm text-sm text-ink-3">{text}</p>}
    </div>
  );
}
