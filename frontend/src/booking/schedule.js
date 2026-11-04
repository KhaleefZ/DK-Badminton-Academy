const pad = (n) => String(n).padStart(2, '0');

export const slotLabel = (slot) => `${slot.start}–${slot.end}`;

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Prices from the API are in paise. */
export const formatPaise = (paise) => `₹${inr.format(paise / 100)}`;

/* ---------- Date helpers (local calendar dates as YYYY-MM-DD) ---------- */
export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const venueDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today at the venue, wherever the visitor is. */
export const todayISO = () => venueDate.format(new Date());

export function addDays(iso, days) {
  const date = fromISO(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export function startOfWeek(iso) {
  const day = fromISO(iso).getDay(); // 0 = Sunday
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

export const formatLong = (iso) =>
  fromISO(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatShort = (iso) => fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const formatMonth = (iso) => fromISO(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export const formatWeekday = (iso) => fromISO(iso).toLocaleDateString('en-GB', { weekday: 'short' });

export const dayOfMonth = (iso) => pad(fromISO(iso).getDate());
