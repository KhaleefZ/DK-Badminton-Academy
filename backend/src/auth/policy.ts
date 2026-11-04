/** Every login and password rule in one place. */
export const AUTH_POLICY = {
  maxFailedAttempts: 10,
  lockMinutes: 5,
  sessionHours: 12,
  rememberDays: 30,
  resetLinkMinutes: 30,
  passwordMinLength: 10,
  passwordMaxLength: 128,
} as const;

const COMMON_PASSWORDS = new Set([
  '1234567890',
  '12345678910',
  '123456789012',
  '0987654321',
  'password12',
  'password123',
  'password1234',
  'passwordpassword',
  'qwertyuiop',
  'qwerty12345',
  'qwerty123456',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'iloveyou123',
  'adminadmin',
  'admin12345',
  'admin123456',
  'administrator',
  'welcome123',
  'welcome1234',
  'letmein123',
  'badminton123',
  'dkbadminton',
  'dkbadminton123',
  'rally2026',
]);

/** Returns a user-facing problem with the password, or null when it is acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < AUTH_POLICY.passwordMinLength) return `Use at least ${AUTH_POLICY.passwordMinLength} characters.`;
  if (password.length > AUTH_POLICY.passwordMaxLength) return `Use at most ${AUTH_POLICY.passwordMaxLength} characters.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) return 'This password is too common. Choose another.';
  const address = email.trim().toLowerCase();
  const localPart = address.split('@')[0] ?? '';
  if (lower.includes(address) || (localPart.length >= 3 && lower.includes(localPart))) return 'The password can’t contain your email.';
  return null;
}
