/**
 * The limits and features plans can set (D-065). Plans store VALUES for these
 * keys as data (edited by admins at any time); this registry only says which
 * keys exist, what they mean, and how to label them on the pricing page. Code
 * that enforces a limit names its key here.
 *
 * A limit is a maximum count; `null` (or a key the plan doesn't set) means
 * unlimited. A feature is on only when the plan says `true`.
 */

export type Audience = 'user' | 'business';

export interface KeyInfo {
  label: string;
  description: string;
  /** Singular, for messages like "includes 1 team login". */
  one?: string;
  /**
   * false: BUKU doesn't offer this yet. It stays out of everything plans advertise
   * (the pricing page, the comparison) until it exists, even if a plan switches it on.
   */
  launched?: false;
}

export const LIMIT_KEYS = {
  user: {
    visits: {
      label: 'Bookings and queue joins',
      one: 'booking or queue join',
      description:
        'Appointments and queue tickets in total (live, completed or missed; cancelled ones don’t count).',
    },
  },
  business: {
    team_accounts: {
      label: 'Team logins',
      one: 'team login',
      description: 'Active employee accounts and other team members.',
    },
    staff_profiles: {
      label: 'Bookable staff',
      one: 'bookable staff member',
      description: 'Active staff profiles customers can book.',
    },
    services: { label: 'Services', one: 'service', description: 'Active services on the menu.' },
    photos: { label: 'Photos', one: 'photo', description: 'Gallery photos on the business profile.' },
  },
} as const satisfies Record<Audience, Record<string, KeyInfo>>;

export const FEATURE_KEYS = {
  user: {},
  business: {
    queue: { label: 'Virtual queue', description: 'Remote queue joining with a live display.' },
    manual_approval: {
      label: 'Approve bookings by hand',
      description: 'Confirm each booking before it is final.',
    },
    staff_photos: { label: 'Staff photos', description: 'Photos next to employees’ names.' },
    // The ads service is deferred (not built yet): not advertised until it exists.
    ads: { label: 'Ads', description: 'Promote the business on BUKU.', launched: false },
    priority_support: { label: 'Priority support', description: 'Faster answers from the BUKU team.' },
  },
} as const satisfies Record<Audience, Record<string, KeyInfo>>;

export type UserLimit = keyof (typeof LIMIT_KEYS)['user'];
export type BusinessLimit = keyof (typeof LIMIT_KEYS)['business'];
export type BusinessFeature = keyof (typeof FEATURE_KEYS)['business'];

export const limitKeysOf = (audience: Audience) => Object.keys(LIMIT_KEYS[audience]);
export const featureKeysOf = (audience: Audience) => Object.keys(FEATURE_KEYS[audience]);

/**
 * What a plan's raw JSON means: only known keys, limits as whole numbers or
 * null (unlimited), features as booleans. Anything malformed counts as
 * unlimited / off rather than breaking a request.
 */
export function readPlanValues(audience: Audience, limits: unknown, features: unknown) {
  const l = (limits && typeof limits === 'object' ? limits : {}) as Record<string, unknown>;
  const f = (features && typeof features === 'object' ? features : {}) as Record<string, unknown>;
  return {
    limits: Object.fromEntries(
      limitKeysOf(audience).map((k) => {
        const v = l[k];
        return [k, typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null];
      }),
    ) as Record<string, number | null>,
    features: Object.fromEntries(featureKeysOf(audience).map((k) => [k, f[k] === true])) as Record<
      string,
      boolean
    >,
  };
}

/** Features BUKU offers today (not ones marked `launched: false`). */
export const launchedFeatureKeysOf = (audience: Audience) =>
  Object.entries(FEATURE_KEYS[audience] as Record<string, KeyInfo>)
    .filter(([, v]) => v.launched !== false)
    .map(([k]) => k);

/**
 * Labels and descriptions of every limit and every launched feature, e.g. for
 * the pricing page's comparison table. Unlaunched features are left out.
 */
export function describeKeys(audience: Audience) {
  const list = (keys: Record<string, KeyInfo>) =>
    Object.entries(keys)
      .filter(([, v]) => v.launched !== false)
      .map(([key, v]) => ({ key, label: v.label, description: v.description }));
  return { limits: list(LIMIT_KEYS[audience]), features: list(FEATURE_KEYS[audience]) };
}
