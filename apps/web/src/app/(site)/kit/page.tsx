import { notFound } from 'next/navigation';
import { Container, PageHeading } from '@/components/ui/layout';
import { KitDemos } from './kit-demos';

export const metadata = { title: 'UI kit', robots: { index: false, follow: false } };

/**
 * Every building block of the BUKU interface, in one place, in light and dark
 * — for building and reviewing the design. Development and previews only;
 * there is no such page in production. Sample content is marked "Example".
 */
export default function KitPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();
  return (
    <Container className="flex flex-col gap-12 py-12">
      <PageHeading
        eyebrow="Design system"
        title="BUKU UI kit"
        description="The components every screen is built from. Switch the theme in the header to check dark mode."
      />
      <KitDemos />
    </Container>
  );
}
