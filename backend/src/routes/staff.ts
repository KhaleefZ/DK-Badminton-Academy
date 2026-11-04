import { Router } from 'express';
import type { Request } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/crypto.js';
import { confirmPassword } from '../auth/passwords.js';
import { deleteAllSessions } from '../auth/sessions.js';
import { db } from '../db/client.js';
import { auditLog, staff, staffRole, type Staff } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { invalid, notFound } from '../lib/errors.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const staffView = (s: Staff) => ({
  id: s.id,
  staffNo: s.staffNo,
  name: s.name,
  email: s.email,
  phone: s.phone,
  role: s.role,
  status: s.status,
  mustChangePassword: s.mustChangePassword,
  locked: Boolean(s.lockedUntil && s.lockedUntil > new Date()),
  lastLoginAt: s.lastLoginAt,
  createdAt: s.createdAt,
  deletedAt: s.deletedAt,
});

/** The history record for a change. Passwords and hashes never go in it. */
const auditFields = (s: Staff) => ({ name: s.name, email: s.email, phone: s.phone, role: s.role, status: s.status, deleted: Boolean(s.deletedAt) });

const details = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email.').max(254),
  phone: z.string().trim().max(20).nullish().transform((v) => v || null),
  role: z.enum(staffRole.enumValues, { error: 'Choose a role.' }),
});

async function findTarget(req: Request): Promise<Staff> {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That staff member');
  const [row] = await db.select().from(staff).where(eq(staff.id, id));
  if (!row) throw notFound('That staff member');
  return row;
}

function refuseSelf(req: Request, target: Staff, message: string): void {
  if (target.id === currentAuth(req).staff.id) throw invalid(message, 'NOT_ON_YOURSELF');
}

function refuseDeleted(target: Staff): void {
  if (target.deletedAt) throw notFound('That staff member');
}

export function staffRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('staff.manage'));

  router.get('/', async (_req, res) => {
    const rows = await db.select().from(staff).orderBy(staff.staffNo);
    res.json({ staff: rows.map(staffView) });
  });

  router.post('/', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const values = parseBody(details, req.body);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(staff).values({ ...values, passwordHash, mustChangePassword: true }).returning();
      await writeAudit({ action: 'staff.created', actorStaffId: actor.id, entityType: 'staff', entityId: row!.id, newValues: auditFields(row!), req }, tx);
      return row!;
    });
    // Shown once here. Only its hash is kept, so it can never be looked up again.
    res.status(201).json({ staff: staffView(created), temporaryPassword });
  });

  router.patch('/:id', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    refuseDeleted(target);
    const values = parseBody(details, req.body);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(staff).set({ ...values, updatedAt: new Date() }).where(eq(staff.id, target.id)).returning();
      await writeAudit(
        { action: 'staff.updated', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, oldValues: auditFields(target), newValues: auditFields(row!), req },
        tx,
      );
      return row!;
    });
    res.json({ staff: staffView(updated) });
  });

  router.post('/:id/deactivate', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    refuseDeleted(target);
    refuseSelf(req, target, 'You can’t deactivate your own account.');

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(staff).set({ status: 'inactive', updatedAt: new Date() }).where(eq(staff.id, target.id)).returning();
      await deleteAllSessions(target.id, tx);
      await writeAudit(
        { action: 'staff.deactivated', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, oldValues: auditFields(target), newValues: auditFields(row!), req },
        tx,
      );
      return row!;
    });
    res.json({ staff: staffView(updated) });
  });

  router.post('/:id/reactivate', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    refuseDeleted(target);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(staff).set({ status: 'active', updatedAt: new Date() }).where(eq(staff.id, target.id)).returning();
      await writeAudit(
        { action: 'staff.reactivated', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, oldValues: auditFields(target), newValues: auditFields(row!), req },
        tx,
      );
      return row!;
    });
    res.json({ staff: staffView(updated) });
  });

  router.post('/:id/reset-password', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    refuseDeleted(target);
    refuseSelf(req, target, 'Change your own password from My account.');

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await db.transaction(async (tx) => {
      await tx
        .update(staff)
        .set({ passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(staff.id, target.id));
      await deleteAllSessions(target.id, tx);
      await writeAudit({ action: 'staff.password_reset', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, req }, tx);
    });
    res.json({ temporaryPassword });
  });

  // Moves to the trash. The row stays, so bookings and history keep their staff name.
  router.delete('/:id', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    refuseDeleted(target);
    refuseSelf(req, target, 'You can’t delete your own account.');

    await db.transaction(async (tx) => {
      const [row] = await tx.update(staff).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(staff.id, target.id)).returning();
      await deleteAllSessions(target.id, tx);
      await writeAudit(
        { action: 'staff.deleted', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, oldValues: auditFields(target), newValues: auditFields(row!), req },
        tx,
      );
    });
    res.status(204).end();
  });

  // Restored accounts come back inactive, so a restore can never fail on the 5-account limit.
  router.post('/:id/restore', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const target = await findTarget(req);
    if (!target.deletedAt) throw invalid('This account isn’t in the trash.');

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(staff).set({ deletedAt: null, status: 'inactive', updatedAt: new Date() }).where(eq(staff.id, target.id)).returning();
      await writeAudit(
        { action: 'staff.restored', actorStaffId: actor.id, entityType: 'staff', entityId: target.id, oldValues: auditFields(target), newValues: auditFields(row!), req },
        tx,
      );
      return row!;
    });
    res.json({ staff: staffView(updated) });
  });

  router.get('/:id/history', async (req, res) => {
    const target = await findTarget(req);
    const rows = await db
      .select({ id: auditLog.id, action: auditLog.action, ip: auditLog.ip, userAgent: auditLog.userAgent, createdAt: auditLog.createdAt, actorName: staff.name })
      .from(auditLog)
      .leftJoin(staff, eq(staff.id, auditLog.actorStaffId))
      .where(and(eq(auditLog.entityType, 'staff'), eq(auditLog.entityId, target.id)))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(50);
    res.json({ history: rows });
  });

  return router;
}
