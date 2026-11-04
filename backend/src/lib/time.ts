// The venue is in India, which has one fixed offset and no daylight saving.
const IST_OFFSET = '+05:30';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 1440;

/** 'HH:MM' to minutes from midnight. '24:00' is the end of the day. */
export function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= MINUTES_PER_DAY ? minutes : null;
}

export function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** 0 is Sunday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The instant a venue-clock time happens. Minute 1440 is midnight at the end of that date. */
export const instantAt = (date: string, minutes: number) => new Date(new Date(`${date}T00:00:00${IST_OFFSET}`).getTime() + minutes * 60_000);

/** Today's date on the venue's clock. */
export const venueToday = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** An instant as a date and minutes on the venue's clock. */
export function onVenueClock(instant: Date): { date: string; minutes: number } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** A stored reservation period as the date and times staff see. An end at midnight stays on the same date as 24:00. */
export function periodView(startsAt: Date, endsAt: Date) {
  const start = onVenueClock(startsAt);
  const end = onVenueClock(endsAt);
  return { date: start.date, start: toTime(start.minutes), end: toTime(end.minutes === 0 ? MINUTES_PER_DAY : end.minutes) };
}

/** The last day of a period starting on `date`: one month on, less a day. 31 Jan runs to 27 or 28 Feb. */
export function monthEnd(date: string, months = 1): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  return addDays(target.toISOString().slice(0, 10), -1);
}
