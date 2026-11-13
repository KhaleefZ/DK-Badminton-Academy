import { randomInt } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Work } from '../db/client.js';
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

export const loadProgram = async () => (await db.select().from(referralProgram).where(eq(referralProgram.id, 1)))[0]!;

export const discountFor = (program: Program, pricePaise: number) =>
  Math.min(pricePaise, program.discountType === 'percent' ? Math.round((pricePaise * program.discountValue) / 100) : program.discountValue);

export const describeOffer = (program: Program) => (program.discountType === 'percent' ? `${program.discountValue}% off the first month` : `₹${(program.discountValue / 100).toLocaleString('en-IN')} off the first month`);

// The same answer for every failure, so nobody can use this to learn which codes exist.
const notValid = () => new AppError(400, 'INVALID_REFERRAL', 'That referral code isn’t valid.');

/** Checks a code is usable by anyone. A database trigger repeats the use-limit check when the use is saved. */
export async function validateCode(code: string, program: Program) {
  if (!program.enabled) throw notValid();
  const [row] = await db.select().from(referralCodes).where(eq(referralCodes.code, normaliseCode(code)));
  if (!row?.active || (row.expiresOn && row.expiresOn < venueToday())) throw notValid();
  if (row.maxUses !== null) {
    const [{ used }] = (await db
      .select({ used: sql<number>`count(*)` })
      .from(referralRedemptions)
      .innerJoin(memberships, eq(referralRedemptions.membershipId, memberships.id))
      .where(and(eq(referralRedemptions.codeId, row.id), inArray(memberships.status, ['active', 'pending_payment'])))) as [{ used: number }];
    if (used >= row.maxUses) throw notValid();
  }
  if (row.membershipId) {
    const [referrer] = await db.select().from(memberships).where(eq(memberships.id, row.membershipId));
    if (referrer?.status !== 'active' || referrer.deletedAt || referrer.endsOn < venueToday()) throw notValid();
  }
  return row;
}

const lastTenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** Checks a code for this person and works out their discount. Null when no code was given. */
export async function claimReferral(code: string | null | undefined, person: { phone: string; email: string | null; pricePaise: number }): Promise<Claim | null> {
  if (!code) return null;
  const program = await loadProgram();
  const row = await validateCode(code, program);
  // A discount for new members: this also stops anyone using their own code.
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        sql`${memberships.status} <> 'expired'`,
        person.email
          ? sql`(substr(${memberships.phoneDigits}, -10) = ${lastTenDigits(person.phone)} OR lower(${memberships.email}) = ${person.email.toLowerCase()})`
          : sql`substr(${memberships.phoneDigits}, -10) = ${lastTenDigits(person.phone)}`,
      ),
    )
    .limit(1);
  if (existing) throw new AppError(409, 'NOT_NEW_MEMBER', 'Referral codes are for new members. This phone or email already has a membership, or one waiting for payment.');
  return { codeId: row.id, discountPaise: discountFor(program, person.pricePaise), rewardPaise: row.membershipId ? program.rewardPaise : 0 };
}

export type Claim = { codeId: string; discountPaise: number; rewardPaise: number };

export function recordRedemption(work: Work, membershipId: string, claim: Claim | null) {
  if (claim) work.add(db.insert(referralRedemptions).values({ ...claim, membershipId }));
}

/** Every confirmed member gets a code to share. It only works while the program is on. Returned unrun. */
export const ensureMemberCode = (membershipId: string) => db.insert(referralCodes).values({ code: generateCode(), membershipId }).onConflictDoNothing();

/** Pays the referrer once, after the new member's first month is fully paid. Run after a payment has saved. */
export async function settleReferral(membershipId: string) {
  const [row] = await db
    .select({ redemption: referralRedemptions, referrerId: referralCodes.membershipId })
    .from(referralRedemptions)
    .innerJoin(referralCodes, eq(referralRedemptions.codeId, referralCodes.id))
    .where(and(eq(referralRedemptions.membershipId, membershipId), isNull(referralRedemptions.creditedAt)));
  if (!row) return;
  const [first] = await db.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, membershipId)).orderBy(membershipPeriods.startsOn).limit(1);
  if ((await periodPaid(first!.id)) < first!.amountPaise) return;
  // Claimed in one statement, so two payments saving at once can't both pay the reward.
  const claimed = await db
    .update(referralRedemptions)
    .set({ creditedAt: new Date() })
    .where(and(eq(referralRedemptions.id, row.redemption.id), isNull(referralRedemptions.creditedAt)))
    .returning({ id: referralRedemptions.id });
  if (!claimed.length || !row.referrerId || row.redemption.rewardPaise <= 0) return;
  const [newMember] = await db.select({ no: memberships.membershipNo }).from(memberships).where(eq(memberships.id, membershipId));
  await db.insert(memberCredits).values({ membershipId: row.referrerId, amountPaise: row.redemption.rewardPaise, reason: `Referred ${newMember!.no}` });
}

export const creditBalance = async (membershipId: string) => {
  const [row] = await db.select({ balance: sql<number>`coalesce(sum(${memberCredits.amountPaise}), 0)` }).from(memberCredits).where(eq(memberCredits.membershipId, membershipId));
  return row!.balance;
};

/** Spends credit against a price, adding the spend to `work`, and returns how much came off. */
export async function applyCredit(work: Work, membershipId: string, pricePaise: number, reason: string, createdBy?: string) {
  const used = Math.min(await creditBalance(membershipId), pricePaise);
  if (used <= 0) return 0;
  work.add(db.insert(memberCredits).values({ membershipId, amountPaise: -used, reason, createdBy }));
  return used;
}
