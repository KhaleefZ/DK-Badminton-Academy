import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// OWASP's recommended minimum for Argon2id: 19 MiB, 2 passes, 1 thread.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON2_OPTIONS);

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

// Checked when an email has no account, so that case takes as long as a wrong password.
const decoyHash = hashPassword(randomBytes(32).toString('hex'));

export async function verifyDecoy(password: string): Promise<void> {
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
