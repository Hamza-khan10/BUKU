'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Scissors } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { money } from '@/lib/format';
import {
  archiveService,
  fetchMenu,
  fetchStaff,
  menuKey,
  staffKey,
  updateService,
  type ManagedBusiness,
  type ManagedMenu,
  type ManagedService,
  type ManagedStaff,
} from '../api';
import { durationLabel } from '../setup';
import { ServiceForm } from './service-form';

/**
 * The menu (3.5d): every service, by group, with its length, price and who does it. Services
 * are changed in place; archiving takes one off the menu without breaking past visits, and an
 * archived one can be brought back. A service nobody does is flagged: it can't be booked.
 */
export function ServicesManager({ business }: { business: ManagedBusiness }) {
  const menu = useQuery({ queryKey: menuKey(business.id), queryFn: () => fetchMenu(business.id) });
  const staff = useQuery({ queryKey: staffKey(business.id), queryFn: () => fetchStaff(business.id) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (menu.isPending || staff.isPending) return <Skeleton className="h-64" />;
  if (menu.isError || staff.isError) {
    return <ErrorState title="Your menu didn’t load" message="Please refresh the page to try again." />;
  }

  const all = menu.data.categories.flatMap((c) => c.services);
  const live = all.filter((s) => s.isActive);
  const archived = all.filter((s) => !s.isActive);
  const add = (
    <ServiceForm
      business={business}
      menu={menu.data}
      staff={staff.data}
      onDone={(s) => {
        setAdding(false);
        toast.success(`${s.name} is on your menu.`);
      }}
      onCancel={() => setAdding(false)}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-2">
          {live.length === 0
            ? 'Nothing on your menu yet.'
            : `${live.length} ${live.length === 1 ? 'service' : 'services'} people can book.`}
        </p>
        {!adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add a service
          </Button>
        )}
      </div>
      {adding && add}

      {live.length === 0 && !adding ? (
        <EmptyState icon={Scissors} title="No services yet">
          Add what people can book: a name, how long it takes and its price.
        </EmptyState>
      ) : (
        menu.data.categories.map((group) => {
          const services = group.services.filter((s) => s.isActive);
          if (services.length === 0) return null;
          return (
            <section key={group.id ?? 'other'} aria-label={group.name} className="flex flex-col gap-3">
              <h2 className="type-subheading">{group.name}</h2>
              <ul className="flex flex-col gap-3">
                {services.map((s) =>
                  editing === s.id ? (
                    <li key={s.id}>
                      <ServiceForm
                        business={business}
                        menu={menu.data}
                        staff={staff.data}
                        service={s}
                        onDone={() => {
                          setEditing(null);
                          toast.success('Your changes are saved.');
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <ServiceRow
                      key={s.id}
                      business={business}
                      service={s}
                      staff={staff.data}
                      onEdit={() => setEditing(s.id)}
                    />
                  ),
                )}
              </ul>
            </section>
          );
        })
      )}

      {archived.length > 0 && <Archived business={business} services={archived} menu={menu.data} />}
    </div>
  );
}

function ServiceRow({
  business,
  service,
  staff,
  onEdit,
}: {
  business: ManagedBusiness;
  service: ManagedService;
  staff: ManagedStaff[];
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const doers = staff.filter((p) => p.isActive && service.staffIds.includes(p.id));

  const archive = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await archiveService(business.id, service.id);
      await queryClient.invalidateQueries({ queryKey: menuKey(business.id) });
      setConfirm(false);
      toast(`${service.name} is off your menu.`);
    } catch (err) {
      setProblem(problemFrom(err, 'It couldn’t be archived. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold text-ink">{service.name}</span>
        <span className="tabular text-sm text-ink-2">
          {durationLabel(service.durationMinutes)} · {money(service.price, business.currency)}
          {service.bufferMinutes > 0 && ` · ${durationLabel(service.bufferMinutes)} clean-up`}
        </span>
        {doers.length > 0 ? (
          <span className="text-sm text-ink-3">Done by {doers.map((d) => d.displayName).join(', ')}</span>
        ) : (
          <span className="text-sm font-medium text-wait-ink">
            Nobody does it yet, so it can’t be booked.
          </span>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={onEdit}>
          Change<span className="sr-only"> {service.name}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
          Archive<span className="sr-only"> {service.name}</span>
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title={`Archive ${service.name}?`}
          description="It leaves your menu, so nobody can book it. Visits already booked still happen, and past ones keep it. You can bring it back."
        >
          <div className="flex flex-col gap-4">
            {problem && <Alert tone="danger" title={problem} />}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button variant="secondary">Keep it</Button>
              </DialogClose>
              <Button variant="danger" loading={busy} onClick={() => void archive()}>
                Archive it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function Archived({
  business,
  services,
}: {
  business: ManagedBusiness;
  services: ManagedService[];
  menu: ManagedMenu;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const restore = async (s: ManagedService) => {
    setBusy(s.id);
    setProblem(null);
    try {
      await updateService(business.id, s.id, { isActive: true });
      await queryClient.invalidateQueries({ queryKey: menuKey(business.id) });
      toast.success(`${s.name} is back on your menu.`);
    } catch (err) {
      setProblem(problemFrom(err, 'It couldn’t be brought back. Please try again.').title);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="group rounded-xl border border-line p-4 sm:p-5">
      <summary className="cursor-pointer font-medium text-ink-2 marker:text-ink-3">
        Archived ({services.length})
      </summary>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {services.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex flex-col">
              <span className="font-medium text-ink-2">{s.name}</span>
              <span className="tabular text-sm text-ink-3">
                {durationLabel(s.durationMinutes)} · {money(s.price, business.currency)}
              </span>
            </span>
            <Button size="sm" loading={busy === s.id} onClick={() => void restore(s)}>
              Bring it back<span className="sr-only"> ({s.name})</span>
            </Button>
          </li>
        ))}
      </ul>
      {problem && <Alert tone="danger" title={problem} className="mt-3" />}
    </details>
  );
}
