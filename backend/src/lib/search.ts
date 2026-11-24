import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { customers } from '../db/schema.js';

/**
 * Cloudflare D1 refuses a LIKE pattern over 50 bytes (the local engine allows far more, so tests
 * wouldn't notice). https://developers.cloudflare.com/d1/platform/limits/
 */
export const LIKE_PATTERN_MAX_BYTES = 50;
const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Treats % and _ as ordinary characters in a LIKE search, and keeps the whole pattern within D1's
 * 50 bytes by searching for the start of a longer term (a shorter term still finds the same rows, and more).
 */
export function likeTerm(value: string): string {
  let inner = '';
  for (const char of value) {
    const escaped = /[\\%_]/.test(char) ? `\\${char}` : char;
    if (bytes(inner + escaped) + 2 > LIKE_PATTERN_MAX_BYTES) break;
    inner += escaped;
  }
  return `%${inner}%`;
}

/** Case-insensitive match (A to Z) against a likeTerm. SQLite needs the escape character named. */
export const ilike = (column: SQL | AnyColumn, term: string): SQL => sql`${column} LIKE ${term} ESCAPE '\\'`;

/** Matches a customer by number, name, email or notes, and by phone however it was spaced. */
export function customerMatches(q: string): SQL {
  const term = likeTerm(q);
  const digits = q.replace(/\D/g, '');
  const text = sql`(${ilike(customers.customerNo, term)} OR ${ilike(customers.name, term)} OR ${ilike(customers.email, term)} OR ${ilike(customers.notes, term)})`;
  return digits.length >= 3 ? sql`(${text} OR ${ilike(customers.phoneDigits, likeTerm(digits))})` : text;
}
