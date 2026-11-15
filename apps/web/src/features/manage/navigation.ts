import {
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  Clock,
  CreditCard,
  ListOrdered,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Tags,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { can, type TeamRole } from './api';

/**
 * A business's own pages, in four groups people can hold in their head, instead of one long row:
 * running the day, people and time, customers, and the business itself. Each person sees only
 * the pages their role can use; the API refuses the rest anyway.
 */

export interface BusinessPage {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface PageGroup {
  title: string;
  pages: BusinessPage[];
}

export function businessPages(id: string, role: TeamRole): PageGroup[] {
  const groups: { title: string; pages: (Omit<BusinessPage, 'href'> & { path: string; show: boolean })[] }[] =
    [
      {
        title: 'Run the day',
        pages: [
          { path: '', label: 'Today', icon: Sun, show: true },
          { path: '/appointments', label: 'Appointments', icon: CalendarCheck, show: true },
          { path: '/calendar', label: 'Calendar', icon: CalendarDays, show: true },
          { path: '/check-in', label: 'Check-in', icon: ScanLine, show: true },
          { path: '/queue', label: 'Queue', icon: ListOrdered, show: true },
        ],
      },
      {
        title: 'People and time',
        pages: [
          { path: '/hours', label: 'Hours', icon: Clock, show: true },
          { path: '/attendance', label: 'Attendance', icon: UserCheck, show: true },
          { path: '/team', label: 'Team', icon: Users, show: can(role, 'staff.manage') },
          { path: '/services', label: 'Services', icon: Tags, show: can(role, 'services.manage') },
        ],
      },
      {
        title: 'Customers',
        pages: [
          { path: '/reviews', label: 'Reviews', icon: Star, show: can(role, 'reviews.respond') },
          { path: '/insights', label: 'Insights', icon: ChartColumn, show: can(role, 'reports.view') },
        ],
      },
      {
        title: 'The business',
        pages: [
          // Everyone may read the plan; it's the owner's to change and the managers' to know about.
          { path: '/billing', label: 'Plan', icon: CreditCard, show: role === 'owner' || role === 'manager' },
          {
            path: '/settings',
            label: 'Settings',
            icon: SlidersHorizontal,
            show: can(role, 'business.update'),
          },
          {
            path: '/verification',
            label: 'Verification',
            icon: ShieldCheck,
            show: can(role, 'business.legal'),
          },
        ],
      },
    ];
  return groups
    .map((g) => ({
      title: g.title,
      pages: g.pages
        .filter((p) => p.show)
        .map((p) => ({ href: `/business/${id}${p.path}`, label: p.label, icon: p.icon })),
    }))
    .filter((g) => g.pages.length > 0);
}

/** The page someone is on, and its group (null on a page that isn't listed, like setup). */
export function currentPage(
  groups: PageGroup[],
  pathname: string,
): { page: BusinessPage; group: string } | null {
  for (const g of groups) {
    const page = g.pages.find((p) => p.href === pathname);
    if (page) return { page, group: g.title };
  }
  return null;
}
