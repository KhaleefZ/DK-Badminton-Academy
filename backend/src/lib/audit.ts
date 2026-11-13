import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, settings } from '../db/schema.js';
import { clientIp } from './rateLimit.js';

type AuditEntry = {
  action: string;
  actorStaffId?: string | null;
  entityType?: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  req?: Request;
};

/** The insert, not yet run, so it can go into a `db.batch` with the change it records. */
export const auditEntry = (entry: AuditEntry) =>
  db.insert(auditLog).values({
    action: entry.action,
    actorStaffId: entry.actorStaffId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ip: entry.req ? clientIp(entry.req) : undefined,
    userAgent: entry.req?.get('user-agent'),
  });

/**
 * Like auditEntry, but written only if the statement just before it in the batch changed a row.
 * Pairs with a conditional update ("... where it's still unvoided"), so a refused change leaves no record.
 */
export const auditIfChanged = (entry: AuditEntry) => {
  const value = (v: unknown, as: string) => sql`${v ?? null}`.as(as);
  return db.insert(auditLog).select(
    db
      .select({
        id: sql`NULL`.as('id'),
        actorStaffId: value(entry.actorStaffId, 'actor_staff_id'),
        action: value(entry.action, 'action'),
        entityType: value(entry.entityType, 'entity_type'),
        entityId: value(entry.entityId, 'entity_id'),
        oldValues: value(entry.oldValues === undefined ? null : JSON.stringify(entry.oldValues), 'old_values'),
        newValues: value(entry.newValues === undefined ? null : JSON.stringify(entry.newValues), 'new_values'),
        ip: value(entry.req ? clientIp(entry.req) : null, 'ip'),
        userAgent: value(entry.req?.get('user-agent'), 'user_agent'),
        createdAt: sql`cast(unixepoch('subsec') * 1000 as integer)`.as('created_at'),
      })
      // settings always has exactly one row, so this yields one row, or none if nothing changed.
      .from(settings)
      .where(sql`changes() > 0`),
  );
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await auditEntry(entry);
}
