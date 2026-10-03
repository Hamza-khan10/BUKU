import { AppError, businessReliability, MIN_DECIDED_FOR_RELIABILITY } from '@buku/common';
import { Prisma, type Database } from '@buku/database';
import type { MediaLinks } from '@buku/media';
import type { Categories } from './categories.js';
import { escapeLike, normalizeQuery, prefixTsQuery, words } from './text.js';

/**
 * Finding businesses, straight from Postgres (D-076): full text over one
 * document per business that the database keeps current (name; category and
 * service names; description; city — weighted in that order), typo tolerance
 * on the name (trigram similarity), PostGIS distance, and live facts — open now, an open queue
 * and how many are waiting, the lowest price. Always current: no index to
 * fall behind.
 *
 * WHO APPEARS: businesses that are live (not suspended/rejected/deleted) and
 * have something to offer (an active service or a queue). Unverified ones
 * appear, labelled (D-032).
 *
 * RANKING ("relevance"): how well the text matches, then quality — rating
 * adjusted for how many reviews there are (a 5.0 from 2 reviews doesn't beat
 * a 4.8 from 200), how reliably the business keeps bookings, verified — and
 * closeness. Weights below.
 */

export const WEIGHTS = {
  /** Rating pulled towards 4.0 as if from 5 reviews (Bayesian average). */
  priorRating: 4.0,
  priorReviews: 5,
  /** Until there are enough decided bookings, reliability is assumed to be this. */
  priorReliability: 0.9,
  minDecidedForReliability: MIN_DECIDED_FOR_RELIABILITY,
  quality: 0.5,
  proximity: 0.5,
  /** Distance at which closeness counts half. */
  halfDistanceKm: 5,
  nameSimilarity: 0.5,
  /** Word similarity needed to count as a (typo) match on the name, for queries of 4+ characters. */
  typoThreshold: 0.5,
  typoMinLength: 4,
} as const;

export const MAX_LIMIT = 50;
const VISIBLE = Prisma.sql`b.deleted_at IS NULL AND b.status IN ('pending', 'verified')`;

export type Sort = 'relevance' | 'distance' | 'rating' | 'newest';

export interface SearchInput {
  q?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  radiusKm?: number | undefined;
  city?: string | undefined;
  category?: string | undefined;
  minRating?: number | undefined;
  verifiedOnly?: boolean | undefined;
  openNow?: boolean | undefined;
  hasQueue?: boolean | undefined;
  /** YYYY-MM-DD: open that day (business hours, minus closures). */
  availableDate?: string | undefined;
  sort?: Sort | undefined;
  page: number;
  limit: number;
}

interface Row {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  avg_rating: number;
  review_count: number;
  currency: string;
  logo_storage_key: string | null;
  category_slug: string;
  category_name: string;
  cover_key: string | null;
  min_price: number | null;
  kept: number | null;
  business_cancels: number | null;
  queue_open: boolean | null;
  waiting: number | null;
  open_now: boolean;
  distance_m: number | null;
  total: number;
}

export class SearchService {
  constructor(
    private readonly db: Database,
    private readonly categories: Categories,
    private readonly links: MediaLinks,
  ) {}

