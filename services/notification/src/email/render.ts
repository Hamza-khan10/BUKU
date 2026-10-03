import { timingSafeEqual } from 'node:crypto';
import type { BlindIndexer } from '@buku/common';
import { emailPrefOf } from '../channels.js';
import type { Message } from '../messages.js';
import type { EmailMessage } from './sender.js';

/**
 * A message as an email (D-073): the same title and text as the push, a
 * button into the app, and a footer saying why they got it. Everything is
 * HTML-escaped (names and reasons are typed by people). Emails that a
 * preference controls carry a one-click unsubscribe (RFC 8058) for exactly
 * that preference, signed so nobody can switch off someone else's emails.
 */

export interface EmailLinks {
  webAppUrl: string;
  publicApiUrl: string;
  indexer: BlindIndexer;
}

/** The app screen a message opens, as a web path. */
export function webPath(data: Message['data']): string {
  const id = (k: string) => encodeURIComponent(String(data[k] ?? ''));
  switch (data.screen) {
    case 'appointment':
      return `/appointments/${id('appointmentId')}`;
    case 'business-appointment':
      return `/business/${id('businessId')}/appointments/${id('appointmentId')}`;
    case 'queue-ticket':
      return `/queue/${id('entryId')}`;
    case 'book':
      return `/b/${id('businessId')}?service=${id('serviceId')}${
        data.staffId ? `&staff=${id('staffId')}` : ''
      }${data.startAt ? `&at=${id('startAt')}` : ''}`;
    case 'business-billing':
      return `/business/${id('businessId')}/billing`;
    case 'billing':
      return '/account/billing';
    case 'business':
      return `/b/${id('businessId')}`;
    case 'explore':
      return '/explore';
    default:
      return '/';
  }
}

const UNSUBSCRIBE_CONTEXT = 'notifications.unsubscribe';

export function unsubscribeSignature(indexer: BlindIndexer, userId: string, pref: string): string {
  return indexer.hash(UNSUBSCRIBE_CONTEXT, `${userId}:${pref}`);
}

export function checkUnsubscribeSignature(
  indexer: BlindIndexer,
  userId: string,
  pref: string,
  signature: string,
): boolean {
  const expected = Buffer.from(unsubscribeSignature(indexer, userId, pref));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(links: EmailLinks, userId: string, pref: string): string {
  const q = new URLSearchParams({ u: userId, p: pref, s: unsubscribeSignature(links.indexer, userId, pref) });
  return `${links.publicApiUrl}/v1/notifications/unsubscribe?${q.toString()}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PREF_LABEL: Record<string, string> = {
  emailBookingConfirmation: 'booking confirmations and changes',
  emailReminders: 'reminders',
  emailBusinessAlerts: 'booking alerts for your business',
  marketingEmails: 'suggestions and news from BUKU',
};

export function renderEmail(to: string, userId: string, message: Message, links: EmailLinks): EmailMessage {
  const open = `${links.webAppUrl}${webPath(message.data)}`;
  const pref = emailPrefOf(message.type);
  const unsub = pref ? unsubscribeUrl(links, userId, pref) : null;
  const why = pref
    ? `You get these emails for ${PREF_LABEL[pref]}. Turn them off: ${unsub}`
    : 'This is about your BUKU account, so it is always sent.';
  const settings = `${links.webAppUrl}/account/notifications`;

  const text = `${message.title}\n\n${message.body}\n\nOpen in BUKU: ${open}\n\n—\n${why}\nAll notification settings: ${settings}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;color:#78716c">BUKU</p>
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(message.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escapeHtml(message.body)}</p>
<a href="${escapeHtml(open)}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Open in BUKU</a>
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#78716c">${
    unsub
      ? `You get these emails for ${escapeHtml(PREF_LABEL[pref!]!)}. <a href="${escapeHtml(unsub)}" style="color:#78716c">Turn them off</a>.`
      : 'This is about your BUKU account, so it is always sent.'
  } <a href="${escapeHtml(settings)}" style="color:#78716c">All notification settings</a>.</p>
</body></html>`;

  return {
    to,
    subject: message.title,
    text,
    html,
    ...(unsub && {
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  };
}
