import { SkipLink } from '@/components/layout/site-header';

/**
 * The workspace (D-133): a business's own pages, as an app rather than a page of the website. No
 * marketing header or footer; each business's layout draws its own bar, menu and tabs.
 */
export default function WorkLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}
