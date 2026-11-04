import { randomInt } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import { memberCredits, membershipPeriods, memberships, referralCodes, referralProgram, referralRedemptions } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { venueToday } from '../lib/time.js';
import { periodPaid } from './service.js';

// No 0, O, 1 or I, so a code read aloud at the desk can't be misheard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

type Program = typeof referralProgram.$inferSelect;

export const normaliseCode = (code: string) => code.trim().toUpperCase();
export const generateCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export const loadProgram = async (conn: DbOrTx = db) => (await conn.select().from(referralProgram).where(eq(referralProgram.id, 1)))[0]!;

export const discountFor = (program: Program, pricePaise: number) =>
  Math.min(pricePaise, program.discountType === 'percent' ? Math.round((pricePaise * program.discountValue) / 100) : program.discountValue);

export const describeOffer = (program: Program) => (program.discountType === 'percent' ? `${program.discountValue}% off the first month` : `₹${(program.discountValue / 100).toLocaleString('en-IN')} off the first month`);

// The same answer for every failure, so nobody can use this to learn which codes exist.
const notValid = () => new AppError(400, 'INVALID_REFERRAL', 'That referral code isn’t valid.');

/** Checks a code is usable by anyone. Locks it when `lock` is set, so its last use can't be taken twice. */
export async function validateCode(conn: DbOrTx, code: string, program: Program, lock = false) {
  if (!program.enabled) throw notValid();
  const query = conn.select().from(referralCodes).where(eq(referralCodes.code, normaliseCode(code)));
  const [row] = await (lock ? query.for('update') : query);
  if (!row?.active || (row.expiresOn && row.expiresOn < venueToday())) throw notValid();
  if (row.maxUses !== null) {
    const [{ used }] = (await conn
      .select({ used: sql<number>`count(*)::int` })
      .from(referralRedemptions)
      .innerJoin(memberships, eq(referralRedemptions.membershipId, memberships.id))
      .where(and(eq(referralRedemptions.codeId, row.id), inArray(memberships.status, ['active', 'pending_payment'])))) as [{ used: number }];
    if (used >= row.maxUses) throw notValid();
  }
  if (row.membershipId) {
    const [referrer] = await conn.select().from(memberships).where(eq(memberships.id, row.membershipId));
    if (referrer?.status !== 'active' || referrer.deletedAt || referrer.endsOn < venueToday()) throw notValid();
  }
  return row;
}

const lastTenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** Checks a code for this person and works out their discount. Null when no code was given. */
export async function claimReferral(conn: DbOrTx, code: string | null | undefined, person: { phone: string; email: string | null; pricePaise: number }): Promise<Claim | null> {
  if (!code) return null;
  const program = await loadProgram(conn);
  const row = await validateCode(conn, code, program, true);
  // A discount for new members: this also stops anyone using their own code.
  const [existing] = await conn
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        sql`${memberships.status} <> 'expired'`,
        person.email
          ? sql`(right(regexp_replace(${memberships.phone}, '[^0-9]', '', 'g'), 10) = ${lastTenDigits(person.phone)} OR lower(${memberships.email}) = ${person.email.toLowerCase()})`
          : sql`right(regexp_replace(${memberships.phone}, '[^0-9]', '', 'g'), 10) = ${lastTenDigits(person.phone)}`,
      ),
    )
    .limit(1);
  if (existing) throw new AppError(409, 'NOT_NEW_MEMBER', 'Referral codes are for new members. This phone or email already has a membership, or one waiting for payment.');
  return { codeId: row.id, discountPaise: discountFor(program, person.pricePaise), rewardPaise: row.membershipId ? program.rewardPaise : 0 };
}

export type Claim = { codeId: string; discountPaise: number; rewardPaise: number };

export async function recordRedemption(conn: DbOrTx, membershipId: string, claim: Claim | null) {
  if (claim) await conn.insert(referralRedemptions).values({ ...claim, membershipId });
}

/** Every confirmed member gets a code to share. It only works while the program is on. */
export async function ensureMemberCode(conn: DbOrTx, membershipId: string) {
  await conn.insert(referralCodes).values({ code: generateCode(), membershipId }).onConflictDoNothing();
}

/** Pays the referrer once, after the new member's first month is fully paid. */
export async function settleReferral(conn: DbOrTx, membershipId: string) {
  const [row] = await conn
    .select({ redemption: referralRedemptions, referrerId: referralCodes.membershipId })
    .from(referralRedemptions)
    .innerJoin(referralCodes, eq(referralRedemptions.codeId, referralCodes.id))
    .where(and(eq(referralRedemptions.membershipId, membershipId), isNull(referralRedemptions.creditedAt)));
  if (!row) return;
  const [first] = await conn.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, membershipId)).orderBy(membershipPeriods.startsOn).limit(1);
  if ((await periodPaid(conn, first!.id)) < first!.amountPaise) return;
  await conn.update(referralRedemptions).set({ creditedAt: new Date() }).where(eq(referralRedemptions.id, row.redemption.id));
  if (row.referrerId && row.redemption.rewardPaise > 0) {
    const [newMember] = await conn.select({ no: memberships.membershipNo }).from(memberships).where(eq(memberships.id, membershipId));
    await conn.insert(memberCredits).values({ membershipId: row.referrerId, amountPaise: row.redemption.rewardPaise, reason: `Referred ${newMember!.no}` });
  }
}

export const creditBalance = async (conn: DbOrTx, membershipId: string) => {
  const [row] = await conn.select({ balance: sql<number>`coalesce(sum(${memberCredits.amountPaise}), 0)::int` }).from(memberCredits).where(eq(memberCredits.membershipId, membershipId));
  return row!.balance;
};

/** Spends credit against a price, and returns how much came off. */
export async function applyCredit(conn: DbOrTx, membershipId: string, pricePaise: number, reason: string, createdBy?: string) {
  const used = Math.min(await creditBalance(conn, membershipId), pricePaise);
  if (used <= 0) return 0;
  await conn.insert(memberCredits).values({ membershipId, amountPaise: -used, reason, createdBy });
  return used;
}
