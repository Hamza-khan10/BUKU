/** Time zones to choose from, labelled the way people read them. */

export interface ZoneOption {
  value: string;
  label: string;
}

/** "GMT+5", "GMT-3:30", "GMT" — the zone's offset at `now`. */
export function offsetOf(zone: string, now: Date): string {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName');
  // Some engines write UTC itself as "GMT+0" or "UTC".
  return !part || /^(GMT|UTC)([+-]0)?$/.test(part.value) ? 'GMT' : part.value;
}

/** "Asia/Karachi" → "Asia / Karachi (GMT+5)"; "America/Argentina/Buenos_Aires" → "America / Argentina / Buenos Aires (GMT-3)". */
export function zoneLabel(zone: string, now: Date): string {
  return `${zone.replaceAll('_', ' ').split('/').join(' / ')} (${offsetOf(zone, now)})`;
}

/**
 * Every zone this browser knows, alphabetically, always including `current`
 * (an account's zone may be one the browser lists under another name) and UTC.
 */
export function zoneOptions(current: string, now: Date): ZoneOption[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = [...new Set([...known, 'UTC', current])].sort((a, b) => a.localeCompare(b));
  return zones.map((value) => ({ value, label: zoneLabel(value, now) }));
}
