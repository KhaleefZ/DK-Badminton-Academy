import { useSite } from './site';

/** Contact details the Owner saved in the admin panel. */
export const useVenue = () => useSite().venue;

/** A chat with the academy, already saying what it's about. Null until a number is saved. */
export function whatsappLink(number, text) {
  if (!number) return null;
  const digits = number.replace(/\D/g, '').replace(/^00/, '');
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(text)}`;
}
