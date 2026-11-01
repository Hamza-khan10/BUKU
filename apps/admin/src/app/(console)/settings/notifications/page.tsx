import type { Metadata } from 'next';
import { NotificationSettingsForm } from '@admin/components/notification-settings';
import { Card, Notice, PageTitle, Stat, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';
import {
  MESSAGE_TYPES,
  type NotificationSettings,
  type WhatsappTemplate,
  type WhatsappUsage,
} from '@admin/lib/notifications';

export const metadata: Metadata = { title: 'Notifications' };

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * How BUKU tells people things (3.6k): this month's WhatsApp messages and what they cost against
 * the budget, the settings for every channel, reminder and suggestion, and the WhatsApp templates
 * to create in Meta before paying for messages.
 */
export default async function NotificationsPage() {
  const gate = await requireAdmin('/settings/notifications');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const call = <T,>(path: string) =>
    callApi<T>({ path, accessToken: gate.accessToken, incoming: gate.incoming, requestId: gate.requestId });
  const [settings, usage, templates] = await Promise.all([
    call<NotificationSettings>('/v1/admin/notifications/settings'),
    call<WhatsappUsage>('/v1/admin/notifications/whatsapp/usage'),
    call<WhatsappTemplate[]>('/v1/admin/notifications/whatsapp/templates'),
  ]);
  const share =
    usage.ok && usage.data.budgetCents > 0
      ? Math.min(100, (usage.data.estimatedCents / usage.data.budgetCents) * 100)
      : null;
  const tone = share === null ? 'neutral' : share >= 100 ? 'danger' : share >= 80 ? 'wait' : 'neutral';

  return (
    <>
      <PageTitle
        title="Notifications"
        description="How BUKU tells people things: email and WhatsApp, reminders, quiet hours and suggestions. Changes apply within 30 seconds and are recorded."
      />

      {usage.ok && (
        <section aria-label="WhatsApp this month" className="mb-8 grid gap-4 sm:grid-cols-3">
          <Stat
            style={beat(1)}
            label={`WhatsApp replies, ${usage.data.month}`}
            value={usage.data.windowMessages}
            hint="Inside a person’s 24-hour window"
          />
          <Stat
            style={beat(2)}
            label="Template messages"
            value={usage.data.templateMessages}
            hint="Started by BUKU: always paid"
          />
          <Stat
            style={beat(3)}
            label="Estimated cost"
            value={usd(usage.data.estimatedCents)}
            tone={tone}
            hint={
              usage.data.budgetCents > 0
                ? `of a ${usd(usage.data.budgetCents)} budget`
                : 'Budget 0: nothing paid is sent'
            }
            trend={
              share !== null && (
                <span
                  role="meter"
                  aria-label="Share of the monthly budget spent"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share)}
                  className="block h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-line ring-inset"
                >
                  <span
                    className={`block h-full rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'wait' ? 'bg-wait' : 'bg-brand'}`}
                    style={{ width: `${Math.max(2, share)}%` }}
                  />
                </span>
              )
            }
          />
        </section>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Settings" className="rise">
          {settings.ok && templates.ok ? (
            <NotificationSettingsForm settings={settings.data} templates={templates.data} />
          ) : (
            <Notice
              tone="danger"
              title={settings.ok ? (templates.ok ? '' : templates.error.message) : settings.error.message}
            />
          )}
        </Card>
        <Card
          title="WhatsApp templates"
          description="Create these in Meta’s WhatsApp Manager (category Utility) before paying for messages."
          className="rise"
        >
          {templates.ok ? (
            <ul className="flex flex-col gap-3">
              {templates.data.map((t) => (
                <li key={t.type} className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-ink">{MESSAGE_TYPES[t.type] ?? t.type}</span>
                  <span className="font-mono text-xs text-ink-3">{t.name}</span>
                  <span className="text-xs text-ink-2">{t.example}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Notice tone="danger" title={templates.error.message} />
          )}
        </Card>
      </div>
    </>
  );
}
