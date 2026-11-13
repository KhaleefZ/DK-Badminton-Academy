import { nextNumber } from '../db/schema.js';
import { z } from 'zod';

export const customerDetails = z.object({
  name: z.string({ error: 'Enter the customer’s name.' }).trim().min(1, 'Enter the customer’s name.').max(120),
  phone: z.string({ error: 'Enter a phone number.' }).trim().regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number.'),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email.').max(254)]).nullish().transform((v) => v || null),
  notes: z.string().trim().max(1000).nullish().transform((v) => v || null),
});

export const WALK_IN_NUMBER = () => nextNumber('WLK-', 4);
export const WEBSITE_NUMBER = () => nextNumber('WEB-', 4);
