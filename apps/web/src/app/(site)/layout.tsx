import { cookies } from 'next/headers';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader, SkipLink } from '@/components/layout/site-header';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';

/** The public website: header, page, footer. */
export default async function SiteLayout({ children }: LayoutProps<'/'>) {
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <SkipLink />
      <SiteHeader theme={theme} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
