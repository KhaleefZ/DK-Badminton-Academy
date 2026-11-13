import { eq } from 'drizzle-orm';
import { config, isProduction } from '../config.js';
import { db } from '../db/client.js';
import { paymentSettings } from '../db/schema.js';
import { decrypt } from '../lib/secret.js';
import { cashfreeGateway } from './cashfree.js';
import { razorpayGateway } from './razorpay.js';

export type GatewayName = 'cashfree' | 'razorpay';

export type NewOrder = {
  /** Our own reference, unique per attempt. Cashfree uses it as the order id; Razorpay keeps it as the receipt. */
  reference: string;
  amountPaise: number;
  description: string;
  customer: { id: string; name: string; phone: string; email?: string | null };
  /** Where the gateway sends payment results. Only given when it's https, as gateways refuse anything else. */
  notifyUrl?: string;
};

/** What the website needs to open the gateway's checkout. Nothing secret. */
export type CheckoutInfo =
  | { gateway: 'cashfree'; mode: 'sandbox' | 'production'; paymentSessionId: string; orderId: string }
  | { gateway: 'razorpay'; keyId: string; orderId: string; amountPaise: number; currency: 'INR'; description: string; prefill: { name: string; contact: string; email?: string } };

export type OrderState = { status: 'paid'; paymentId: string; amountPaise: number } | { status: 'pending' | 'failed' };

/** A checked webhook. `ignored` covers events this app doesn't act on, such as refunds. */
export type WebhookResult = { kind: 'paid'; orderId: string; paymentId: string; amountPaise: number } | { kind: 'failed'; orderId: string } | { kind: 'ignored' };

export type Gateway = {
  name: GatewayName;
  live: boolean;
  createOrder(order: NewOrder): Promise<{ orderId: string; checkout: CheckoutInfo }>;
  fetchOrder(orderId: string): Promise<OrderState>;
  /** Null when the signature is wrong: the request didn't come from the gateway. */
  verifyWebhook(header: (name: string) => string | undefined, rawBody: string): WebhookResult | null;
  refund(payment: { orderId: string; paymentId: string; amountPaise: number; reason: string; reference: string }): Promise<{ refundId: string }>;
  /** Throws a GatewayError if the keys don't work. Creates nothing. */
  checkCredentials(): Promise<void>;
};

/** A gateway problem in words staff can act on. */
export class GatewayError extends Error {}

export type GatewayKeys = { gateway: GatewayName; live: boolean; keyId: string; keySecret: string; webhookSecret: string | null };

let testGateway: ((keys: GatewayKeys) => Gateway) | null = null;

/** Tests swap in a fake gateway. Refused outside tests, so production always talks to the real one. */
export function useTestGateway(factory: ((keys: GatewayKeys) => Gateway) | null): void {
  if (config.NODE_ENV !== 'test') throw new Error('A test gateway can only be used in tests.');
  testGateway = factory;
}

export function buildGateway(keys: GatewayKeys): Gateway {
  if (testGateway) return testGateway(keys);
  return keys.gateway === 'cashfree' ? cashfreeGateway(keys) : razorpayGateway(keys);
}

/**
 * How the website takes money right now:
 * - `gateway`: switched on in Settings with working keys.
 * - `simulator`: local development only (PAYMENT_SIMULATOR=true). A button stands in for paying and no money moves.
 * - `off`: online booking and joining are closed; the website asks people to call or WhatsApp.
 */
export type OnlinePayments = { kind: 'off' } | { kind: 'simulator' } | { kind: 'gateway'; gateway: Gateway };

export async function savedGatewayKeys(): Promise<GatewayKeys | null> {
  const [row] = await db.select().from(paymentSettings).where(eq(paymentSettings.id, 1));
  if (!row?.gateway || !row.keyId || !row.keySecretEncrypted) return null;
  return {
    gateway: row.gateway,
    live: row.mode === 'live',
    keyId: row.keyId,
    keySecret: decrypt(row.keySecretEncrypted),
    webhookSecret: row.webhookSecretEncrypted ? decrypt(row.webhookSecretEncrypted) : null,
  };
}

export async function onlinePayments(): Promise<OnlinePayments> {
  const [row] = await db.select({ enabled: paymentSettings.enabled }).from(paymentSettings).where(eq(paymentSettings.id, 1));
  if (row?.enabled) {
    const keys = await savedGatewayKeys();
    if (keys) return { kind: 'gateway', gateway: buildGateway(keys) };
  }
  return config.PAYMENT_SIMULATOR === 'true' && !isProduction ? { kind: 'simulator' } : { kind: 'off' };
}

/** True when no real money moves: the simulator, or a gateway in test (sandbox) mode. */
export const isTestMoney = (online: OnlinePayments) => online.kind === 'simulator' || (online.kind === 'gateway' && !online.gateway.live);

/** What the website needs to know before taking money. Nothing secret. */
export function paymentInfo(online: OnlinePayments) {
  return {
    online: online.kind !== 'off',
    // cashfree / razorpay load that gateway's checkout; simulator shows the test buttons.
    via: online.kind === 'gateway' ? online.gateway.name : online.kind === 'simulator' ? 'simulator' : null,
    testMode: isTestMoney(online),
  };
}

/** Where gateways should send payment results: this API's own address. Only https is accepted by gateways. */
export function webhookUrl(host: string | undefined): string | undefined {
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) return undefined;
  return `https://${host}/webhooks/payments`;
}

/** The last 10 digits of a phone, which is what Indian gateways expect. */
export const tenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** Reads a gateway's JSON reply, turning a failure into a GatewayError with the gateway's own message. */
export async function gatewayJson<T>(response: Response, what: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: { description?: string } } | null;
  if (response.ok) return body as T;
  const detail = body?.message ?? body?.error?.description ?? `HTTP ${response.status}`;
  if (response.status === 401) throw new GatewayError(`The payment keys were refused (${what}). Check them in Settings.`);
  throw new GatewayError(`The payment gateway couldn’t ${what}: ${detail}`);
}
