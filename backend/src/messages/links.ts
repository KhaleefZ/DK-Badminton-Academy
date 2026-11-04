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
