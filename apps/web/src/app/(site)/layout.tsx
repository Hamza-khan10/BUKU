import { cookies } from 'next/headers';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader, SkipLink } from '@/components/layout/site-header';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';

/** The public website: header, page, footer. */
export default async function SiteLayout({ children }: LayoutProps<'/'>) {
  const jar = await cookies();
  const theme = themeFrom(jar.get(THEME_COOKIE)?.value);
  // The session hint (no secret): whether to show the account menu or "Sign in" (no flash).
  const signedIn = jar.has('__Host-buku_s') || jar.has('buku_s');
  return (
    <>
      <SkipLink />
      <SiteHeader theme={theme} signedIn={signedIn} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
