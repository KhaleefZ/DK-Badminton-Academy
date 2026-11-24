// Automatic WhatsApp through Meta's WhatsApp Cloud API: approved templates sent straight to Meta, with
// no provider in between. Built for Cloudflare's free plan: one plain fetch per message (one outgoing
// request, almost no CPU), no SDK, and a 10-second timeout so a slow Meta never holds a cron run.
//
// Meta docs: graph.facebook.com/{version}/{phone-number-id}/messages, read 22 Nov 2026.
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { messageSettings } from '../db/schema.js';
import { decrypt } from '../lib/secret.js';
import { whatsappDigits } from './links.js';

/** Meta guarantees each Graph API version for at least two years; v27.0 was the latest on 22 Nov 2026. */
export const GRAPH_VERSION = 'v27.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 10_000;

export type WhatsappKeys = { phoneNumberId: string; token: string };

export type TemplateMessage = {
  /** Any phone number as stored; a plain 10-digit number is taken as Indian (+91). */
  to: string;
  /** The approved template's name in Meta, e.g. dk_booking_confirmed. */
  template: string;
  language: string;
  /** Values for {{1}}, {{2}}, … in the template body, in order. */
  bodyParams: (string | number)[];
  /** The end of a "View booking" style URL button (the template holds the rest of the URL). */
  buttonSuffix?: string;
};

/**
 * A refusal from Meta (or no answer at all), in plain words. `temporary` means the same message may
 * work later (rate limits, Meta busy, network), so the queue retries; otherwise retrying won't help.
 */
export class WhatsappError extends Error {
  constructor(
    message: string,
    readonly temporary: boolean,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

/** Meta's error codes that are worth retrying later. Everything else needs a fix first. */
const TEMPORARY = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131049, 131056, 131057, 133004, 2494100]);

/** Plain-words versions of the errors staff are most likely to see on the Messages page. */
const PLAIN: Record<number, string> = {
  0: 'The WhatsApp access token was refused. Create a new permanent token and save it in Settings.',
  3: 'This WhatsApp account isn’t allowed to send messages yet. Check the app’s permissions in Meta.',
  10: 'The access token is missing a permission (whatsapp_business_messaging). Create the token again with it.',
  100: 'Meta rejected the message details. Check the phone number ID and template names in Settings.',
  190: 'The WhatsApp access token is wrong or has expired. Copy the permanent (system user) token again and save it in Settings.',
  200: 'The WhatsApp access token is missing. Save it in Settings.',
  368: 'Meta has restricted this WhatsApp account for a policy reason. Check WhatsApp Manager.',
  131026: 'This number isn’t on WhatsApp, or can’t receive messages from businesses.',
  131031: 'Meta has locked this WhatsApp account. Check WhatsApp Manager.',
  131042: 'Meta couldn’t charge for this message. Check the payment method in Meta Business settings.',
  131045: 'The academy’s WhatsApp number isn’t registered for sending yet.',
  131047: 'Only an approved template can be sent to this customer (more than 24 hours since they wrote).',
  131048: 'Meta is limiting messages from this number because of its quality rating. Check WhatsApp Manager.',
  131049: 'Meta chose not to deliver this message right now. It will be tried again later.',
  131051: 'Meta doesn’t support this kind of message.',
  131056: 'Too many messages to this person in a short time. It will be tried again shortly.',
  132000: 'The template’s number of values doesn’t match what was sent. Check the template wording in Meta.',
  132001: 'That template isn’t approved in this language yet. Check its name and language in Settings and WhatsApp Manager.',
  132005: 'The template text is too long once filled in.',
  132007: 'Meta rejected the template for its content.',
  132012: 'A value in the template is in the wrong format.',
  132015: 'Meta paused this template because of low quality. Edit it in WhatsApp Manager.',
  132016: 'Meta disabled this template. Create and approve a new one.',
  133010: 'The academy’s WhatsApp number isn’t registered for sending yet.',
  130429: 'Meta’s sending limit was reached. Messages will be tried again shortly.',
  80007: 'This WhatsApp account’s rate limit was reached. Messages will be tried again later.',
};

/** Meta wants the full number with the country code; the plus makes that explicit. */
export const whatsappTo = (phone: string) => `+${whatsappDigits(phone)}`;

/**
 * Template values can't hold new lines, tabs or long runs of spaces (Meta refuses them), so each
 * value becomes one tidy line. An empty value would also be refused, so it becomes a dash.
 */
export function templateValue(value: string | number | null | undefined): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  return text || '-';
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let testFetch: Fetch | null = null;

