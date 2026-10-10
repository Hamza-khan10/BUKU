import type { Receipt } from './types';

/**
 * "Add to calendar": an iCalendar file (RFC 5545) for one visit, made in the
 * browser from the receipt — no address or code goes to anyone else. Works
 * with Google Calendar, Apple Calendar and Outlook. Pure, and tested.
 */

/** 20261006T050000Z — a moment in UTC, as calendars expect. */
export const icsMoment = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Text the way iCalendar needs it: backslashes, semicolons, commas and line breaks escaped. */
export const icsText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes.encode(current + ch).length > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function icsFor(r: Receipt, receiptUrl: string, now: Date): string {
  const what = `${r.service.name} at ${r.business.name}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BUKU//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${r.id}@buku`,
    `DTSTAMP:${icsMoment(now.toISOString())}`,
    `DTSTART:${icsMoment(r.startAt)}`,
    `DTEND:${icsMoment(r.endAt)}`,
    `SUMMARY:${icsText(what)}`,
    `LOCATION:${icsText(`${r.business.address.line}, ${r.business.address.city}`)}`,
    `DESCRIPTION:${icsText(
      `${r.staff ? `With ${r.staff.displayName}. ` : ''}Booking code ${r.code}: show it at the front desk.\n${receiptUrl}`,
    )}`,
    `URL:${receiptUrl}`,
    // A request the business hasn't confirmed yet is tentative.
    `STATUS:${r.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** "buku-fade-masters-2026-10-06.ics" */
export const icsFileName = (r: Receipt) => `buku-${r.business.slug}-${r.local.date}.ics`;
