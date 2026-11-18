import { describe, expect, it } from 'vitest';
import {
  breadcrumbData,
  categoryCopy,
  categoryQuestions,
  inSentence,
  placeOf,
  withArticle,
} from '../src/features/categories/guide';
import { GROUP_GUIDES, KIND_GUIDES } from '../src/features/categories/guide-content';
import { CATEGORY_SNAPSHOT } from '../src/features/categories/snapshot';

const kinds = CATEGORY_SNAPSHOT.flatMap((g) => g.children);

describe('A page for every category (D-139)', () => {
  it('every kind and group has words of its own, and nothing is left for kinds that are gone', () => {
    expect(Object.keys(KIND_GUIDES).sort()).toEqual(kinds.map((k) => k.slug).sort());
    expect(Object.keys(GROUP_GUIDES).sort()).toEqual(CATEGORY_SNAPSHOT.map((g) => g.slug).sort());
    const intros = new Set<string>();
    for (const [slug, g] of Object.entries(KIND_GUIDES)) {
      expect(g.book.length, slug).toBeGreaterThanOrEqual(3);
      expect(g.book.length, slug).toBeLessThanOrEqual(5);
      expect(g.intro.length, slug).toBeLessThanOrEqual(200);
      expect(g.intro, slug).not.toMatch(/[—<>]/); // plain words: no em dashes, no markup
      intros.add(g.intro);
    }
    expect(intros.size).toBe(kinds.length); // no two pages open the same way
  });

  it('names read as they should in a sentence', () => {
    expect(inSentence('ENT Specialist')).toBe('ENT specialist');
    expect(inSentence('Car AC Repair')).toBe('car AC repair');
    expect(inSentence('Hospital OPD')).toBe('hospital OPD');
    expect(inSentence('Lash & Brow Studio')).toBe('lash & brow studio');
    expect(withArticle('ENT specialist')).toBe('an ENT specialist');
    expect(withArticle('optician')).toBe('an optician');
    expect(withArticle('barbershop')).toBe('a barbershop');
    expect(withArticle('union council office')).toBe('a union council office');
    expect(withArticle('utility services')).toBe('a utility services');
  });

  it('titles and descriptions fit search results, worded for how people come', () => {
    for (const node of [...CATEGORY_SNAPSHOT, ...kinds]) {
      const { title, description } = categoryCopy(placeOf(node.slug)!);
      expect(`${title} · BUKU`.length, node.slug).toBeLessThanOrEqual(70);
      // Search results show about 160 characters of a description.
      expect(description.length, node.slug).toBeLessThanOrEqual(160);
    }
    expect(categoryCopy(placeOf('passport-office')!).title).toBe(
      'Passport Office queue online: skip the wait',
    );
    expect(categoryCopy(placeOf('dental-clinic')!).title).toBe('Dental Clinic appointments online');
    expect(categoryCopy(placeOf('barbershop')!).title).toBe('Barbershop booking and walk-in queue online');
  });

  it('asks what people ask: queues where they queue, bookings where they book', () => {
    const ids = (slug: string, early = true) => categoryQuestions(placeOf(slug)!, early).map((q) => q.id);
    expect(ids('passport-office')).toEqual(['queue', 'free', 'when', 'business']);
    expect(ids('dental-clinic')).toEqual(['book', 'free', 'when', 'business']);
    expect(ids('barbershop')).toEqual(['book', 'queue', 'free', 'when', 'business']);
    expect(ids('barbershop', false)).toContain('near');
    const queue = categoryQuestions(placeOf('passport-office')!, true);
    expect(queue[0]!.q).toBe('Can I join the passport office queue from home?');
  });

  it('says where each page sits, and knows the ones that don’t exist', () => {
    const crumbs = breadcrumbData('https://onbuku.com', placeOf('ent-specialist')!);
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual([
      'Home',
      'Categories',
      'Health & Medical',
      'ENT Specialist',
    ]);
    expect(crumbs.itemListElement.at(-1)!.item).toBe('https://onbuku.com/c/ent-specialist');
    expect(placeOf('no-such-kind')).toBeNull();
    expect(placeOf('fitness')).toMatchObject({ parent: null });
  });
});
