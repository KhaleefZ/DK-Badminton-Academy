// Creates the first Owner account. There is no default password anywhere in the code:
// run `npm run create-owner` once and type the details when asked.
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '../auth/crypto.js';
import { passwordProblem } from '../auth/policy.js';
import { db, pool } from '../db/client.js';
import { staff } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';

function ask(question: string, hidden = false): Promise<string> {
  // A muted output stream keeps a typed password off the screen.
  const output = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: stdin, output: hidden && stdin.isTTY ? output : stdout, terminal: stdin.isTTY });
  stdout.write(question);
  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      if (hidden && stdin.isTTY) stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const [existing] = await db.select({ id: staff.id }).from(staff).where(eq(staff.role, 'owner')).limit(1);
  if (existing) {
    console.error('An Owner already exists. Add other staff from the admin panel.');
    process.exitCode = 1;
    return;
  }

  // Non-interactive use reads the same details from the environment.
  const name = (process.env.OWNER_NAME ?? (await ask('Full name: '))).trim();
  const email = (process.env.OWNER_EMAIL ?? (await ask('Email: '))).trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD ?? (await ask('Password (hidden): ', true));

  if (!name) throw new Error('Enter a name.');
  if (!z.string().email().safeParse(email).success) throw new Error('Enter a valid email.');
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);
  if (!process.env.OWNER_PASSWORD && (await ask('Repeat password (hidden): ', true)) !== password) {
    throw new Error('The passwords don’t match.');
  }

  const [owner] = await db
    .insert(staff)
    .values({ name, email, role: 'owner', passwordHash: await hashPassword(password) })
    .returning({ id: staff.id, staffNo: staff.staffNo });
  await writeAudit({ action: 'staff.created', actorStaffId: owner!.id, entityType: 'staff', entityId: owner!.id, newValues: { name, email, role: 'owner' } });
  console.log(`Owner created: ${owner!.staffNo} (${email})`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
