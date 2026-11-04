// Every call to the backend goes through here. The session lives in an httpOnly cookie the
// browser sends by itself, so page scripts never see or store a token.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Lets the auth layer react when any call finds the session has ended. */
export const SESSION_ENDED_EVENT = 'dk:session-ended';
export const PASSWORD_CHANGE_EVENT = 'dk:password-change-required';

export async function api(path, { method = 'GET', body, rawBody, contentType, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: rawBody ? { 'Content-Type': contentType } : body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Can’t reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (response.ok) return data;

  const error = new ApiError(data?.error?.message ?? 'Something went wrong. Please try again.', {
    status: response.status,
    code: data?.error?.code ?? 'SERVER_ERROR',
  });
  if (error.code === 'NOT_SIGNED_IN') window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
  if (error.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
  throw error;
}
