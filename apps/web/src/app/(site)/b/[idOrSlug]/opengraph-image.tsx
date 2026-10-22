import { isIdOrSlug } from '@buku/validation';
import { ImageResponse } from 'next/og';
import { BRAND, MARK } from '@/components/brand/mark';
import type { BusinessProfile } from '@/features/business/types';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A business on BUKU';

/**
 * The picture shown when a business's link is shared (WhatsApp, social apps):
 * its name, category, city and rating, only what its page says.
 */
export default async function Image({ params }: { params: Promise<{ idOrSlug: string }> }) {
  const { idOrSlug } = await params;
  let business: BusinessProfile | null = null;
  if (isIdOrSlug(idOrSlug)) {
    const res = await fetch(`${process.env.API_URL}/v1/businesses/${idOrSlug}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res?.ok) business = ((await res.json()) as { data: BusinessProfile }).data;
  }

  const name = business?.name ?? 'BUKU';
  const line = business
    ? `${business.category.name} · ${business.address.city}`
    : 'Book appointments. Join queues.';
  const rating =
    business && business.rating.count > 0
      ? `★ ${business.rating.average.toFixed(1)} · ${business.rating.count} ${business.rating.count === 1 ? 'review' : 'reviews'}`
      : null;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: BRAND.midnight,
        color: '#edf3f0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="72" height="72" viewBox="0 0 48 48">
          <path d={MARK.ticket} fill={BRAND.emerald} />
          <path d={MARK.hour} stroke={BRAND.white} strokeWidth={MARK.hourWidth} strokeLinecap="round" />
          <path d={MARK.minute} stroke={BRAND.white} strokeWidth={MARK.minuteWidth} strokeLinecap="round" />
          <circle cx={MARK.pivot.cx} cy={MARK.pivot.cy} r={MARK.pivot.r} fill={BRAND.saffron} />
        </svg>
        <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.5 }}>BUKU</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 30, color: '#79d7b1' }}>{line}</span>
        <span style={{ fontSize: name.length > 28 ? 64 : 84, fontWeight: 800, lineHeight: 1.05 }}>
          {name}
        </span>
        {rating && <span style={{ fontSize: 34, color: BRAND.saffron }}>{rating}</span>}
      </div>
      <span style={{ fontSize: 28, color: '#b4c4bc' }}>Services, prices and opening hours on BUKU</span>
    </div>,
    size,
  );
}
