import { eq, sql } from 'drizzle-orm';
import { db, type Work } from '../db/client.js';
import { memberCredits } from '../db/schema.js';

// A member's credit: amounts staff add or take off (Memberships → Adjust credit), spent automatically
// on their next renewal. Referrals used to add credit too; they were removed on 24 Nov 2026.

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