  async search(input: SearchInput, now = new Date()) {
    const q = input.q ? normalizeQuery(input.q) : '';
    const tsq = q ? prefixTsQuery(q) : null;
    const point = pointOf(input);
    const sort: Sort = input.sort ?? 'relevance';
    if (sort === 'distance' && !point) throw AppError.badRequest('Sorting by distance needs lat and lng');
    const categoryIds = input.category ? await this.categories.idsWithin(input.category) : null;
    const limit = Math.min(input.limit, MAX_LIMIT);

    const filters: Prisma.Sql[] = [VISIBLE, OFFERS_SOMETHING];
    if (q) {
      filters.push(Prisma.sql`(
        ${tsq ? Prisma.sql`b.search_vector @@ p.tsq OR` : Prisma.empty}
        ${typoMatch(words(q))}
      )`);
    }
    if (point) {
      filters.push(
        Prisma.sql`b.location IS NOT NULL AND extensions.ST_DWithin(b.location, p.point, ${
          (input.radiusKm ?? 10) * 1000
        })`,
      );
    }
    if (input.city) filters.push(Prisma.sql`lower(b.city) = lower(${input.city})`);
    if (categoryIds) filters.push(Prisma.sql`b.category_id = ANY(${categoryIds}::uuid[])`);
    if (input.minRating) filters.push(Prisma.sql`b.avg_rating >= ${input.minRating} AND b.review_count > 0`);
    if (input.verifiedOnly) filters.push(Prisma.sql`b.verified`);
    if (input.openNow) filters.push(openAt(now));
    if (input.hasQueue) filters.push(Prisma.sql`qs.open`);
    if (input.availableDate) filters.push(openOn(input.availableDate));

    const order = {
      relevance: Prisma.sql`score DESC, b.id`,
      distance: Prisma.sql`distance_m ASC NULLS LAST, score DESC, b.id`,
      rating: Prisma.sql`${BAYES} DESC, b.review_count DESC, b.id`,
      newest: Prisma.sql`b.created_at DESC, b.id`,
    }[sort];

    const rows = await this.db.$queryRaw<Row[]>`
      SELECT ${COLUMNS},
             ${openAt(now)} AS open_now,
             ${point ? Prisma.sql`extensions.ST_Distance(b.location, p.point)` : Prisma.sql`NULL::float8`} AS distance_m,
             (
               ${q ? textScore(Boolean(tsq)) : Prisma.sql`0`}
               + ${WEIGHTS.quality}::float8 * ${QUALITY}
               + ${point ? proximity : Prisma.sql`0`}
             )::float8 AS score,
             (count(*) OVER ())::int AS total
      FROM businesses b
      CROSS JOIN (SELECT
          ${tsq ? Prisma.sql`to_tsquery('english'::regconfig, ${tsq})` : Prisma.sql`NULL::tsquery`} AS tsq,
          ${q}::text AS q,
          ${
            point
              ? Prisma.sql`extensions.ST_SetSRID(extensions.ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::extensions.geography`
              : Prisma.sql`NULL::extensions.geography`
          } AS point) p
      ${JOINS(now)}
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY ${order}
      LIMIT ${limit} OFFSET ${(input.page - 1) * limit}`;

    const total = rows[0]?.total ?? (input.page > 1 ? await this.countOnly(input, now) : 0);
    return {
      items: await Promise.all(rows.map((r) => this.view(r))),
      meta: { page: input.page, limit, total, totalPages: Math.ceil(total / limit), sort },
    };
  }

  /** Past the last page there are no rows to carry the total: count separately. */
  private async countOnly(input: SearchInput, now: Date): Promise<number> {
    const first = await this.search({ ...input, page: 1, limit: 1 }, now);
    return first.meta.total;
  }

  /** As-you-type suggestions: businesses, categories and services (min 2 characters). */
  async autocomplete(input: {
    q: string;
    lat?: number | undefined;
    lng?: number | undefined;
    limit: number;
  }) {
    const q = normalizeQuery(input.q);
    if (q.length < 2) return { businesses: [], categories: [], services: [] };
    const like = `${escapeLike(q)}%`;
    const wordLike = `% ${escapeLike(q)}%`;
    const point = pointOf(input);
    const limit = Math.min(input.limit, 10);
    const [businesses, categories, services] = await Promise.all([
      this.db.$queryRaw<{ id: string; slug: string; name: string; city: string; category: string }[]>`
        SELECT b.id, b.slug, b.name, b.city, c.name AS category
        FROM businesses b JOIN categories c ON c.id = b.category_id
        WHERE ${VISIBLE} AND ${OFFERS_SOMETHING_PLAIN}
          AND (b.name ILIKE ${like} OR b.name ILIKE ${wordLike}
               OR ${typoMatch(words(q))})
        ORDER BY (b.name ILIKE ${like}) DESC,
                 extensions.word_similarity(${q}, b.name) DESC,
                 ${
                   point
                     ? Prisma.sql`b.location <-> extensions.ST_SetSRID(extensions.ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::extensions.geography,`
                     : Prisma.empty
                 }
                 b.review_count DESC, b.id
        LIMIT ${limit}`,
      this.db.$queryRaw<{ slug: string; name: string; icon: string | null }[]>`
        SELECT slug, name, icon FROM categories
        WHERE is_active AND (name ILIKE ${like} OR name ILIKE ${wordLike})
        ORDER BY (name ILIKE ${like}) DESC, depth DESC, sort_order
        LIMIT 3`,
      this.db.$queryRaw<{ name: string }[]>`
        SELECT min(s.name) AS name
        FROM services s JOIN businesses b ON b.id = s.business_id
        WHERE s.is_active AND ${VISIBLE} AND (s.name ILIKE ${like} OR s.name ILIKE ${wordLike})
        GROUP BY lower(s.name)
        ORDER BY (min(s.name) ILIKE ${like}) DESC, count(*) DESC
        LIMIT 3`,
    ]);
    return { businesses, categories, services: services.map((s) => s.name) };
  }

  /**
   * Homepage picks: verified, with a photo, the best quality first — at most
   * two per category so the page isn't all barbers. (Paid placement comes with ads.)
   */
  async featured(
    input: { lat?: number | undefined; lng?: number | undefined; city?: string | undefined; limit: number },
    now = new Date(),
  ) {
    const point = pointOf(input);
    const near = point
      ? Prisma.sql`AND extensions.ST_DWithin(b.location, extensions.ST_SetSRID(extensions.ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::extensions.geography, 50000)`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<Row[]>`
      SELECT * FROM (
        SELECT ${COLUMNS}, ${openAt(now)} AS open_now, NULL::float8 AS distance_m, 0::int AS total,
               ${QUALITY}::float8 AS quality,
               row_number() OVER (PARTITION BY b.category_id ORDER BY ${QUALITY} DESC, b.id) AS in_category
        FROM businesses b
        ${JOINS(now)}
        WHERE ${VISIBLE} AND ${OFFERS_SOMETHING} AND b.verified AND cover.storage_key IS NOT NULL
          ${input.city ? Prisma.sql`AND lower(b.city) = lower(${input.city})` : Prisma.empty}
          ${near}
      ) ranked
      WHERE in_category <= 2
      ORDER BY quality DESC, id
      LIMIT ${Math.min(input.limit, 24)}`;
    return Promise.all(rows.map((r) => this.view(r)));
  }

  /**
   * Cities with businesses on BUKU (shown and offering something), the most
   * first: for the city picker and for honest figures ("12 places in Lahore").
   */
  async cities(): Promise<{ city: string; country: string; businesses: number }[]> {
    const rows = await this.db.$queryRaw<{ city: string; country: string; businesses: bigint }[]>`
      SELECT min(b.city) AS city, b.country, count(*) AS businesses
      FROM businesses b
      WHERE ${VISIBLE} AND ${OFFERS_SOMETHING_PLAIN}
      GROUP BY lower(b.city), b.country
      ORDER BY count(*) DESC, min(b.city)
      LIMIT 200`;
    return rows.map((r) => ({ city: r.city, country: r.country, businesses: Number(r.businesses) }));
  }

  /** Busiest this week in a city or around a point (bookings + queue joins; at least 3). */
  async trending(
    input: {
      lat?: number | undefined;
      lng?: number | undefined;
      radiusKm?: number | undefined;
      city?: string | undefined;
      limit: number;
    },
    now = new Date(),
  ) {
    const point = pointOf(input);
    if (!point && !input.city) throw AppError.badRequest('Give a city, or lat and lng');
    const where = point
      ? Prisma.sql`extensions.ST_DWithin(b.location, extensions.ST_SetSRID(extensions.ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::extensions.geography, ${(input.radiusKm ?? 25) * 1000})`
      : Prisma.sql`lower(b.city) = lower(${input.city})`;
    const rows = await this.db.$queryRaw<Row[]>`
      SELECT ${COLUMNS}, ${openAt(now)} AS open_now, NULL::float8 AS distance_m, 0::int AS total
      FROM businesses b
      ${JOINS(now)}
      WHERE ${VISIBLE} AND ${OFFERS_SOMETHING} AND ${where}
        AND (st.bookings_7d + st.queue_joins_7d) >= 3
      ORDER BY (st.bookings_7d + st.queue_joins_7d) DESC,
               (st.bookings_7d - st.bookings_prev_7d) DESC, b.id
      LIMIT ${Math.min(input.limit, 24)}`;
    return Promise.all(rows.map((r) => this.view(r)));
  }

  /** One result as the apps show it. Built field by field (nothing leaks by accident). */
  private async view(r: Row) {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: { slug: r.category_slug, name: r.category_name },
      city: r.city,
      address: r.address,
      location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
      distanceKm: r.distance_m === null ? null : Math.round(r.distance_m / 100) / 10,
      rating: { average: r.avg_rating, count: r.review_count },
      verified: r.verified,
      /** Share of bookings the business kept (didn't cancel), once there are enough to say. */
      reliability: businessReliability(r.kept ?? 0, r.business_cancels ?? 0),
      priceFrom: r.min_price === null ? null : { amount: r.min_price, currency: r.currency },
      openNow: r.open_now,
      queue: r.queue_open ? { open: true, waiting: r.waiting ?? 0 } : null,
      logoUrl: r.logo_storage_key ? await this.links.publicUrl(r.logo_storage_key) : null,
      coverPhotoUrl: r.cover_key ? await this.links.publicUrl(r.cover_key) : null,
      /** Paid placements arrive with the ads service; organic results are never promoted. */
      isPromoted: false,
    };
  }
}

// ── SQL building blocks ─────────────────────────────────────────────────────

function pointOf(i: { lat?: number | undefined; lng?: number | undefined }) {
  return i.lat !== undefined && i.lng !== undefined ? { lat: i.lat, lng: i.lng } : null;
}

const COLUMNS = Prisma.sql`
  b.id, b.slug, b.name, b.city, b.address, b.lat::float8 AS lat, b.lng::float8 AS lng, b.verified,
  b.avg_rating::float8 AS avg_rating, b.review_count, b.currency, b.logo_storage_key,
  b.created_at, b.category_id,
  c.slug AS category_slug, c.name AS category_name,
  cover.storage_key AS cover_key, price.min_price::float8 AS min_price,
  st.kept_90d AS kept, st.business_cancels_90d AS business_cancels,
  qs.open AS queue_open, qs.waiting::int AS waiting`;

/** Category (and its parent), cover photo, lowest price, ranking figures, today's queue. */
const JOINS = (now: Date) => Prisma.sql`
  JOIN categories c ON c.id = b.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  LEFT JOIN business_search_stats st ON st.business_id = b.id
  LEFT JOIN LATERAL (
    SELECT ph.storage_key FROM business_photos ph
    WHERE ph.business_id = b.id AND ph.uploaded_at IS NOT NULL
    ORDER BY ph.is_primary DESC, ph.sort_order LIMIT 1) cover ON true
  LEFT JOIN LATERAL (
    SELECT min(s.price) FILTER (WHERE s.currency = b.currency) AS min_price, count(*) AS services
    FROM services s WHERE s.business_id = b.id AND s.is_active) price ON true
  LEFT JOIN LATERAL (
    SELECT true AS open,
           (SELECT count(*) FROM queue_entries e WHERE e.session_id = qs1.id AND e.status = 'waiting') AS waiting
    FROM queue_sessions qs1
    WHERE qs1.business_id = b.id AND qs1.status = 'open'
      AND qs1.session_date = (${now}::timestamptz AT TIME ZONE b.timezone)::date) qs ON true`;

/** Something to book or a queue to join. */
const OFFERS_SOMETHING = Prisma.sql`(price.services > 0 OR EXISTS (
  SELECT 1 FROM queue_settings x WHERE x.business_id = b.id))`;
const OFFERS_SOMETHING_PLAIN = Prisma.sql`(
  EXISTS (SELECT 1 FROM services s WHERE s.business_id = b.id AND s.is_active)
  OR EXISTS (SELECT 1 FROM queue_settings x WHERE x.business_id = b.id))`;

const BAYES = Prisma.sql`((b.avg_rating * b.review_count + ${WEIGHTS.priorRating * WEIGHTS.priorReviews}::float8)
  / (b.review_count + ${WEIGHTS.priorReviews}::float8))`;
const RELIABILITY = Prisma.sql`(CASE
  WHEN coalesce(st.kept_90d, 0) + coalesce(st.business_cancels_90d, 0) >= ${WEIGHTS.minDecidedForReliability}::float8
  THEN st.kept_90d::float8 / (st.kept_90d + st.business_cancels_90d)
  ELSE ${WEIGHTS.priorReliability}::float8 END)`;
/** 0..1.05: rating (70%), reliability (30%), verified (+0.05). */
const QUALITY = Prisma.sql`(0.7 * ${BAYES} / 5 + 0.3 * ${RELIABILITY}
  + CASE WHEN b.verified THEN 0.05 ELSE 0 END)`;
const proximity = Prisma.sql`${WEIGHTS.proximity}::float8 / (1 + extensions.ST_Distance(b.location, p.point) / 1000 / ${WEIGHTS.halfDistanceKm}::float8)`;

/**
 * Typo tolerance on the name: EVERY word of the query is (roughly) in it —
 * words of 4+ letters by trigram word similarity ("barbr" ≈ "Barbers"),
 * shorter ones literally. So "smile beard" doesn't match "Smile Dental".
 */
function typoMatch(ws: string[]) {
  if (!ws.length) return Prisma.sql`false`;
  return Prisma.sql`(${Prisma.join(
    ws.map((w) =>
      w.length >= WEIGHTS.typoMinLength
        ? Prisma.sql`extensions.word_similarity(${w}::text, b.name) >= ${WEIGHTS.typoThreshold}::float8`
        : Prisma.sql`b.name ILIKE ${`%${escapeLike(w)}%`}`,
    ),
    ' AND ',
  )})`;
}

function textScore(hasTsq: boolean) {
  return Prisma.sql`(
    ${hasTsq ? Prisma.sql`ts_rank_cd(b.search_vector, p.tsq)` : Prisma.sql`0`}
    + ${WEIGHTS.nameSimilarity}::float8 * extensions.word_similarity(p.q, b.name))`;
}

/** Local "HH:MM" and weekday (0 = Sunday) at the business, at `now`. */
const localHm = (now: Date) => Prisma.sql`to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'HH24:MI')`;
const localDow = (now: Date) =>
  Prisma.sql`extract(dow FROM ${now}::timestamptz AT TIME ZONE b.timezone)::int`;

/**
 * Open at `now`: inside one of today's ranges (stored hours never cross
 * midnight — late hours are two ranges, 22:00–23:59 and 00:00–02:00) and not
 * closed by a business-wide closure covering this moment.
 */
function openAt(now: Date) {
  const hm = localHm(now);
  return Prisma.sql`(EXISTS (
      SELECT 1 FROM business_hours h
      WHERE h.business_id = b.id AND NOT h.is_closed AND h.day_of_week = ${localDow(now)}
        AND ${hm} >= h.open_time AND ${hm} < h.close_time)
    AND NOT EXISTS (
      SELECT 1 FROM availability_exceptions x
      WHERE x.business_id = b.id AND x.staff_id IS NULL AND x.resource_id IS NULL
        AND x.type <> 'extra_hours'
        AND x.exception_date = (${now}::timestamptz AT TIME ZONE b.timezone)::date
        AND (x.start_time IS NULL OR (${hm} >= x.start_time AND ${hm} < x.end_time))))`;
}

/** Open at some point on a local date: has hours that weekday and isn't closed all day. */
function openOn(date: string) {
  return Prisma.sql`(EXISTS (
      SELECT 1 FROM business_hours h
      WHERE h.business_id = b.id AND NOT h.is_closed
        AND h.day_of_week = extract(dow FROM ${date}::date)::int)
    AND NOT EXISTS (
      SELECT 1 FROM availability_exceptions x
      WHERE x.business_id = b.id AND x.staff_id IS NULL AND x.resource_id IS NULL
        AND x.type <> 'extra_hours' AND x.exception_date = ${date}::date AND x.start_time IS NULL))`;
}
