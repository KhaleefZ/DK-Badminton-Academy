import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { staff } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import { hashPassword } from './crypto.js';
import { passwordProblem } from './policy.js';

/** Creates the first Owner. Refuses if any Owner exists, so it can't be used to take over the panel. */
export async function createOwner(input: { name: string; email: string; password: string }): Promise<{ staffNo: string; email: string }> {
  const [existing] = await db.select({ id: staff.id }).from(staff).where(eq(staff.role, 'owner')).limit(1);
  if (existing) throw new Error('An Owner already exists. Add other staff from the admin panel.');

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error('Enter a name.');
  if (!z.string().email().safeParse(email).success) throw new Error('Enter a valid email.');
  const problem = passwordProblem(input.password, email);
  if (problem) throw new Error(problem);

  const id = crypto.randomUUID();
  const [[owner]] = await db.batch([
    db.insert(staff).values({ id, name, email, role: 'owner', passwordHash: await hashPassword(input.password) }).returning({ staffNo: staff.staffNo }),
    auditEntry({ action: 'staff.created', actorStaffId: id, entityType: 'staff', entityId: id, newValues: { name, email, role: 'owner' } }),
  ]);
  return { staffNo: owner!.staffNo, email };
}
