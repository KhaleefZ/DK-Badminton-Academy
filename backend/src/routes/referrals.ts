import { Router } from 'express';
import type { Request } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, DB_ERRORS, dbErrorCode } from '../db/client.js';
import { discountType, memberships, referralCodes, referralProgram, referralRedemptions } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { isDate } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { generateCode, normaliseCode } from '../memberships/referrals.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const programBody = z
  .object({
    enabled: z.boolean({ error: 'Choose whether referrals are on.' }),
    discountType: z.enum(discountType.enumValues, { error: 'Choose a discount type.' }),
    discountValue: z.number({ error: 'Enter the discount.' }).int('Enter a whole number.').min(0, 'A discount can’t be negative.').max(100_000_000),
    rewardPaise: z.number({ error: 'Enter the referrer’s credit.' }).int('Enter a valid amount.').min(0, 'A credit can’t be negative.').max(100_000_000),
  })
  .refine((p) => p.discountType !== 'percent' || p.discountValue <= 100, 'A percentage can be at most 100.');

const codeBody = z.object({
  code: z.string().trim().max(30).regex(/^[A-Za-z0-9-]*$/, 'A code can only have letters, numbers and dashes.').nullish(),
  label: z.string().trim().max(120).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
  maxUses: z.number().int().min(1, 'Allow at least 1 use.').max(100000).nullish().transform((v) => v ?? null),
  expiresOn: z.union([z.literal(''), z.string().refine(isDate, 'Choose a valid date.')]).nullish().transform((v) => v || null),
});

const uses = sql<number>`(SELECT count(*) FROM referral_redemptions r JOIN memberships m ON m.id = r.membership_id WHERE r.code_id = referral_codes.id AND m.status IN ('active', 'pending_payment'))::int`;

async function uniqueCode<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (dbErrorCode(err) === DB_ERRORS.uniqueViolation) throw new AppError(409, 'DUPLICATE_CODE', 'That code is already in use.');
    throw err;
  }
}

export function referralsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);
  const view = requirePermission('referrals.view');
  const manage = requirePermission('referrals.manage');
  const actor = (req: Request) => currentAuth(req).staff.id;

  const findCode = async (req: Request) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That code');
    const [row] = await db.select().from(referralCodes).where(eq(referralCodes.id, id));
    if (!row) throw notFound('That code');
    return row;
  };

  router.get('/', view, async (_req, res) => {
    const [[program], codes, redemptions] = await Promise.all([
      db.select().from(referralProgram).where(eq(referralProgram.id, 1)),
      db
        .select({ code: referralCodes, uses, memberNo: memberships.membershipNo, memberName: memberships.holderName })
        .from(referralCodes)
        .leftJoin(memberships, eq(referralCodes.membershipId, memberships.id))
        .orderBy(desc(referralCodes.createdAt))
        .limit(300),
      db
        .select({ redemption: referralRedemptions, code: referralCodes.code, membershipId: memberships.id, memberNo: memberships.membershipNo, memberName: memberships.holderName, status: memberships.status })
        .from(referralRedemptions)
        .innerJoin(referralCodes, eq(referralRedemptions.codeId, referralCodes.id))
        .innerJoin(memberships, eq(referralRedemptions.membershipId, memberships.id))
        .orderBy(desc(referralRedemptions.createdAt))
        .limit(100),
    ]);
    res.json({
      program,
      codes: codes.map(({ code, ...rest }) => ({ ...code, ...rest })),
      redemptions: redemptions.map(({ redemption, ...rest }) => ({ ...redemption, ...rest })),
    });
  });

  router.put('/program', manage, async (req, res) => {
    const values = parseBody(programBody, req.body);
    const [before] = await db.select().from(referralProgram).where(eq(referralProgram.id, 1));
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(referralProgram).set({ ...values, updatedAt: new Date() }).where(eq(referralProgram.id, 1)).returning();
      await writeAudit({ action: 'referrals.program_updated', actorStaffId: actor(req), entityType: 'settings', entityId: 'referrals', oldValues: before, newValues: updated, req }, tx);
      return updated;
    });
    res.json({ program: row });
  });

  router.post('/codes', manage, async (req, res) => {
    const { code, ...values } = parseBody(codeBody, req.body);
    const row = await uniqueCode(() =>
      db.transaction(async (tx) => {
        const [created] = await tx.insert(referralCodes).values({ ...values, code: code ? normaliseCode(code) : generateCode() }).returning();
        await writeAudit({ action: 'referrals.code_created', actorStaffId: actor(req), entityType: 'referral_code', entityId: created!.id, newValues: created, req }, tx);
        return created;
      }),
    );
    res.status(201).json({ code: row });
  });

  router.patch('/codes/:id', manage, async (req, res) => {
    const before = await findCode(req);
    const { code, ...values } = parseBody(codeBody, req.body);
    const row = await uniqueCode(() =>
      db.transaction(async (tx) => {
        const [updated] = await tx
          .update(referralCodes)
          .set({ ...values, ...(code ? { code: normaliseCode(code) } : {}), updatedAt: new Date() })
          .where(eq(referralCodes.id, before.id))
          .returning();
        await writeAudit({ action: 'referrals.code_updated', actorStaffId: actor(req), entityType: 'referral_code', entityId: before.id, oldValues: before, newValues: updated, req }, tx);
        return updated;
      }),
    );
    res.json({ code: row });
  });

  router.delete('/codes/:id', manage, async (req, res) => {
    const before = await findCode(req);
    if (before.membershipId) throw invalid('A member’s own code can’t be deleted. Switch it off instead.', 'MEMBER_CODE');
    try {
      await db.transaction(async (tx) => {
        await tx.delete(referralCodes).where(eq(referralCodes.id, before.id));
        await writeAudit({ action: 'referrals.code_deleted', actorStaffId: actor(req), entityType: 'referral_code', entityId: before.id, oldValues: before, req }, tx);
      });
    } catch (err) {
      if (dbErrorCode(err) === DB_ERRORS.foreignKeyViolation) throw new AppError(409, 'CODE_USED', 'This code has been used, so it can’t be deleted. Switch it off instead.');
      throw err;
    }
    res.status(204).end();
  });

  return router;
}
