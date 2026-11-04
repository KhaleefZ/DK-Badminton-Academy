// Fills an empty database with demo hours, prices, plans and a batch, so the website can be tried out.
// Everything it adds is named "Demo" and can be edited or removed in the admin panel.
import { asc, sql } from 'drizzle-orm';
import { pool, db } from '../db/client.js';
import { courts, memberBatches, membershipPlans, openingHours, priceRules } from '../db/schema.js';
import { addDays, venueToday } from '../lib/time.js';
import { holdWeeklyTime } from '../memberships/service.js';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const hour = (h: number) => h * 60;

if (process.env.NODE_ENV === 'production') {
  console.error('Demo data is for trying things out, not for the live website.');
  process.exit(1);
}

const [{ count }] = (await db.execute(sql`SELECT (SELECT count(*) FROM opening_hours) + (SELECT count(*) FROM price_rules) + (SELECT count(*) FROM membership_plans) AS count`)).rows as [{ count: string }];
if (Number(count) > 0) {
  console.error('Hours, prices or plans are already set, so nothing was added. Demo data only goes into an empty setup.');
  await pool.end();
  process.exit(1);
}

const [court1] = await db.select().from(courts).orderBy(asc(courts.sortOrder)).limit(1);
if (!court1) throw new Error('Add a court first.');
const today = venueToday();

await db.transaction(async (tx) => {
  await tx.insert(openingHours).values(ALL_DAYS.map((weekday) => ({ weekday, openMinute: hour(6), closeMinute: hour(22) })));
  await tx.insert(priceRules).values([
    { courtId: null, days: ALL_DAYS, startMinute: hour(6), endMinute: hour(10), ratePaise: 50000 },
    { courtId: null, days: ALL_DAYS, startMinute: hour(10), endMinute: hour(16), ratePaise: 40000 },
    { courtId: null, days: ALL_DAYS, startMinute: hour(16), endMinute: hour(22), ratePaise: 60000 },
  ]);
  const [individual] = await tx
    .insert(membershipPlans)
    .values({ name: 'Demo – Morning regular', kind: 'individual', pricePaise: 200000, description: 'Play three mornings a week in a fixed batch.', features: ['Mon, Wed, Fri · 6–7 am', 'Shuttles included', 'Same court every session'], sortOrder: 1 })
    .returning();
  await tx.insert(membershipPlans).values({ name: 'Demo – Court membership', kind: 'court', pricePaise: 1000000, description: 'Your own court at a fixed weekly time, for your group.', features: ['Choose your days and time', 'Bring up to 10 players'], sortOrder: 2 });
  const batch = { name: 'Demo – Morning batch', courtId: court1.id, days: [1, 3, 5], startMinute: hour(6), endMinute: hour(7) };
  const [created] = await tx.insert(memberBatches).values({ ...batch, planId: individual!.id, capacity: 20, startsOn: today, endsOn: addDays(today, 180) }).returning();
  await holdWeeklyTime(tx, batch, today, addDays(today, 180), { batchId: created!.id, note: `Batch: ${batch.name}` });
});

console.log('Demo data added: open 6 am–10 pm daily; ₹500 / ₹400 / ₹600 an hour; two Demo plans and a Mon/Wed/Fri 6–7 am batch on', court1.name);
await pool.end();
