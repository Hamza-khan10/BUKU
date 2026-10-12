import { Container } from '@/components/ui/layout';

/**
 * The business area (3.5): the businesses someone owns or works at. Signed-out visitors never
 * get here (the proxy sends them to sign in first), and the API answers only to the team.
 */
export default function BusinessLayout({ children }: LayoutProps<'/business'>) {
  return <Container className="flex flex-col gap-8 py-8 sm:py-14">{children}</Container>;
}
