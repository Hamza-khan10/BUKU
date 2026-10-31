import { Ban, CircleCheck, Eye, LogIn, PenLine, type LucideIcon } from 'lucide-react';
import { stepOf, type AuditEntry, type Mood } from '@admin/lib/audit';
import { switchName } from '@admin/lib/switches';
import { cx } from './ui';

const MOOD: Record<Mood, { icon: LucideIcon; mark: string }> = {
  stop: { icon: Ban, mark: 'bg-danger-soft text-danger ring-danger/25' },
  go: { icon: CircleCheck, mark: 'bg-ok-soft text-ok ring-ok/25' },
  look: { icon: Eye, mark: 'bg-sunken text-ink-2 ring-line' },
  'sign-in': { icon: LogIn, mark: 'bg-brand-soft text-brand-text ring-brand/20' },
  change: { icon: PenLine, mark: 'bg-wait-soft text-wait ring-wait/25' },
};

const time = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(iso),
  );

function dayOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = (x: Date) => x.toISOString().slice(0, 10);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(d);
}

/** The thing a step was about, in words: a person's name, a switch, a business's ID. */
function Target({ target }: { target: NonNullable<AuditEntry['target']> }) {
  const label =
    target.type === 'switch' && target.id
      ? switchName(target.id)
      : (target.label ?? (target.id ? null : target.type));
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-sunken px-1.5 py-0.5 text-xs ring-1 ring-line ring-inset">
      {label && <span className="truncate font-medium text-ink">{label}</span>}
      {target.id && target.type !== 'switch' && <span className="font-mono text-ink-3">{target.id}</span>}
    </span>
  );
}

/** A recorded value's name in words: platformAdmins, platform_admins → platform admins. */
const words = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();

const shown = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

/**
 * Audit entries as a timeline, newest first, grouped by day (UTC): who did what to what, why, and
 * from where. Each step's kind has its mark: stopping something, allowing it, looking, signing in,
 * changing something.
 */
export function Timeline({ entries, self }: { entries: AuditEntry[]; self?: string }) {
  const days: { day: string; entries: AuditEntry[] }[] = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(e);
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map(({ day, entries: list }) => (
        <section key={day} aria-label={day} className="flex flex-col gap-1">
          <h3 className="mb-1 text-xs font-medium text-ink-3">{day}</h3>
          <ol className="relative flex flex-col">
            <span aria-hidden className="absolute top-3 bottom-3 left-[4.6rem] w-px bg-line" />
            {list.map((e) => {
              const step = stepOf(e.action);
              const { icon: Icon, mark } = MOOD[step.mood];
              const details = Object.entries(e.details ?? {})
                .map(([k, v]) => [k, shown(v)] as const)
                .filter(([k, v]) => v !== null && k !== 'key' && k !== 'code');
              return (
                <li key={e.id} className="relative flex gap-3 py-2.5">
                  <time
                    dateTime={e.at}
                    className="w-12 shrink-0 pt-1 font-mono text-xs text-ink-3 tabular-nums"
                  >
                    {time(e.at)}
                  </time>
                  <span
                    aria-hidden
                    className={cx(
                      'relative grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset',
                      mark,
                    )}
                  >
                    <Icon strokeWidth={2} className="size-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm leading-snug text-ink-2">
                      <span className="font-semibold text-ink">
                        {e.actor ? (e.actor.id === self ? 'You' : e.actor.name) : 'Someone'}
                      </span>{' '}
                      {step.text}
                      {e.target && (
                        <>
                          {' '}
                          <Target target={e.target} />
                        </>
                      )}
                    </p>
                    {e.reason && <p className="text-sm text-ink">“{e.reason}”</p>}
                    {details.length > 0 && (
                      <p className="text-xs text-ink-3">
                        {details.map(([k, v]) => `${words(k)}: ${v}`).join(' · ')}
                      </p>
                    )}
                    {(e.ip || e.requestId) && (
                      <p className="font-mono text-[0.72rem] text-ink-3">
                        {e.ip}
                        {e.ip && e.requestId && ' · '}
                        {e.requestId && (
                          <span title="Reference: the request's ID in every log">{e.requestId}</span>
                        )}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
