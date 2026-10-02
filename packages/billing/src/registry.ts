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
}

export const LIMIT_KEYS = {
  user: {
    visits: {
      label: 'Bookings and queue joins',
      description:
        'Appointments and queue tickets in total (live, completed or missed; cancelled ones don’t count).',
    },
  },
  business: {
    team_accounts: { label: 'Team logins', description: 'Employee accounts and other team members.' },
    staff_profiles: { label: 'Bookable staff', description: 'Active staff profiles customers can book.' },
    services: { label: 'Services', description: 'Active services on the menu.' },
    photos: { label: 'Photos', description: 'Gallery photos on the business profile.' },
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
    ads: { label: 'Ads', description: 'Promote the business on BUKU.' },
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

/** Labels and descriptions of every limit and feature, e.g. for the pricing page's comparison table. */
export function describeKeys(audience: Audience) {
  const list = (keys: Record<string, KeyInfo>) =>
    Object.entries(keys).map(([key, v]) => ({ key, label: v.label, description: v.description }));
  return { limits: list(LIMIT_KEYS[audience]), features: list(FEATURE_KEYS[audience]) };
}
