const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const formatINR = (value) => `₹${inr.format(value)}`;

export function formatCompactINR(value) {
  return value >= 1000 ? `${value / 1000}k` : String(value);
}

const pad = (n) => String(n).padStart(2, '0');

export function fromISO(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(iso, months) {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export const daysBetween = (fromIso, toIsoDate) => Math.round((fromISO(toIsoDate) - fromISO(fromIso)) / 86_400_000);

/** 29 Oct 2026 */
export const formatDate = (iso) => fromISO(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/** 29 Oct */
export const formatDayMonth = (iso) => fromISO(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/** Thursday, 29 October 2026 */
export const formatLongDate = (iso) =>
  fromISO(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** 29 October 2026 */
export const formatFullDate = (iso) => fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function endTime(start) {
  return `${pad(Number(start.slice(0, 2)) + 1)}:00`;
}

export const timeRange = (start) => `${start}–${endTime(start)}`;

export const timeOf = (isoDateTime) => isoDateTime.slice(11, 16);


const inrExact = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Money from the API is in paise. */
export const formatPaise = (paise) => `₹${inrExact.format((paise ?? 0) / 100)}`;

/** Rupees typed by staff, as whole paise. Null if it isn't a number. */
export function toPaise(rupees) {
  const value = String(rupees).trim();
  return value !== '' && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
}

const venueDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today on the venue's clock, wherever this browser is. */
export const venueToday = () => venueDate.format(new Date());

const venueStamp = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** A stored instant, as the venue's clock shows it. */
export const formatInstant = (value) => venueStamp.format(new Date(value));

// A time input can't show 24:00, so midnight at the end of a day is entered as 00:00.
export const endToInput = (time) => (time === '24:00' ? '00:00' : time);
export const endFromInput = (time) => (time === '00:00' ? '24:00' : time);

export const CUSTOMER_TYPES = { walk_in: 'Walk-in', website: 'Website' };
export const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', online_test: 'Online (test, no real money)' };
export const BLOCK_LABELS = { member_block: 'Member play', staff_block: 'Other block' };

export const MESSAGE_LABELS = {
  booking_confirmed: 'Booking confirmed',
  booking_changed: 'Booking changed',
  booking_cancelled: 'Booking cancelled',
  booking_whatsapp: 'WhatsApp chat opened',
  enquiry_received: 'Enquiry received',
  staff_new_booking: 'Staff alert: new booking',
  staff_new_enquiry: 'Staff alert: new enquiry',
  staff_new_membership: 'Staff alert: new membership',
  membership_confirmed: 'Membership confirmed',
  membership_renewed: 'Membership renewed',
  membership_cancelled: 'Membership cancelled',
  membership_reminder: 'Renewal reminder',
};
export const MESSAGE_STATUS = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', expired: 'Too late', cancelled: 'Cancelled' };
export const MESSAGE_TONES = { queued: 'warning', sending: 'warning', sent: 'success', failed: 'danger', expired: 'tint', cancelled: 'tint' };

// Monday first, as staff read a week; the server's weekday 0 is Sunday.
export const WEEK = [
  { day: 1, name: 'Monday', short: 'Mon' },
  { day: 2, name: 'Tuesday', short: 'Tue' },
  { day: 3, name: 'Wednesday', short: 'Wed' },
  { day: 4, name: 'Thursday', short: 'Thu' },
  { day: 5, name: 'Friday', short: 'Fri' },
  { day: 6, name: 'Saturday', short: 'Sat' },
  { day: 0, name: 'Sunday', short: 'Sun' },
];

export const formatDays = (days) => (days.length === 7 ? 'Every day' : WEEK.filter((w) => days.includes(w.day)).map((w) => w.short).join(', '));
