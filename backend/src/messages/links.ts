import { createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * A booking's private link can be rebuilt from its id and the app's secret, so it can go in a
 * later email without being stored. A database leak alone reveals neither the link nor its hash's source.
 */
export const bookingToken = (bookingId: string) => createHmac('sha256', `link:${config.APP_SECRET}`).update(bookingId).digest('base64url');

export const bookingLink = (bookingId: string) => `${config.WEBSITE_ORIGIN}/booking/status/${bookingToken(bookingId)}`;

export const membershipToken = (membershipId: string) => createHmac('sha256', `membership:${config.APP_SECRET}`).update(membershipId).digest('base64url');

export const membershipLink = (membershipId: string) => `${config.WEBSITE_ORIGIN}/membership/status/${membershipToken(membershipId)}`;

/** wa.me wants digits with the country code. A plain 10-digit number is taken as Indian. */
export function whatsappDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  return digits.length === 10 ? `91${digits}` : digits.replace(/^0/, '');
}

type BookingForLink = {
  id: string;
  bookingNo: string;
  status: string;
  date: string;
  start: string;
  end: string;
  courtName: string;
  customer: { name: string; phone: string | null };
};

export function customerWhatsappUrl(booking: BookingForLink): string | null {
  if (!booking.customer.phone || booking.status !== 'active') return null;
  const text = `Hi ${booking.customer.name}, your court booking ${booking.bookingNo} is confirmed: ${booking.courtName}, ${booking.date}, ${booking.start}-${booking.end}. Details: ${bookingLink(booking.id)}`;
  return `https://wa.me/${whatsappDigits(booking.customer.phone)}?text=${encodeURIComponent(text)}`;
}

type MembershipForReminder = {
  id: string;
  membershipNo: string;
  holderName: string;
  phone: string;
  status: string;
  endsOn: string;
  pricePaise: number;
  planName: string;
};

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * A WhatsApp chat with the member, the renewal reminder already typed. Staff send it from the academy's
 * phone, so it costs nothing (automatic sending would need WhatsApp's paid Business API).
 */
export function membershipReminderWhatsappUrl(m: MembershipForReminder, today: string): string | null {
  if (!m.phone || m.status !== 'active') return null;
  const ended = m.endsOn < today;
  const text = [
    `Hi ${m.holderName}, this is DK Badminton Academy.`,
    ended
      ? `Your ${m.planName} membership (${m.membershipNo}) ended on ${longDate(m.endsOn)}.`
      : `Your ${m.planName} membership (${m.membershipNo}) ${m.endsOn === today ? 'ends today' : `ends on ${longDate(m.endsOn)}`}.`,
    `Renewing keeps your place: ${rupees(m.pricePaise)} for the next month. Reply here or pay at the academy to renew.`,
    `Your membership details: ${membershipLink(m.id)}`,
  ].join('\n\n');
  return `https://wa.me/${whatsappDigits(m.phone)}?text=${encodeURIComponent(text)}`;
}
