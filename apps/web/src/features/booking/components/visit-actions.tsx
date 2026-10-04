'use client';

import { CalendarPlus, MapPin, Repeat } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { bookHref } from '../choices';
import { icsFileName, icsFor } from '../calendar';
import type { Receipt } from '../types';
import { CancelDialog } from './cancel-dialog';

/** Save the visit to the device's calendar (a file made right here; nothing is sent anywhere). */
function addToCalendar(r: Receipt) {
  const url = `${window.location.origin}/appointments/${r.id}`;
  const blob = new Blob([icsFor(r, url, new Date())], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = icsFileName(r);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * What can be done with a visit, only what the API allows right now (its
 * `policy`): add it to a calendar, move it (until the notice period), cancel
 * it; afterwards, book the same again.
 */
export function VisitActions({ receipt: r }: { receipt: Receipt }) {
  const live = (r.status === 'pending' || r.status === 'confirmed') && !r.checkedInAt;
  return (
    <div className="flex flex-wrap gap-3">
      {live && (
        <Button variant="secondary" onClick={() => addToCalendar(r)}>
          <CalendarPlus aria-hidden /> Add to calendar
        </Button>
      )}
      {live && r.policy.canReschedule && (
        <Button asChild variant="secondary">
          <Link href={`/appointments/${r.id}/move` as Route}>
            <Repeat aria-hidden /> Move to another time
          </Link>
        </Button>
      )}
      {live && r.policy.canCancel && <CancelDialog receipt={r} />}
      {!live && (
        <Button asChild variant="secondary">
          <Link href={bookHref(r.business.slug, { serviceId: r.service.id }) as Route}>
            <Repeat aria-hidden /> Book this again
          </Link>
        </Button>
      )}
      <Button asChild variant="ghost">
        <Link href={`/b/${r.business.slug}` as Route}>
          <MapPin aria-hidden /> {r.business.name}
        </Link>
      </Button>
    </div>
  );
}
