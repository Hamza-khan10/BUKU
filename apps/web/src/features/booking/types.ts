/** Shapes of the booking API's answers (booking-service, docs/API_REFERENCE.md). */

export interface Slot {
  /** Exactly what to send back when booking (ISO, UTC). */
  startAt: string;
  endAt: string;
  /** The business's local wall-clock time, "10:30". */
  time: string;
  /** Who is free then. */
  staffIds: string[];
}

export interface Availability {
  timezone: string;
  serviceId: string;
  durationMinutes: number;
  days: { date: string; slots: Slot[] }[];
}

export type AppointmentStatus =
  'pending' | 'confirmed' | 'rescheduled' | 'completed' | 'cancelled' | 'no_show';

/** The customer's receipt (D-057): the appointment itself, nothing generated or stored. */
export interface Receipt {
  id: string;
  code: string;
  /** What the QR code holds: the code, never personal data. */
  qr: string;
  status: AppointmentStatus;
  business: {
    id: string;
    slug: string;
    name: string;
    address: { line: string; city: string };
    phone: string | null;
  };
  service: { id: string; name: string; durationMinutes: number };
  staff: { id: string; displayName: string } | null;
  startAt: string;
  endAt: string;
  local: { date: string; startTime: string; endTime: string; timezone: string };
  price: string;
  currency: string;
  payment: 'pay_at_venue';
  notes: string | null;
  policy: { canCancel: boolean; freeCancellationUntil: string; canReschedule: boolean };
  checkedInAt: string | null;
  cancellation: {
    cancelledAt: string | null;
    cancelledBy: string | null;
    reasonCode: string | null;
    reason: string | null;
  } | null;
  rescheduledFromId: string | null;
  createdAt: string;
}
