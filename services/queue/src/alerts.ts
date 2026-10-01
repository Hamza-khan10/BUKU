/**
 * When to tell a waiting customer how many people are ahead (decision Q16):
 * at 10 ahead, at 5 ahead, then at every step after that. Only when they
 * move CLOSER (someone joining the priority lane can push them back without
 * an alert) and never twice for the same count. Joining already close
 * (e.g. 3 ahead) alerts at once.
 */
export function shouldAlert(ahead: number, lastAlerted: number | null): boolean {
  if (lastAlerted !== null && ahead >= lastAlerted) return false;
  if (ahead <= 5) return true;
  return ahead <= 10 && (lastAlerted === null || lastAlerted > 10);
}

/** Minutes until it's probably your turn: people ahead, shared among the staff on shift. */
export function estimateWaitMinutes(ahead: number, avgServiceSeconds: number, staffOnShift: number): number {
  const rounds = Math.ceil(ahead / Math.max(1, staffOnShift));
  return Math.ceil((rounds * avgServiceSeconds) / 60);
}

/** "A-023": the ticket as shown, called out and encoded in the QR. */
export const ticketLabel = (prefix: string, number: number) => `${prefix}-${String(number).padStart(3, '0')}`;
