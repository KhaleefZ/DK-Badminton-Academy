import { z } from 'zod';
import { invalid } from './errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
  return parsed.data;
}
