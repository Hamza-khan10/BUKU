import { AppError, recordSecurityEvent } from '@buku/common';
import { SWITCH_KEYS, SWITCHES, type DataPlane, type SwitchKey } from '@buku/database';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';

export interface SwitchView {
  key: SwitchKey;
  /** What stops while it's off, in words. */
  what: string;
  off: boolean;
  reason: string | null;
  changedAt: string | null;
  changedBy: { id: string; name: string } | null;
}

/**
 * The emergency switches, for platform admins (D-129): each part of BUKU that can be turned off at
 * once, whether it is, and who changed it last and why. Turning one off or on is audited on the
 * admin's own record and counted as a security event (the Security dashboard shows it); every
 * service sees the change within a few seconds — this one at once.
 */
export class SwitchControl {
  constructor(private readonly plane: DataPlane) {}

  /** Route middleware that refuses while a switch is off (for routes that don't reach the plane). */
  guard(key: SwitchKey) {
    return this.plane.switches.guard(key);
  }

  async list(): Promise<SwitchView[]> {
    const rows = await this.plane.directory.switch.findMany();
    const people = new Map<bigint, { id: string; name: string }>();
    for (const id of new Set(rows.flatMap((r) => (r.changedBy === null ? [] : [r.changedBy])))) {
      const db = await this.plane.user(id).catch(() => null);
      const person = await db?.user.findUnique({ where: { id }, select: { publicId: true, name: true } });
      if (person) people.set(id, { id: person.publicId, name: person.name });
    }
    return SWITCH_KEYS.map((key) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        what: SWITCHES[key],
        off: row?.off ?? false,
        reason: row?.reason ?? null,
        changedAt: row && row.changedBy !== null ? row.changedAt.toISOString() : null,
        changedBy: row?.changedBy != null ? (people.get(row.changedBy) ?? null) : null,
      };
    });
  }

  async set(
    key: SwitchKey,
    change: { off: boolean; reason?: string | undefined },
    adminId: bigint,
    ctx: RequestContext,
  ): Promise<SwitchView[]> {
    if (change.off && !change.reason) throw AppError.badRequest('Say why it’s being turned off');
    const before = await this.plane.directory.switch.findUnique({ where: { key } });
    if (!before) throw AppError.notFound('Switch');
    await this.plane.directory.switch.update({
      where: { key },
      data: {
        off: change.off,
        // The reason stays with the switch until the next change, so the record says why it was off.
        reason: change.reason ?? (change.off ? null : before.reason),
        changedBy: adminId,
        changedAt: new Date(),
      },
    });
    await auditPerson(this.plane, adminId, {
      userId: adminId,
      action: change.off ? 'admin.switch_turned_off' : 'admin.switch_turned_on',
      resourceType: 'emergency_switch',
      oldValues: { key, off: before.off, reason: before.reason },
      newValues: { key, off: change.off, reason: change.reason ?? null },
      ...auditCtx(ctx),
    });
    recordSecurityEvent(change.off ? 'emergency_switch_off' : 'emergency_switch_on');
    await this.plane.switches.refresh();
    return this.list();
  }
}
