import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// PBKDF2-SHA256 through WebCrypto, which Cloudflare Workers run natively. 100,000 rounds is the
// most Workers allow; with the login lockout and rate limits it keeps guessing impractical.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, HASH_BITS));
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** Stored as pbkdf2$<rounds>$<salt>$<hash>, so the rounds can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ITERATIONS);
  return ['pbkdf2', ITERATIONS, b64(salt), b64(hash)].join('$');
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = storedHash.split('$');
  if (scheme !== 'pbkdf2' || !rounds || !salt || !hash) return false;
  const iterations = Number(rounds);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), iterations);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Checked when an email has no account, so that case takes as long as a wrong password.
// Made on first use: Workers don't allow random values while the code is loading.
let decoyHash: Promise<string> | undefined;

export async function verifyDecoy(password: string): Promise<void> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(await decoyHash, password);
}

/** A random URL-safe token for sessions and reset links. */
export const generateToken = () => randomBytes(32).toString('base64url');

/** Tokens have 256 bits of randomness, so a plain SHA-256 is safe for storing them. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A one-time password without look-alike characters, easy to read out to a staff member. */
export function generateTemporaryPassword(length = 14): string {
  return Array.from({ length }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join('');
}
