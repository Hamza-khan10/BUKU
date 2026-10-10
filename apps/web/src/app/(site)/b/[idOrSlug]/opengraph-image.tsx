import { ImageResponse } from 'next/og';
import type { BusinessProfile } from '@/features/business/types';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A business on BUKU';

/**
 * The picture shown when a business's link is shared (WhatsApp, social apps):
 * its name, category, city and rating — only what its page says.
 */
export default async function Image({ params }: { params: Promise<{ idOrSlug: string }> }) {
  const { idOrSlug } = await params;
  let business: BusinessProfile | null = null;
  if (/^[a-z0-9-]{1,200}$/.test(idOrSlug)) {
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
        background: '#0b0f0d',
        color: '#edf2ef',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width="64" height="64" viewBox="0 0 32 32">
          <path
            d="M6 6h20a2 2 0 0 1 2 2v5a3 3 0 0 0 0 6v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5a3 3 0 0 0 0-6V8a2 2 0 0 1 2-2Z"
            fill="#3fc495"
          />
          <path d="M20 9v14" stroke="#06140f" strokeWidth="1.6" strokeDasharray="1.6 2.2" opacity=".75" />
          <path
            d="m9.5 16.2 2.6 2.6 5-5.6"
            fill="none"
            stroke="#06140f"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        <span style={{ fontSize: 40, fontWeight: 700 }}>BUKU</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 30, color: '#5ed3a8' }}>{line}</span>
        <span style={{ fontSize: name.length > 28 ? 64 : 84, fontWeight: 800, lineHeight: 1.05 }}>
          {name}
        </span>
        {rating && <span style={{ fontSize: 34, color: '#f2b655' }}>{rating}</span>}
      </div>
      <span style={{ fontSize: 28, color: '#b9c2bd' }}>Services, prices and opening hours on BUKU</span>
    </div>,
    size,
  );
}
