import { sql, type SQL } from 'drizzle-orm';
import { customers } from '../db/schema.js';

/** Treats % and _ as ordinary characters in a LIKE search. */
export const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** Matches a customer by number, name, email or notes, and by phone however it was spaced. */
export function customerMatches(q: string): SQL {
  const term = likeTerm(q);
  const digits = q.replace(/\D/g, '');
  const text = sql`(${customers.customerNo} ILIKE ${term} OR ${customers.name} ILIKE ${term} OR ${customers.email} ILIKE ${term} OR ${customers.notes} ILIKE ${term})`;
  return digits.length >= 3 ? sql`(${text} OR regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') LIKE ${likeTerm(digits)})` : text;
}
