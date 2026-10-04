/** The customer's queue ticket (D-057), as the queue API shows it. */
export type TicketStatus = 'waiting' | 'called' | 'serving' | 'completed' | 'left' | 'no_show';

export interface QueueTicket {
  id: string;
  /** "A-023" — what the front desk calls out (and the only thing on the public screen). */
  ticket: string;
  qr: string;
  status: TicketStatus;
  business: { id: string; name: string; slug: string };
  /** People before them in the line (waiting only). */
  ahead: number | null;
  estimatedWaitMinutes: number | null;
  priority: boolean;
  joinedAt: string;
  calledAt: string | null;
  /** Called: come to the counter before this, or the ticket may be marked a no-show. */
  comeBy: string | null;
  servedAt: string | null;
}
