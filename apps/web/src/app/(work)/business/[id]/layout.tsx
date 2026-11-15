import { isPublicId } from '@buku/validation';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Workspace } from '@/features/manage/components/workspace';
import { signedInHere } from '@/lib/session/server';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';

/** One business's workspace: its bar, its menu (a sidebar, or tabs on a phone), and the page. */
export default async function OneBusinessLayout({ children, params }: LayoutProps<'/business/[id]'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <Workspace id={id} theme={theme} signedIn={await signedInHere()}>
      {children}
    </Workspace>
  );
}
