const pad = (n) => String(n).padStart(2, '0');

/** '14:30' as '2:30 PM'. Times stay 24-hour inside the app; only what people read changes. '24:00' is midnight. */
export function formatTime(time) {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 24;
  return `${hour % 12 || 12}:${pad(m)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** '14:30'–'15:00' as '2:30 PM – 3:00 PM'. */
export const slotLabel = (slot) => `${formatTime(slot.start)} – ${formatTime(slot.end)}`;

/** Total length of a booking in hours, e.g. '1.5 hours'. */
export function hoursBooked(slot) {
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const hours = (toMinutes(slot.end) - toMinutes(slot.start)) / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/* ---------- Joining 30-minute slots into a booking ---------- */
// The website shows 30-minute slots. A booking is two or more of them in a row (1 h or longer).

/** True when `count` slots from `index` are all free and back to back. */
function freeRun(slots, index, count) {
  if (index < 0 || index + count > slots.length) return false;
  for (let i = index; i < index + count; i += 1) {
    if (!slots[i].available) return false;
    if (i > index && slots[i - 1].end !== slots[i].start) return false;
  }
  return true;
}

/** A booking of `count` slots starting at `index`, with its time and total price. */
export function selectionAt(slots, index, count) {
  const parts = slots.slice(index, index + count);
  return {
    start: parts[0].start,
    end: parts[parts.length - 1].end,
    durationMinutes: count * 30,
    pricePaise: parts.reduce((sum, s) => sum + s.pricePaise, 0),
  };
}

const indexOf = (slots, start) => slots.findIndex((s) => s.start === start);

/** The saved booking recomputed from live slots, or null if any part of it has since been taken. */
export function liveSelection(slots, selection) {
  if (!selection?.durationMinutes) return null;
  const index = indexOf(slots, selection.start);
  const count = selection.durationMinutes / 30;
  return freeRun(slots, index, count) ? selectionAt(slots, index, count) : null;
}

/** A free slot is only worth showing as bookable if it can be part of the shortest booking. */
export function usable(slots, index, minCount) {
  for (let first = index - minCount + 1; first <= index; first += 1) if (freeRun(slots, first, minCount)) return true;
  return false;
}

/**
 * What tapping slot `index` does, as { selection, note }. Slots are added and removed one tap at a time
 * and must stay back to back. A first tap books the shortest length from there (or ending there, if
 * there's no room after it). Tapping a free slot beyond either end fills the gap, if it's all free.
 * Tapping the first or last selected slot removes it; below the shortest length the selection clears.
 */
export function tapSlot(slots, current, index, minCount) {
  const at = current ? indexOf(slots, current.start) : -1;
  if (at >= 0) {
    const count = current.durationMinutes / 30;
    const last = at + count - 1;
    if (index >= at && index <= last) {
      if (count <= minCount) return { selection: null };
      if (index === at) return { selection: selectionAt(slots, at + 1, count - 1) };
      if (index === last) return { selection: selectionAt(slots, at, count - 1) };
      return { selection: current, note: 'Your half-hours must stay next to each other. To shorten, tap the first or last one.' };
    }
    if (index > last && freeRun(slots, at, index - at + 1)) return { selection: selectionAt(slots, at, index - at + 1) };
    if (index < at && freeRun(slots, index, last - index + 1)) return { selection: selectionAt(slots, index, last - index + 1) };
  }
  if (freeRun(slots, index, minCount)) return { selection: selectionAt(slots, index, minCount) };
  if (freeRun(slots, index - minCount + 1, minCount)) return { selection: selectionAt(slots, index - minCount + 1, minCount) };
  return { selection: current ?? null, note: 'That half-hour can’t be booked on its own. Bookings are at least 1 hour.' };
}

export const durationLabel = (minutes) => (minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60}` : `${minutes / 60} h`);

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
