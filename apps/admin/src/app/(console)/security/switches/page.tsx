import type { Metadata } from 'next';
import { RowActions } from '@admin/components/row-actions';
import { Card, Notice, PageTitle, Pill } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';
import { switchName, type SwitchView } from '@admin/lib/switches';

export const metadata: Metadata = { title: 'Emergency switches' };

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';

/**
 * Emergency switches (3.6c, D-129): turn a part of BUKU off at once — under attack, or when one
 * part misbehaves — and back on. Every service obeys within seconds; who did it and why is kept.
 */
export default async function SwitchesPage() {
  const gate = await requireAdmin('/security/switches');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const list = await callApi<SwitchView[]>({
    path: '/v1/admin/switches',
    accessToken: gate.accessToken,
    incoming: gate.incoming,
    requestId: gate.requestId,
  });
  const off = list.ok ? list.data.filter((s) => s.off) : [];

  return (
    <>
      <PageTitle
        title="Emergency switches"
        description="Turn a part of BUKU off at once, under attack or when one part misbehaves, and back on when it’s safe. Every service obeys within five seconds."
      />
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message}>
          {list.requestId && <span className="font-mono text-xs">Reference: {list.requestId}</span>}
        </Notice>
      ) : (
        <>
          {off.length > 0 ? (
            <div className="mb-4">
              <Notice tone="danger" title={`Off now: ${off.map((s) => switchName(s.key)).join(', ')}`}>
                People trying these are told it’s paused and to try again later.
              </Notice>
            </div>
          ) : (
            <div className="mb-4">
              <Notice tone="ok" title="Everything is on" />
            </div>
          )}
          <ul aria-label="Switches" className="mb-8 flex flex-col gap-3">
            {list.data.map((s) => (
              <li
                key={s.key}
                className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between ${
                  s.off ? 'border-danger/50' : 'border-line'
                }`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {switchName(s.key)}
                    {s.off ? <Pill tone="danger">Off</Pill> : <Pill tone="ok">On</Pill>}
                  </p>
                  <p className="text-sm text-ink-2">{s.what}</p>
                  {s.changedAt && (
                    <p className="text-xs text-ink-3">
                      {s.off ? 'Turned off' : 'Turned back on'} {when(s.changedAt)}
                      {s.changedBy && <> by {s.changedBy.name}</>}
                      {s.reason && (
                        <>
                          {' '}
                          · {s.off ? '' : 'it was off for '}“{s.reason}”
                        </>
                      )}
                    </p>
                  )}
                </div>
                <RowActions
                  subject={switchName(s.key)}
                  actions={[
                    s.off
                      ? {
                          path: `/api/switches/${s.key}`,
                          label: 'Turn back on',
                          tone: 'primary',
                          body: { off: false },
                        }
                      : {
                          path: `/api/switches/${s.key}`,
                          label: 'Turn off',
                          tone: 'danger-quiet',
                          reason:
                            'Why turn it off? It’s recorded with your name; people only see that it’s paused.',
                          reasonMax: 500,
                          body: { off: true },
                        },
                  ]}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <Card title="What a switch does">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>
            Off stops only what it names. What’s already done stays done: bookings already made, people
            already in a queue, payments already taken.
          </li>
          <li>
            People see “This is paused for a moment. Please try again a little later.” The reason is only for
            operators.
          </li>
          <li>
            Platform admins can always sign in, even with Signing in off, so the console can turn it back on.
          </li>
          <li>
            Each change is recorded in the audit log under your name and counted on the Security dashboard. If
            the database can’t be read, services keep the last state they saw; nothing turns off by itself.
          </li>
        </ul>
      </Card>
    </>
  );
}
