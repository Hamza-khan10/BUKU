/**
 * The WhatsApp templates BUKU uses outside the 24-hour window (D-074). Each
 * must be created and approved in Meta's WhatsApp Manager with EXACTLY this
 * name, category Utility, and these body variables in this order. A type
 * missing here never goes as a paid template.
 */
export const WHATSAPP_TEMPLATES: Record<string, { name: string; example: string }> = {
  booking_confirmed: {
    name: 'buku_booking_confirmed',
    example: 'Your booking at {{1}} is confirmed: {{2}} on {{3}}. Your code: {{4}}.',
  },
  booking_cancelled_by_business: {
    name: 'buku_booking_cancelled',
    example: '{{1}} had to cancel your {{2}} on {{3}}. Please book another time in the BUKU app.',
  },
  reminder_24h: {
    name: 'buku_reminder_day_before',
    example: 'Reminder: {{2}} at {{1}} on {{3}}. Your code: {{4}}. Can’t make it? Cancel in the BUKU app.',
  },
  reminder_2h: {
    name: 'buku_reminder_soon',
    example: 'See you soon: {{2}} at {{1}}, {{3}}. Show code {{4}} when you arrive.',
  },
  queue_called: {
    name: 'buku_queue_called',
    example: 'It’s your turn — ticket {{1}}. Please come to the counter at {{2}}.',
  },
};

/** The message types an admin may allow as paid templates. */
export const PAYABLE_TYPES = Object.keys(WHATSAPP_TEMPLATES);
