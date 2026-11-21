const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6–9.
export function normalisePhone(value) {
  return value.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, '');
}

/** The same limits the server applies, so the form catches problems before sending. */
export const DETAIL_LIMITS = { name: 120, email: 254, notes: 1000 };

// Letters in any script (so Tamil and other names work), with spaces, dots, apostrophes and hyphens between them.
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

/**
 * Checks the player's details. Name and phone are always required; email only when `emailRequired`
 * (memberships need one, bookings don't). Notes are optional but limited in length.
 */
export function validateDetails(details, { emailRequired = false } = {}) {
  const errors = {};
  const name = details.name.trim();
  if (!name) errors.name = 'Enter your full name.';
  else if (name.length < 2) errors.name = 'Enter at least 2 letters.';
  else if (name.length > DETAIL_LIMITS.name) errors.name = `Keep the name to ${DETAIL_LIMITS.name} characters or fewer.`;
  else if (!NAME.test(name)) errors.name = 'Use letters only. Spaces, dots, apostrophes and hyphens are fine.';

  const phone = normalisePhone(details.phone.trim());
  if (!phone) errors.phone = 'Enter a mobile number.';
  else if (!/^\d+$/.test(phone)) errors.phone = 'Use digits only, like 98765 43210.';
  else if (phone.length !== 10) errors.phone = `Enter a 10-digit mobile number. This one has ${phone.length} digit${phone.length === 1 ? '' : 's'}.`;
  else if (!/^[6-9]/.test(phone)) errors.phone = 'Indian mobile numbers start with 6, 7, 8 or 9.';

  const email = details.email.trim();
  if (!email) {
    if (emailRequired) errors.email = 'Enter an email address.';
  } else if (email.length > DETAIL_LIMITS.email) errors.email = `Keep the email to ${DETAIL_LIMITS.email} characters or fewer.`;
  else if (!EMAIL.test(email)) errors.email = 'Enter a valid email address, like name@example.com.';

  const notes = (details.notes ?? '').trim();
  if (notes.length > DETAIL_LIMITS.notes) errors.notes = `Keep notes to ${DETAIL_LIMITS.notes.toLocaleString('en-IN')} characters or fewer. You have ${notes.length.toLocaleString('en-IN')}.`;
  return errors;
}

export function validateEnquiry(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Enter your name.';
  if (!form.email.trim()) errors.email = 'Enter an email address.';
  else if (!EMAIL.test(form.email.trim())) errors.email = 'Please check the email address format.';
  if (form.phone.trim() && !/^[6-9]\d{9}$/.test(normalisePhone(form.phone))) errors.phone = 'Please check the phone number format.';
  if (!form.message.trim()) errors.message = 'Share your question or playing goals.';
  if (!form.consent) errors.consent = 'Please agree to be contacted about this enquiry.';
  return errors;
}
