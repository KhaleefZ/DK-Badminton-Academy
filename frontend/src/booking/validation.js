const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6–9.
export function normalisePhone(value) {
  return value.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, '');
}

export function validateDetails(details) {
  const errors = {};
  if (!details.name.trim()) errors.name = 'Enter the name the academy should contact.';
  if (!details.phone.trim()) errors.phone = 'Enter a phone number to continue.';
  else if (!/^[6-9]\d{9}$/.test(normalisePhone(details.phone))) errors.phone = 'Please enter a valid phone number to continue.';
  if (!details.email.trim()) errors.email = 'Enter an email address.';
  else if (!EMAIL.test(details.email.trim())) errors.email = 'Please check the email address format.';
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
