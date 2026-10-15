import { Container } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { BusinessGridSkeleton } from '@/features/search/components/business-card';

/** Explore on its way: the page's own shape, never a blank screen or a lone spinner. */
export default function ExploreLoading() {
  return (
    <Container className="flex flex-col gap-10 py-8 sm:gap-12 sm:py-14">
      <div aria-hidden className="flex flex-col gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-64 sm:h-16 sm:w-80" />
        <Skeleton className="h-13 w-full max-w-2xl rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-28 rounded-full" />
          ))}
        </div>
      </div>
      <BusinessGridSkeleton count={6} label="Loading places" />
    </Container>
  );
}
