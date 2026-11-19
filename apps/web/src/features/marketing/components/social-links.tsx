import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { socialProfiles, type SocialProfile } from '../social';

/** A platform's own mark, in the surrounding text colour (both themes). */
function Mark({ profile, className }: { profile: SocialProfile; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" className={className}>
      <path d={profile.mark} />
    </svg>
  );
}

/** Profiles open in a new tab (BUKU stays open behind them); `me` says they're BUKU's own. */
const OUT = { target: '_blank', rel: 'me noopener' } as const;

/**
 * The footer's row of marks: round, quiet buttons on Midnight that brighten under the pointer,
 * each named for a screen reader ("BUKU on Instagram"). Nothing renders until a profile exists.
 */
export function SocialIcons({ className }: { className?: string }) {
  const profiles = socialProfiles();
  if (profiles.length === 0) return null;
  return (
    <nav aria-label="BUKU on social media" className={className}>
      <ul className="flex items-center gap-2">
        {profiles.map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              {...OUT}
              aria-label={`BUKU on ${p.name} (opens in a new tab)`}
              className="grid size-11 place-items-center rounded-full text-board-ink-2 ring-1 ring-white/15 transition-[color,background-color,transform] duration-150 ease-(--ease-out) hover:bg-white/10 hover:text-board-ink active:scale-[0.94]"
            >
              <Mark profile={p} className="size-[1.125rem]" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * "Follow BUKU" on the contact page: one line on what's posted, then a pill per platform with its
 * mark, name and handle (the handle is what people search for in the app). A row beside the words
 * on wide screens; stacked, full width, on a phone.
 */
export function FollowBuku({ className }: { className?: string }) {
  const profiles = socialProfiles();
  if (profiles.length === 0) return null;
  return (
    <section
      aria-labelledby="follow-buku"
      className={cn(
        'grid gap-6 rounded-2xl bg-brand-soft p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 id="follow-buku" className="type-subheading">
          Follow BUKU
        </h2>
        <p className="max-w-[46ch] text-ink-2">
          How BUKU works, tips for a calmer front desk, and the day BUKU opens near you.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:justify-end">
        {profiles.map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              {...OUT}
              className="group flex h-14 items-center gap-3 rounded-full bg-surface pr-5 pl-2 shadow-soft ring-1 ring-line transition-[box-shadow,transform] duration-150 ease-(--ease-out) hover:ring-control active:scale-[0.98] lg:min-w-48"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
                <Mark profile={p} className="size-[1.125rem]" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <span className="truncate text-sm text-ink-3">{p.handle}</span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="ml-auto size-4 shrink-0 text-ink-3 transition-transform duration-150 ease-(--ease-out) group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
