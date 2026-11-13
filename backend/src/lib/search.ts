import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { customers } from '../db/schema.js';

/** Treats % and _ as ordinary characters in a LIKE search. */
export const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** Case-insensitive match (A to Z) against a likeTerm. SQLite needs the escape character named. */
export const ilike = (column: SQL | AnyColumn, term: string): SQL => sql`${column} LIKE ${term} ESCAPE '\\'`;

/** Matches a customer by number, name, email or notes, and by phone however it was spaced. */
export function customerMatches(q: string): SQL {
  const term = likeTerm(q);
  const digits = q.replace(/\D/g, '');
  const text = sql`(${ilike(customers.customerNo, term)} OR ${ilike(customers.name, term)} OR ${ilike(customers.email, term)} OR ${ilike(customers.notes, term)})`;
  return digits.length >= 3 ? sql`(${text} OR ${ilike(customers.phoneDigits, likeTerm(digits))})` : text;
}
