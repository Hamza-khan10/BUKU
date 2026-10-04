/** "just now", "5 min ago", "3 h ago", "yesterday", "2 Oct" — when a message came. Pure, tested. */
export function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'yesterday';
  const sameYear = new Date(then).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(then));
}
