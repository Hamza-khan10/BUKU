import { logger } from '@buku/common';

/**
 * Real free times for a suggestion ("Ali has an opening on Thu at 10:30"),
 * asked from booking-service's public availability endpoint over the internal
 * network — the same answer the app would get, computed by the one slot
 * engine. Best effort: any failure, timeout or rate limit means "no opening
 * to show" and the suggestion goes out without one.
 */

export interface Slot {
  startAt: Date;
  /** Local "10:30" in the business's timezone. */
  time: string;
  staffIds: string[];
}

export interface OpeningsFinder {
  /** Free times for `days` days from `date` (YYYY-MM-DD, business-local), or null if unknown. */
  find(input: {
    businessId: string;
    serviceId: string;
    date: string;
    days: number;
    staffId?: string | undefined;
  }): Promise<Slot[] | null>;
}

export class HttpOpeningsFinder implements OpeningsFinder {
  private readonly log = logger.child({ module: 'openings' });

  constructor(
    /** The API gateway (booking's public availability route). */
    private readonly gatewayUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  async find(input: {
    businessId: string;
    serviceId: string;
    date: string;
    days: number;
    staffId?: string | undefined;
  }): Promise<Slot[] | null> {
    const q = new URLSearchParams({
      serviceId: input.serviceId,
      date: input.date,
      days: String(Math.min(14, Math.max(1, input.days))),
      ...(input.staffId && { staffId: input.staffId }),
    });
    try {
      const res = await fetch(
        `${this.gatewayUrl}/v1/businesses/${encodeURIComponent(input.businessId)}/availability?${q.toString()}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (!res.ok) {
        if (res.status !== 404) this.log.warn({ status: res.status }, 'availability lookup refused');
        return null;
      }
      const body = (await res.json()) as {
        data?: { days?: { slots?: { startAt: string; time: string; staffIds: string[] }[] }[] };
      };
      return (body.data?.days ?? []).flatMap((d) =>
        (d.slots ?? []).map((s) => ({ startAt: new Date(s.startAt), time: s.time, staffIds: s.staffIds })),
      );
    } catch (err) {
      this.log.warn({ err }, 'availability lookup failed');
      return null;
    }
  }
}

/**
 * The slot to suggest: the earliest day with a free time, and on that day
 * the time closest to when they usually come.
 */
export function pickOpening(slots: Slot[], usualMinuteOfDay: number | null, timezone: string): Slot | null {
  if (!slots.length) return null;
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
  const firstDay = day(slots[0]!.startAt);
  const sameDay = slots.filter((s) => day(s.startAt) === firstDay);
  if (usualMinuteOfDay === null) return sameDay[0]!;
  const minutes = (s: Slot) => {
    const [h, m] = s.time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return sameDay.reduce((best, s) =>
    Math.abs(minutes(s) - usualMinuteOfDay) < Math.abs(minutes(best) - usualMinuteOfDay) ? s : best,
  );
}
