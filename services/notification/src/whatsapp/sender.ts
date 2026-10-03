import { randomUUID } from 'node:crypto';
import { logger } from '@buku/common';

/**
 * Sending WhatsApp messages (D-074). Two kinds, priced differently by Meta:
 *  • text     — free-form, only inside the person's 24-hour window (it opens
 *               each time THEY message us); free up to a monthly allowance;
 *  • template — pre-approved by Meta, can be sent any time, always paid.
 * Senders: `log` (development: written to the log) and `meta` (WhatsApp Cloud API).
 * Phone numbers are never logged.
 */

export type WhatsAppResult =
  | { ok: true; id: string }
  | { ok: false; error: string; /** The 24-hour window had closed (Meta 131047). */ windowClosed: boolean };

export interface WhatsAppSender {
  readonly name: string;
  /** Free-form text (inside the 24-hour window). `to` is E.164, e.g. +923001234567. */
  sendText(to: string, body: string): Promise<WhatsAppResult>;
  /** An approved template with its body parameters, in order. */
  sendTemplate(to: string, template: string, language: string, params: string[]): Promise<WhatsAppResult>;
}

export class LogWhatsAppSender implements WhatsAppSender {
  readonly name = 'log';
  private readonly log = logger.child({ module: 'whatsapp-log' });

  sendText(_to: string, body: string): Promise<WhatsAppResult> {
    this.log.info({ kind: 'text', chars: body.length }, 'whatsapp (log sender)');
    return Promise.resolve({ ok: true, id: `log-${randomUUID()}` });
  }

  sendTemplate(_to: string, template: string): Promise<WhatsAppResult> {
    this.log.info({ kind: 'template', template }, 'whatsapp (log sender)');
    return Promise.resolve({ ok: true, id: `log-${randomUUID()}` });
  }
}

export interface MetaSettings {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  timeoutMs?: number;
}

/** WhatsApp Cloud API: POST graph.facebook.com/{version}/{phone-number-id}/messages. */
export class MetaWhatsAppSender implements WhatsAppSender {
  readonly name = 'meta';
  private readonly log = logger.child({ module: 'whatsapp' });

  constructor(private readonly settings: MetaSettings) {}

  sendText(to: string, body: string): Promise<WhatsAppResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits(to),
      type: 'text',
      text: { body: body.slice(0, 4096), preview_url: false },
    });
  }

  sendTemplate(to: string, template: string, language: string, params: string[]): Promise<WhatsAppResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits(to),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        ...(params.length && {
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
        }),
      },
    });
  }

  private async post(payload: unknown): Promise<WhatsAppResult> {
    const url = `https://graph.facebook.com/${this.settings.graphVersion}/${encodeURIComponent(this.settings.phoneNumberId)}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.settings.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? 10_000),
      });
    } catch (err) {
      this.log.error({ err }, 'WhatsApp unreachable');
      return { ok: false, error: 'unreachable', windowClosed: false };
    }
    const json = (await res.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { code?: number; error_subcode?: number };
    } | null;
    const id = json?.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, id };
    const code = json?.error?.code;
    this.log.error({ status: res.status, code }, 'WhatsApp refused a message');
    return { ok: false, error: `meta_${code ?? res.status}`, windowClosed: code === 131047 };
  }
}

const digits = (e164: string) => e164.replace(/\D/g, '');
