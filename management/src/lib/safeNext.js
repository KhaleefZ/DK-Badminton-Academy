/**
 * Where to go after signing in, from a `?next=` link. Only a page of this admin panel is allowed, so a
 * crafted link can't send staff to another site after a real sign-in (an open redirect, used for phishing).
 * Backslashes are refused outright: browsers read `/\evil.com` as `//evil.com`, another site
 * (the trick in React Router advisory GHSA-wrjc-x8rr-h8h6).
 */
export function safeNext(value, { allowLogin = true } = {}) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  // Control characters (tabs, new lines) are dropped by URL parsing and can hide a second slash.
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    if (!allowLogin && url.pathname.startsWith('/login')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