/** Tests swap in a fake Meta. Refused outside tests, so production always talks to the real one. */
export function useTestWhatsapp(fetcher: Fetch | null): void {
  if (config.NODE_ENV !== 'test') throw new Error('A test WhatsApp sender can only be used in tests.');
  testFetch = fetcher;
}

type MetaError = { error?: { code?: number; message?: string; error_data?: { details?: string }; is_transient?: boolean } };

async function callMeta<T>(keys: WhatsappKeys, path: string, init: RequestInit = {}): Promise<T> {
  const fetcher = testFetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${GRAPH}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${keys.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WhatsappError('Couldn’t reach WhatsApp (Meta). It will be tried again shortly.', true);
  }
  const body = (await response.json().catch(() => null)) as (T & MetaError) | null;
  if (response.ok && body && !body.error) return body;

  const error = body?.error;
  const code = typeof error?.code === 'number' ? error.code : null;
  const temporary = Boolean(error?.is_transient) || (code !== null && TEMPORARY.has(code)) || response.status >= 500;
  const plain = (code !== null && PLAIN[code]) || (temporary ? 'WhatsApp (Meta) is busy. It will be tried again shortly.' : `WhatsApp (Meta) refused the message: ${error?.error_data?.details || error?.message || `HTTP ${response.status}`}`);
  throw new WhatsappError(code !== null ? `${plain} (Meta code ${code})` : plain, temporary, code);
}

/** Sends one approved template. Returns Meta's message id; Meta has accepted it, delivery follows. */
export async function sendTemplate(keys: WhatsappKeys, message: TemplateMessage): Promise<{ messageId: string }> {
  const components: object[] = [{ type: 'body', parameters: message.bodyParams.map((value) => ({ type: 'text', text: templateValue(value) })) }];
  if (message.buttonSuffix) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: encodeURIComponent(message.buttonSuffix) }] });
  }
  const sent = await callMeta<{ messages?: { id?: string }[] }>(keys, `${encodeURIComponent(keys.phoneNumberId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: whatsappTo(message.to),
      type: 'template',
      template: { name: message.template, language: { code: message.language }, components },
    }),
  });
  const messageId = sent.messages?.[0]?.id;
  if (!messageId) throw new WhatsappError('WhatsApp (Meta) didn’t confirm the message. It will be tried again shortly.', true);
  return { messageId };
}

export type WhatsappNumberInfo = { displayPhoneNumber: string; verifiedName: string; qualityRating: string; verification: string | null };

/** Reads the academy's number from Meta to prove the keys work. Sends nothing and costs nothing. */
export async function checkConnection(keys: WhatsappKeys): Promise<WhatsappNumberInfo> {
  const info = await callMeta<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>(
    keys,
    `${encodeURIComponent(keys.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
  );
  return {
    displayPhoneNumber: info.display_phone_number ?? '',
    verifiedName: info.verified_name ?? '',
    qualityRating: info.quality_rating ?? 'NA',
    verification: info.code_verification_status ?? null,
  };
}

/** The template names used when the Owner hasn't changed them in Settings. */
export const DEFAULT_TEMPLATES = {
  booking_confirmed: 'dk_booking_confirmed',
  booking_cancelled: 'dk_booking_cancelled',
  membership_confirmed: 'dk_membership_confirmed',
  membership_renewed: 'dk_membership_renewed',
  owner_new_booking: 'dk_owner_new_booking',
  owner_new_membership: 'dk_owner_new_membership',
  owner_membership_cancelled: 'dk_owner_membership_cancelled',
  owner_refund: 'dk_owner_refund',
} as const;

export type WhatsappMessageKind = keyof typeof DEFAULT_TEMPLATES;

export type WhatsappSetup = {
  keys: WhatsappKeys;
  language: string;
  templates: Record<WhatsappMessageKind, string>;
  ownerNumbers: string[];
  dailyLimit: number;
};

/**
 * The saved WhatsApp setup, ready to send, or null while it's switched off or incomplete
 * (then customers get the fallback email instead).
 */
export async function whatsappSetup(): Promise<WhatsappSetup | null> {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  if (!row?.whatsappEnabled || !row.whatsappPhoneNumberId || !row.whatsappTokenEncrypted) return null;
  return {
    keys: { phoneNumberId: row.whatsappPhoneNumberId, token: decrypt(row.whatsappTokenEncrypted) },
    language: row.whatsappTemplateLanguage,
    // A name left blank in Settings keeps the built-in one.
    templates: { ...DEFAULT_TEMPLATES, ...Object.fromEntries(Object.entries(row.whatsappTemplates ?? {}).filter(([, name]) => name?.trim())) },
    ownerNumbers: (row.ownerWhatsappNumbers ?? []).filter((n) => n.trim()),
    dailyLimit: row.dailyWhatsappLimit,
  };
}
