/** A review as its author sees it (GET /v1/appointments/reviews). */
export interface Ratings {
  overall: number;
  waitTime?: number | undefined;
  staff?: number | undefined;
  cleanliness?: number | undefined;
  value?: number | undefined;
}

export interface MyReview {
  id: string;
  appointmentId: string;
  rating: Ratings;
  comment: string | null;
  /** How the business page shows the author: "Ayesha K.". */
  author: string;
  service: string | null;
  staff: string | null;
  /** "2026-10": the month of the visit (never the day). */
  visitedIn: string;
  createdAt: string;
  edited: boolean;
  /** The business's public reply. */
  response: { text: string; at: string | null } | null;
  /** False when BUKU's moderators hid it. */
  visible: boolean;
  editableUntil: string;
  canEdit: boolean;
  business: { id: string; slug: string; name: string };
}
