import { logger } from '@buku/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Sending email (D-073). One sender in every environment: SMTP — Mailpit in
 * development (catches everything, nothing leaves the machine), Amazon SES in
 * production. Tests use a fake. Addresses are never logged.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** e.g. List-Unsubscribe for suggestions and reminders. */
  headers?: Record<string, string>;
}

export type EmailResult = { ok: true; id: string } | { ok: false; error: string };

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
  /** Production: refuse to send without TLS (SES on 587 upgrades with STARTTLS). */
  requireTls: boolean;
}

export class SmtpEmailSender implements EmailSender {
  readonly name = 'smtp';
  private readonly log = logger.child({ module: 'email' });
  private readonly transport: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      requireTLS: settings.requireTls,
      ...(settings.user && { auth: { user: settings.user, pass: settings.password ?? '' } }),
      pool: true,
      maxConnections: 3,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.headers && { headers: message.headers }),
      });
      return { ok: true, id: String(info.messageId).slice(0, 500) };
    } catch (err) {
      // The error can echo the address back: log the code only.
      const code = (err as { code?: string; responseCode?: number }).code ?? 'unknown';
      this.log.error({ code, responseCode: (err as { responseCode?: number }).responseCode }, 'email failed');
      return { ok: false, error: String(code).slice(0, 200) };
    }
  }

  close(): void {
    this.transport.close();
  }
}
