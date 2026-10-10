import { bookHref } from '@/features/booking/choices';

/**
 * Where a message leads on this site, from its `data.screen` (the same data
 * the phone app uses). Only pages that exist here; anything else (the team's
 * own screens, plan pages not built yet) is shown without a link. Pure, tested.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const id = (v: unknown) => {
  const s = str(v);
  return s && UUID.test(s) ? s : undefined;
};

export function linkFor(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  switch (data.screen) {
    case 'appointment': {
      const appointment = id(data.appointmentId);
      return appointment ? `/appointments/${appointment}` : null;
    }
    case 'review': {
      const appointment = id(data.appointmentId);
      return appointment ? `/appointments/${appointment}/review` : null;
    }
    case 'queue-ticket': {
      const entry = id(data.entryId) ?? id(data.ticketId);
      return entry ? `/queue/${entry}` : null;
    }
    case 'book': {
      const business = id(data.businessId);
      if (!business) return null;
      // A link by id settles on the business's own address (the booking page redirects).
      return bookHref(business, {
        serviceId: id(data.serviceId) ?? null,
        staffId: id(data.staffId) ?? null,
        startAt:
          str(data.startAt) && !Number.isNaN(Date.parse(str(data.startAt)!)) ? str(data.startAt)! : null,
      });
    }
    case 'business': {
      const business = id(data.businessId);
      return business ? `/b/${business}` : null;
    }
    case 'explore':
      return '/explore';
    default:
      return null;
  }
}
