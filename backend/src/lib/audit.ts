import type { Request } from 'express';
import type { DbOrTx } from '../db/client.js';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

type AuditEntry = {
  action: string;
  actorStaffId?: string | null;
  entityType?: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  req?: Request;
};

export async function writeAudit(entry: AuditEntry, conn: DbOrTx = db): Promise<void> {
  await conn.insert(auditLog).values({
    action: entry.action,
    actorStaffId: entry.actorStaffId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ip: entry.req?.ip,
    userAgent: entry.req?.get('user-agent'),
  });
}
