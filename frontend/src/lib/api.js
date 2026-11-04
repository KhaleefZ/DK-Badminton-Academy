// The website has no login, so these calls carry no cookies.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}/public${path}`, {
      method,
      cache: 'no-store',
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Can’t reach the booking system. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  throw new ApiError(data?.error?.message ?? 'Something went wrong. Please try again.', { status: response.status, code: data?.error?.code ?? 'SERVER_ERROR' });
}
