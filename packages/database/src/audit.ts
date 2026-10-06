import type { Prisma } from './generated/prisma/client.js';
import type { Database, Transaction } from './index.js';

/**
 * Security/compliance audit trail. Record WHO did WHAT to WHICH resource,
 * from WHERE. Never put secrets, tokens or raw contact details in
 * `oldValues`/`newValues` — record which fields changed, not their values,
 * when the values are personal data.
 */
export interface AuditEntry {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function recordAudit(db: Database | Transaction, entry: AuditEntry): Promise<void> {
  // createMany: a plain INSERT, nothing read back — every service may append to the audit log,
  // none may read it except auth (a person's own security log) (D-092).
  await db.auditLog.createMany({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      ...(entry.oldValues !== undefined && { oldValues: entry.oldValues }),
      ...(entry.newValues !== undefined && { newValues: entry.newValues }),
      ipAddress: entry.ipAddress?.slice(0, 45) ?? null,
      userAgent: entry.userAgent?.slice(0, 500) ?? null,
      requestId: entry.requestId?.slice(0, 128) ?? null,
    },
  });
}
