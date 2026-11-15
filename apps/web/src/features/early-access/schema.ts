import { zCountryCode, zText } from '@buku/validation';
import { z } from 'zod';

/**
 * Early access (D-134): people and businesses who want BUKU when it opens leave their details.
 * One set of rules for the form (instant feedback) and the server (authoritative). Text goes
 * through BUKU's text rules (no emoji, invisible or spoofing characters, normalised), so nothing
 * typed here can corrupt what's stored or show up as something else.
 */

export const KINDS = ['business', 'customer'] as const;
export type Kind = (typeof KINDS)[number];

/** How many branches (locations) a business has, in ranges people can answer without counting. */
export const BRANCHES = ['1', '2-5', '6-20', '21+'] as const;

/** The plans BUKU will offer (D-134), and "not sure": what a business would consider. */
export const PLAN_INTEREST = [
  'starter',
  'essential',
  'professional',
  'network',
  'enterprise',
  'not_sure',
] as const;
export const PLAN_LABEL: Record<(typeof PLAN_INTEREST)[number], string> = {
  starter: 'Starter (free)',
  essential: 'Essential',
  professional: 'Professional',
  network: 'Network (several branches)',
  enterprise: 'Enterprise',
  not_sure: 'Not sure yet',
};

/** The same as the API's: compared in lowercase, at most 254 characters. */
const zEmail = z
  .string()
  .trim()
  .max(254)
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a real email address.' }));

/** E.164, as the API stores phone numbers: "+" then 7 to 15 digits. Spaces and dashes are dropped. */
const zWhatsApp = z
  .string()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'With the country code, like +92 300 1234567.'));

/** Where the visit came from (the link's tags), kept short and plain. */
const zTag = z
  .string()
  .trim()
  .max(80)
  .regex(/^[A-Za-z0-9._~+-]*$/, 'Not a tag.')
  .optional();

const common = {
  email: zEmail,
  city: zText({ kind: 'title', min: 2, max: 80 }),
  country: zCountryCode,
  /** Saying yes to one email when BUKU opens; nothing is sent without it. */
  consent: z.literal(true, { message: 'Tick this so we can email you when BUKU opens.' }),
  source: zTag,
  utmSource: zTag,
  utmMedium: zTag,
  utmCampaign: zTag,
};

export const EarlyAccessInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('customer'),
    ...common,
    name: zText({ kind: 'personName', max: 120 }).optional(),
  }),
  z.strictObject({
    kind: z.literal('business'),
    ...common,
    name: zText({ kind: 'personName', min: 2, max: 120 }),
    businessName: zText({ kind: 'title', min: 2, max: 160 }),
    businessType: zText({ kind: 'title', min: 2, max: 80 }),
    branches: z.enum(BRANCHES),
    whatsapp: zWhatsApp.optional(),
    planInterest: z.enum(PLAN_INTEREST),
  }),
]);
export type EarlyAccessInput = z.infer<typeof EarlyAccessInput>;

/** The request the form sends: the details, and the bot check's token. */
export const EarlyAccessRequest = z.strictObject({
  details: z.unknown(),
  turnstileToken: z.string().max(2048).optional(),
});

/** Field → the first problem with it, in plain words, for showing next to each field. */
export function fieldProblems(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= plainWords(issue);
  }
  return out;
}

function plainWords(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return Number(issue.minimum) <= 1
        ? 'This is needed.'
        : `At least ${String(issue.minimum)} characters, please.`;
    case 'too_big':
      return `At most ${String(issue.maximum)} characters, please.`;
    case 'invalid_type':
      return 'This is needed.';
    case 'invalid_value':
      return issue.message.startsWith('Tick') ? issue.message : 'Choose one of these.';
    default:
      return issue.message;
  }
}
