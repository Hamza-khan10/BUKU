/** Notification settings as the API shows them to platform admins (notification-service). */
export interface NotificationSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappPaidTypes: string[];
  whatsappMonthlyBudgetCents: number;
  whatsappMessageCostCents: number;
  whatsappFreeWindowPerMonth: number;
  reminder24h: boolean;
  reminder2h: boolean;
  quietStartHour: number;
  quietEndHour: number;
  suggestionsEnabled: boolean;
  suggestionMinDays: number;
  suggestionMaxPer30Days: number;
  suggestionMaxIgnored: number;
  updatedAt: string;
}

export interface WhatsappUsage {
  month: string;
  windowMessages: number;
  templateMessages: number;
  estimatedCents: number;
  budgetCents: number;
}

export interface WhatsappTemplate {
  type: string;
  name: string;
  category: string;
  example: string;
}

/** Each kind of message in words. */
export const MESSAGE_TYPES: Record<string, string> = {
  booking_confirmed: 'Booking confirmed',
  booking_cancelled_by_business: 'Cancelled by the business',
  reminder_24h: 'Reminder, the day before',
  reminder_2h: 'Reminder, two hours before',
  queue_called: 'Called in the queue: your turn',
};
