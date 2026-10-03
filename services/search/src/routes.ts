import { AppError, sendSuccess, validated } from '@buku/common';
import { createEvent, TOPICS } from '@buku/kafka';
import type { Express, Response } from 'express';
import { z } from 'zod';
import type { Categories, CategoryNode } from './categories.js';
import type { SearchInput, SearchService } from './search-service.js';
import { MAX_QUERY_LENGTH, queryForAnalytics } from './text.js';

/** Where search events go (best effort; never slows or fails a search). */
export interface SearchAnalytics {
  searched(e: {
    query: string;
    category: string | null;
    city: string | null;
    nearby: boolean;
    filters: string[];
    sort: string;
    page: number;
    results: number;
  }): void;
}

export interface RouteDeps {
  search: SearchService;
  categories: Categories;
  analytics: SearchAnalytics;
}

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const Lat = z.coerce.number().min(-90).max(90);
const Lng = z.coerce.number().min(-180).max(180);
const Slug = z.string().regex(/^[a-z0-9-]{1,100}$/);
const City = z.string().trim().min(1).max(100);

const bothOrNeither = (v: { lat?: number | undefined; lng?: number | undefined }) =>
  (v.lat === undefined) === (v.lng === undefined);
const pointRule = { message: 'Give both lat and lng, or neither', path: ['lat'] };

const SearchQuery = z
  .object({
    q: z
      .string()
      .max(MAX_QUERY_LENGTH * 2)
      .optional(),
    lat: Lat.optional(),
    lng: Lng.optional(),
    radiusKm: z.coerce.number().min(0.1).max(100).optional(),
    city: City.optional(),
    category: Slug.optional(),
    minRating: z.coerce.number().min(1).max(5).optional(),
    verifiedOnly: bool,
    openNow: bool,
    hasQueue: bool,
    availableDate: z.iso.date().optional(),
    sort: z.enum(['relevance', 'distance', 'rating', 'newest']).optional(),
    page: z.coerce.number().int().min(1).max(50).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(bothOrNeither, pointRule);

const NearQuery = z
  .object({
    lat: Lat.optional(),
    lng: Lng.optional(),
    radiusKm: z.coerce.number().min(0.1).max(100).optional(),
    city: City.optional(),
    limit: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict()
  .refine(bothOrNeither, pointRule);

const AutocompleteQuery = z
  .object({
    q: z.string().max(MAX_QUERY_LENGTH * 2),
    lat: Lat.optional(),
    lng: Lng.optional(),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .strict()
  .refine(bothOrNeither, pointRule);

const SlugParams = z.object({ slug: Slug });

/** Public, the same for everyone: shared caches may keep it briefly. */
const cacheable = (res: Response, seconds: number) =>
  res.setHeader('Cache-Control', `public, max-age=${seconds}`);

const categoryView = (n: CategoryNode): object => ({
  slug: n.slug,
  name: n.name,
  icon: n.icon,
  children: n.children.map(categoryView),
});

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const run = async (input: SearchInput, res: Response) => {
    const { items, meta } = await deps.search.search(input);
    deps.analytics.searched({
      query: input.q ? queryForAnalytics(input.q) : '',
      category: input.category ?? null,
      city: input.city ?? null,
      nearby: input.lat !== undefined,
      filters: (['minRating', 'verifiedOnly', 'openNow', 'hasQueue', 'availableDate'] as const).filter(
        (k) => input[k] !== undefined && input[k] !== false,
      ),
      sort: meta.sort,
      page: input.page,
      results: meta.total,
    });
    res.setHeader('Cache-Control', 'no-store'); // open-now and queues change by the minute
    sendSuccess(res, items, 200, meta);
  };

  app.get(
    '/v1/businesses/search',
    validated({ query: SearchQuery }, async ({ query }, _req, res) => run(query, res)),
  );
  app.get(
    '/v1/businesses/nearby',
    validated({ query: SearchQuery }, async ({ query }, _req, res) => {
      if (query.lat === undefined) throw AppError.badRequest('Nearby needs lat and lng');
      await run({ ...query, sort: query.sort ?? 'distance', radiusKm: query.radiusKm ?? 5 }, res);
    }),
  );
  app.get(
    '/v1/businesses/autocomplete',
    validated({ query: AutocompleteQuery }, async ({ query }, _req, res) => {
      cacheable(res, 60);
      sendSuccess(res, await deps.search.autocomplete(query));
    }),
  );
  app.get(
    '/v1/businesses/featured',
    validated({ query: NearQuery }, async ({ query }, _req, res) => {
      cacheable(res, 300);
      sendSuccess(res, await deps.search.featured(query));
    }),
  );
  app.get(
    '/v1/businesses/trending',
    validated({ query: NearQuery }, async ({ query }, _req, res) => {
      cacheable(res, 300);
      sendSuccess(res, await deps.search.trending(query));
    }),
  );

  app.get('/v1/categories', async (_req, res) => {
    cacheable(res, 300);
    sendSuccess(res, (await deps.categories.tree()).map(categoryView));
  });
  app.get(
    '/v1/categories/:slug',
    validated({ params: SlugParams }, async ({ params }, _req, res) => {
      const node = await deps.categories.get(params.slug);
      const parent = await deps.categories.parentOf(node);
      cacheable(res, 300);
      sendSuccess(res, {
        ...categoryView(node),
        parent: parent ? { slug: parent.slug, name: parent.name } : null,
      });
    }),
  );
  app.get(
    '/v1/categories/:slug/businesses',
    validated({ params: SlugParams, query: SearchQuery }, async ({ params, query }, _req, res) =>
      run({ ...query, category: params.slug }, res),
    ),
  );
}

/** Search events to `analytics.search` (no user, no coordinates; contact-like queries redacted). */
export function kafkaSearchAnalytics(
  producer: {
    publish(event: ReturnType<typeof createEvent>): Promise<void>;
  },
  onError: (err: unknown) => void,
): SearchAnalytics {
  return {
    searched(e) {
      producer
        .publish(
          createEvent({
            type: TOPICS.ANALYTICS_SEARCH,
            source: 'search-service',
            subject: 'search',
            data: e,
          }),
        )
        .catch(onError);
    },
  };
}
