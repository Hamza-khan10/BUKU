import { AppError, logger } from '@buku/common';
import type { DirectoryClient } from './directory.js';

/**
 * Emergency switches (D-129): parts of BUKU an operator turns off at once — under attack, or when
 * one part misbehaves — and back on, from the admin console. Each switch names what stops:
 */
export const SWITCHES = {
  signups: 'New accounts (people and businesses’ owners signing up)',
  signin: 'Signing in and staying signed in, for everyone but platform admins',
  bookings: 'New bookings and moving bookings',
  queue: 'Joining a walk-in queue (the front desk still serves who’s in it)',
  payments: 'Checkouts, plan changes and trials (payments already made still arrive)',
  uploads: 'Uploading pictures and documents',
  reviews: 'Writing reviews and replies',
  business_signup: 'Registering new businesses',
} as const;

export type SwitchKey = keyof typeof SWITCHES;
export const SWITCH_KEYS = Object.keys(SWITCHES) as SwitchKey[];

/**
 * The switches as this service sees them: read from the directory every few seconds (and once at
 * start), so a change reaches every instance within that time. If the directory can't be read, the
 * last known state stands — a database hiccup never turns anything off by itself, and an instance
 * that never read them treats everything as on.
 */
export class Switches {
  #off = new Set<SwitchKey>();
  #timer: NodeJS.Timeout | null = null;
  #log = logger.child({ module: 'switches' });

  constructor(
    private readonly directory: DirectoryClient,
    private readonly options: { pollMs?: number } = {},
  ) {}

  async start(): Promise<void> {
    await this.refresh().catch((err: unknown) =>
      this.#log.warn({ err }, 'emergency switches not read yet; everything stays on'),
    );
    this.#timer = setInterval(() => void this.refresh().catch(() => undefined), this.options.pollMs ?? 5_000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async refresh(): Promise<void> {
    const rows = await this.directory.$queryRaw<{ key: string; off: boolean }[]>`
      SELECT key, off FROM ops.switches`;
    const off = new Set(rows.filter((r) => r.off && r.key in SWITCHES).map((r) => r.key as SwitchKey));
    for (const key of off) if (!this.#off.has(key)) this.#log.warn({ switch: key }, 'emergency switch: off');
    for (const key of this.#off)
      if (!off.has(key)) this.#log.info({ switch: key }, 'emergency switch: back on');
    this.#off = off;
  }

  isOff(key: SwitchKey): boolean {
    return this.#off.has(key);
  }

  /** Refuses (503, SERVICE_PAUSED) while the switch is off. */
  check(key: SwitchKey): void {
    if (this.#off.has(key)) throw AppError.paused();
  }

  /** The same, as route middleware (Express's shape, without depending on it). */
  guard(key: SwitchKey): (req: unknown, res: unknown, next: (err?: unknown) => void) => void {
    return (_req, _res, next) => {
      if (this.#off.has(key)) return next(AppError.paused());
      next();
    };
  }
}
