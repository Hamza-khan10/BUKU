import { isDecimalId, isPublicId } from '@buku/validation';
import { bookHref } from '@/features/booking/choices';

/**
 * Where a message leads on this site, from its `data.screen` (the same data
 * the phone app uses). Only pages that exist here; anything else (the team's
 * own screens, plan pages not built yet) is shown without a link. Pure, tested.
 */
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
/** An appointment and a business by their public IDs; a service, an employee, a ticket by decimal IDs (DB-042). */
const publicOf = (v: unknown) => (isPublicId(v) ? v : undefined);
const idOf = (v: unknown) => (isDecimalId(v) ? v : undefined);

export function linkFor(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  switch (data.screen) {
    case 'appointment': {
      const appointment = publicOf(data.appointmentId);
      return appointment ? `/appointments/${appointment}` : null;
    }
    case 'review': {
      const appointment = publicOf(data.appointmentId);
      return appointment ? `/appointments/${appointment}/review` : null;
    }
    case 'queue-ticket': {
      const entry = idOf(data.entryId) ?? idOf(data.ticketId);
      return entry ? `/queue/${entry}` : null;
    }
    case 'book': {
      const business = publicOf(data.businessId);
      if (!business) return null;
      // A link by id settles on the business's own address (the booking page redirects).
      return bookHref(business, {
        serviceId: idOf(data.serviceId) ?? null,
        staffId: idOf(data.staffId) ?? null,
        startAt:
          str(data.startAt) && !Number.isNaN(Date.parse(str(data.startAt)!)) ? str(data.startAt)! : null,
      });
    }
    case 'business': {
      const business = publicOf(data.businessId);
      return business ? `/b/${business}` : null;
    }
    case 'explore':
      return '/explore';
    default:
      return null;
  }
}
