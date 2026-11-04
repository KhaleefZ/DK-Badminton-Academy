// Talks to the backend's /auth API. Passwords are checked on the server only.
import { api, ApiError } from '../lib/api';

export const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', front_desk: 'Front Desk' };

// The cookie can't be removed from page scripts. If the server is unreachable during sign-out,
// this flag finishes the job on the next load, so a reload can't quietly sign the person back in.
const PENDING_SIGN_OUT = 'dk-pending-sign-out';

const pending = {
  get() {
    try {
      return localStorage.getItem(PENDING_SIGN_OUT) === '1';
    } catch {
      return false;
    }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(PENDING_SIGN_OUT, '1');
      else localStorage.removeItem(PENDING_SIGN_OUT);
    } catch {
      // Storage blocked: nothing to remember it with.
    }
  },
};

const initialsOf = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

const toUser = (account) => ({
  ...account,
  role: ROLE_LABELS[account.role] ?? account.role,
  roleKey: account.role,
  initials: initialsOf(account.name),
});

/** Resolves with the signed-in user, or rejects with a user-facing message. */
export async function signIn(email, password, remember) {
  const { user } = await api('/auth/login', { method: 'POST', body: { email: email.trim(), password, remember } });
  pending.set(false);
  return toUser(user);
}

/** Resolves true when the server ended the session, false when it couldn't be reached. */
export async function signOut() {
  try {
    await api('/auth/logout', { method: 'POST' });
    pending.set(false);
    return true;
  } catch {
    pending.set(true);
    return false;
  }
}

export async function signOutEverywhere() {
  await api('/auth/logout-all', { method: 'POST' });
  pending.set(false);
}

/** Retries a sign-out that couldn't reach the server earlier. */
export async function finishPendingSignOut() {
  if (pending.get()) await signOut();
}

/** The signed-in user, or null. Rejects only when the server can't be reached. */
export async function fetchCurrentUser() {
  if (pending.get()) {
    await signOut();
    return null;
  }
  try {
    const { user } = await api('/auth/me');
    return toUser(user);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const requestPasswordReset = (email) => api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });

export const resetPassword = (token, newPassword) => api('/auth/reset-password', { method: 'POST', body: { token, newPassword } });

export async function changePassword(currentPassword, newPassword) {
  const { user } = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  return toUser(user);
}
