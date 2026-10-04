import 'server-only';
import { findPublic, getPublic } from '@/lib/api/public';
import type { BusinessProfile, QueueState, Review, ReviewsMeta, ServiceMenu, StaffMember } from './types';

/** A business address part: its slug or id. Anything else can't be a business. */
const ID_OR_SLUG = /^[a-z0-9-]{1,200}$/;

export const REVIEWS_PAGE = 6;

/** What a settled section holds: its data, or that it couldn't be loaded (with the reference). */
export type Section<T> = { ok: true; data: T } | { ok: false; reference: string | undefined };

async function section<T>(load: Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load };
  } catch (error) {
    const reference = (error as { requestId?: string }).requestId;
    return { ok: false, reference };
  }
}

/**
 * Everything the business page shows. The profile decides whether the page
 * exists (not found → 404); the other parts load side by side, and one that
 * fails shows its own "couldn't load" message instead of breaking the page.
 */
export async function loadBusinessPage(idOrSlug: string) {
  if (!ID_OR_SLUG.test(idOrSlug)) return null;
  const profile = await findPublic<BusinessProfile>(`/v1/businesses/${idOrSlug}`, { revalidate: 60 });
  if (!profile) return null;
  const slug = profile.data.slug;
  const [menu, staff, reviews, queue] = await Promise.all([
    section(
      getPublic<ServiceMenu>(`/v1/businesses/${slug}/services`, { revalidate: 60 }).then((r) => r.data),
    ),
    section(getPublic<StaffMember[]>(`/v1/businesses/${slug}/staff`, { revalidate: 60 }).then((r) => r.data)),
    section(
      getPublic<Review[], ReviewsMeta>(`/v1/businesses/${slug}/reviews`, {
        revalidate: 60,
        query: { limit: REVIEWS_PAGE },
      }),
    ),
    // Live state: never cached (the page then follows it over a stream).
    section(getPublic<QueueState>(`/v1/queue/public/${slug}`, { revalidate: 0 }).then((r) => r.data)),
  ]);
  return { business: profile.data, menu, staff, reviews, queue };
}

/**
 * What the booking page needs: the business, its menu and its team. The
 * profile decides whether the page exists; without the menu there is nothing
 * to book (the page says so).
 */
export async function loadBookingPage(idOrSlug: string) {
  if (!ID_OR_SLUG.test(idOrSlug)) return null;
  const profile = await findPublic<BusinessProfile>(`/v1/businesses/${idOrSlug}`, { revalidate: 60 });
  if (!profile) return null;
  const slug = profile.data.slug;
  const [menu, staff] = await Promise.all([
    section(
      getPublic<ServiceMenu>(`/v1/businesses/${slug}/services`, { revalidate: 60 }).then((r) => r.data),
    ),
    section(getPublic<StaffMember[]>(`/v1/businesses/${slug}/staff`, { revalidate: 60 }).then((r) => r.data)),
  ]);
  return { business: profile.data, menu, staff };
}
