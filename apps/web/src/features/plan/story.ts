import type { MyPlan } from './api';

/** "5 Nov 2026" */
export const planDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** Where a subscription is managed: here (bought on the website), in the app's store, or nowhere (given). */
export type ManagedIn = 'website' | 'google_play' | 'app_store' | null;

export interface PlanStory {
  title: string;
  /** Plain sentences about the plan, in order. */
  lines: string[];
  /** The payment didn't go through: said first, as something to do. */
  warning: string | null;
  managedIn: ManagedIn;
  /** A paid plan bought here that will renew (it can be stopped), or won't (it can be kept). */
  renewal: 'renews' | 'ends' | null;
}

/**
 * What to tell someone about their plan — only what's true of it now: free
 * for everyone while paid plans are off; a trial and when it ends; a plan
 * given by BUKU; a paid plan, where it's managed and whether it renews.
 */
export function planStory(p: MyPlan): PlanStory {
  const story: PlanStory = { title: p.plan.name, lines: [], warning: null, managedIn: null, renewal: null };
  if (p.source === 'billing_off') {
    return {
      ...story,
      title: 'Everything is free right now',
      lines: ['Paid plans aren’t switched on yet, so there are no limits on bookings or queues.'],
    };
  }
  const s = p.subscription;
  const until = s?.currentPeriodEnd ? planDate(s.currentPeriodEnd) : null;
  if (p.source === 'trial') {
    story.title = `You’re trying ${p.plan.name}`;
    story.lines.push(
      until
        ? `Free until ${until}. Then you’re back on the free plan; nothing is charged.`
        : 'Free, for now.',
    );
  } else if (p.source === 'subscription' && s) {
    if (s.provider === 'manual') {
      story.lines.push(until ? `Given to you by BUKU until ${until}.` : 'Given to you by BUKU.');
    } else {
      story.managedIn =
        s.provider === 'paddle'
          ? 'website'
          : s.provider === 'google_play' || s.provider === 'app_store'
            ? s.provider
            : null;
      if (s.status === 'past_due') {
        story.warning =
          'Your last payment didn’t go through. It will be tried again — check your payment details.';
      }
      if (s.cancelAtPeriodEnd) {
        story.lines.push(until ? `Ends on ${until}; it won’t renew.` : 'It won’t renew.');
        story.renewal = story.managedIn === 'website' ? 'ends' : null;
      } else {
        story.lines.push(until ? `Renews on ${until}.` : 'Renews automatically.');
        story.renewal = story.managedIn === 'website' ? 'renews' : null;
      }
    }
  } else {
    story.title = `You’re on ${p.plan.name}`;
  }
  return story;
}

/** "3 of 5 used", "2 used — no limit" — for each limit the plan has. */
export function usageLines(
  p: MyPlan,
  labels: Record<string, string>,
): { label: string; text: string; full: boolean }[] {
  if (p.source === 'billing_off') return [];
  return Object.entries(p.usage).map(([key, u]) => ({
    label: labels[key] ?? key,
    text: u.limit === null ? `${u.used} so far — no limit` : `${u.used} of ${u.limit} used`,
    full: u.limit !== null && u.used >= u.limit,
  }));
}
