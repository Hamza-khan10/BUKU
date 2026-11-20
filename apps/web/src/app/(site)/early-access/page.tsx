import { ISO_COUNTRY_CODES } from '@buku/validation';
import { normalizeText, textProblem } from '@buku/validation';
import { isBusinessKind } from '@/features/early-access/kinds';
import { headers } from 'next/headers';
import { Container } from '@/components/ui/layout';
import { EarlyAccessForm, type Tags } from '@/features/early-access/components/early-access-form';
import { PLAN_INTEREST, type Kind } from '@/features/early-access/schema';
import { earlyAccessSettings } from '@/features/early-access/server';
import { countryOptions } from '@/features/manage/setup';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Get early access',
  description:
    'BUKU takes bookings and runs walk-in queues for barbers, clinics, salons and offices. Join the list and be first when it opens near you.',
  path: '/early-access',
});

/** A link's tag, kept only if it's short and plain (anything else is dropped, not stored). */
const tag = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9._~+-]{1,80}$/.test(value) ? value : undefined;

const POINTS = [
  {
    title: 'Free to start, for good',
    text: 'Starter costs nothing. Every plan begins with 30 days of Professional, free.',
  },
  {
    title: 'Bookings and the walk-in line',
    text: 'Customers book a time or join your queue from their phone, and arrive when it’s their turn.',
  },
  {
    title: 'Help to set up',
    text: 'Businesses on the list get a hand putting their hours, services and team in.',
  },
];

/**
 * /early-access (D-134): the door to BUKU before it opens. Businesses first (that's who BUKU needs
 * first), people who book a click away. Where the visit came from (the link's tags) is kept with
 * the signup, so we can see which channels bring real interest.
 */
export default async function EarlyAccessPage({ searchParams }: PageProps<'/early-access'>) {
  const [query, incoming] = await Promise.all([searchParams, headers()]);
  const settings = earlyAccessSettings();
  const kind: Kind = query.as === 'customer' ? 'customer' : 'business';
  // The plan chosen on the pricing page (?plan=), if it's one of the list's.
  const plan = PLAN_INTEREST.find((p) => p === query.plan);
  // A business's name and kind from "See your place on BUKU" (/for-business), kept only when they
  // pass the form's own rules; anything else is ignored, never shown.
  const typed = typeof query.name === 'string' ? normalizeText(query.name, 'title') : '';
  const businessName =
    typed.length >= 2 && typed.length <= 80 && !textProblem(typed, 'title') ? typed : undefined;
  const businessType = isBusinessKind(query.type) ? query.type : undefined;
  // The visitor's country as the host tells it (Cloudflare, or Vercel until the move is done), to
  // start the list there; "XX" (unknown) and "T1" (Tor) aren't countries, so those start at PK.
  const country = (incoming.get('cf-ipcountry') ?? incoming.get('x-vercel-ip-country'))?.toUpperCase();
  const tags: Tags = {
    source: tag(query.source) ?? tag(query.ref),
    utmSource: tag(query.utm_source),
    utmMedium: tag(query.utm_medium),
    utmCampaign: tag(query.utm_campaign),
  };

  return (
    <Container className="grid grid-cols-1 items-start gap-10 py-10 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-20">
      <div className="flex flex-col gap-6 lg:sticky lg:top-28">
        <h1 className="text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[3.75rem]">
          Be first when BUKU opens.
        </h1>
        <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2">
          BUKU takes bookings and runs walk-in queues for barbers, clinics, salons and offices. Join the list
          and we’ll tell you the day it opens near you.
        </p>
        <ul className="flex flex-col gap-4 pt-2">
          {POINTS.map((p) => (
            <li key={p.title} className="flex flex-col gap-0.5 border-l-2 border-brand/40 pl-4">
              <span className="font-semibold text-ink">{p.title}</span>
              <span className="text-ink-2">{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
      {settings ? (
        <EarlyAccessForm
          siteKey={settings === 'test' ? null : settings.turnstileSiteKey}
          nonce={incoming.get('x-nonce') ?? undefined}
          initialKind={kind}
          initialPlan={plan}
          initialBusiness={{ name: businessName, type: businessType }}
          initialCountry={country && ISO_COUNTRY_CODES.has(country) ? country : 'PK'}
          countries={countryOptions(ISO_COUNTRY_CODES)}
          tags={tags}
        />
      ) : (
        <div role="status" className="rounded-lg bg-surface p-8 shadow-soft ring-1 ring-line">
          <h2 className="type-heading">The list opens very soon</h2>
          <p className="mt-2 text-ink-2">We’re getting it ready. Please come back in a day or two.</p>
        </div>
      )}
    </Container>
  );
}
