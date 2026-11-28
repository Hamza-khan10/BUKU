import type { Route } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/layout';
import { CategoryIcon } from '@/features/categories/icons';
import { CityPicker } from '@/features/home/components/city-picker';
import { PlacesRail, type Shelf } from '@/features/home/components/places-rail';
import { SearchBox } from '@/features/search/components/search-box';
import type { CategoryNode, City } from '@/features/search/types';
import { BookAgain } from './book-again';
import { Greeting } from './greeting';
import { RightNow } from './right-now';
import { YourBusinesses } from './your-businesses';

/**
 * Home, once someone is signed in: theirs, not the page that explains BUKU to a first-time visitor.
 * Hello and a search with the kinds people look for most; beside it, on BUKU's board, what matters
 * right now (their number in a line, their next visit, or the invitation to take one); their
 * businesses if they run any; the places they've been, to book again; and real places in their
 * city. What's personal is read in the browser, as everywhere else on BUKU.
 */
export function SignedInHome({
  city,
  cityList,
  kinds,
  shelves,
}: {
  city: string;
  cityList: City[];
  kinds: CategoryNode[];
  shelves: Shelf[];
}) {
  return (
    <div className="flex flex-col gap-14 pb-12 sm:gap-20">
      {/* Phones: hello and search, then what matters right now, then the kinds of place. Wider: the
          board beside them. */}
      <Container className="grid grid-cols-1 items-start gap-6 pt-8 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-x-14">
        <div className="flex flex-col gap-6 lg:pt-4">
          <Greeting />
          <div className="max-w-xl">
            <SearchBox city={city || undefined} />
          </div>
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <RightNow />
        </div>
        {kinds.length > 0 && (
          <nav aria-label="Kinds of place" className="flex max-w-xl flex-wrap gap-2">
            {kinds.map((k) => (
              <Link
                key={k.slug}
                href={`/c/${k.slug}` as Route}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-line transition-[box-shadow] duration-200 hover:ring-control"
              >
                <CategoryIcon slug={k.slug} className="size-4 text-brand-ink" />
                {k.name}
              </Link>
            ))}
            <Link
              href="/categories"
              className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              Every kind of place
            </Link>
          </nav>
        )}
      </Container>

      <Container className="flex flex-col gap-14 empty:hidden">
        <YourBusinesses />
        <BookAgain />
      </Container>

      {city && (
        <Container className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
            <h2 className="type-heading">Places in {city}</h2>
            <CityPicker list={cityList} current={city} />
          </div>
          <PlacesRail shelves={shelves} />
        </Container>
      )}
    </div>
  );
}
