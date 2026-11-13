import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Gateway, GatewayKeys, OrderState, WebhookResult } from './gateway.js';
import { gatewayJson, GatewayError, tenDigits } from './gateway.js';

// Cashfree Payment Gateway API, called with plain fetch so it runs on Cloudflare Workers.
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest
// Check the current x-api-version in those docs when going live; it's pinned here on purpose.
const API_VERSION = '2025-01-01';

const rupees = (paise: number) => Math.round(paise) / 100;
const paise = (rupeesAmount: number) => Math.round(rupeesAmount * 100);

/** Cashfree signs a webhook as base64(HMAC-SHA256(secret key, timestamp + raw body)). */
export function cashfreeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function cashfreeGateway(keys: GatewayKeys): Gateway {
  const base = keys.live ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const headers = { 'x-client-id': keys.keyId, 'x-client-secret': keys.keySecret, 'x-api-version': API_VERSION, 'content-type': 'application/json', accept: 'application/json' };
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers });

  return {
    name: 'cashfree',
    live: keys.live,

    async createOrder(order) {
      const body = {
        order_id: order.reference,
        order_amount: rupees(order.amountPaise),
        order_currency: 'INR',
        order_note: order.description.slice(0, 200),
        customer_details: {
          customer_id: order.customer.id.replace(/[^\w-]/g, '').slice(0, 50),
          customer_name: order.customer.name.slice(0, 100),
          customer_phone: tenDigits(order.customer.phone),
          ...(order.customer.email ? { customer_email: order.customer.email } : {}),
        },
        ...(order.notifyUrl ? { order_meta: { notify_url: order.notifyUrl } } : {}),
      };
      const created = await gatewayJson<{ order_id: string; payment_session_id: string }>(await call('/orders', { method: 'POST', body: JSON.stringify(body) }), 'start the payment');
      return {
        orderId: created.order_id,
        checkout: { gateway: 'cashfree', mode: keys.live ? 'production' : 'sandbox', paymentSessionId: created.payment_session_id, orderId: created.order_id },
      };
    },

    async fetchOrder(orderId): Promise<OrderState> {
      const order = await gatewayJson<{ order_status: string }>(await call(`/orders/${encodeURIComponent(orderId)}`), 'look up the payment');
      if (order.order_status === 'PAID') {
        const attempts = await gatewayJson<{ cf_payment_id: string | number; payment_status: string; payment_amount: number }[]>(
          await call(`/orders/${encodeURIComponent(orderId)}/payments`),
          'look up the payment',
        );
        const paid = attempts.find((a) => a.payment_status === 'SUCCESS');
        if (paid) return { status: 'paid', paymentId: String(paid.cf_payment_id), amountPaise: paise(paid.payment_amount) };
      }
      return { status: order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED' ? 'failed' : 'pending' };
    },

    verifyWebhook(header, rawBody): WebhookResult | null {
      const signature = header('x-webhook-signature');
      const timestamp = header('x-webhook-timestamp');
      if (!signature || !timestamp || !sameText(signature, cashfreeSignature(keys.keySecret, timestamp, rawBody))) return null;
      const event = JSON.parse(rawBody) as { type?: string; data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number; payment_status?: string; payment_amount?: number } } };
      const orderId = event.data?.order?.order_id;
      const payment = event.data?.payment;
      if (!orderId) return { kind: 'ignored' };
      if (event.type === 'PAYMENT_SUCCESS_WEBHOOK' && payment?.payment_status === 'SUCCESS' && payment.cf_payment_id !== undefined && payment.payment_amount !== undefined) {
        return { kind: 'paid', orderId, paymentId: String(payment.cf_payment_id), amountPaise: paise(payment.payment_amount) };
      }
      if (event.type === 'PAYMENT_FAILED_WEBHOOK' || event.type === 'PAYMENT_USER_DROPPED_WEBHOOK') return { kind: 'failed', orderId };
      return { kind: 'ignored' };
    },

    async refund({ orderId, amountPaise, reason, reference }) {
      const refund = await gatewayJson<{ cf_refund_id?: string | number; refund_id: string }>(
        await call(`/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', body: JSON.stringify({ refund_amount: rupees(amountPaise), refund_id: reference, refund_note: reason.slice(0, 100) }) }),
        'refund the payment',
      );
      return { refundId: String(refund.cf_refund_id ?? refund.refund_id) };
    },

    async checkCredentials() {
      // Asking for an order that can't exist: working keys get "not found", wrong keys get 401.
      const response = await call(`/orders/dk-key-check-${Date.now()}`);
      if (response.status === 404) return;
      if (response.status === 401 || response.status === 403) throw new GatewayError('Cashfree refused these keys. Check the App ID, the Secret key, and that Test or Live matches the keys.');
      if (!response.ok) throw new GatewayError(`Cashfree answered with an error (HTTP ${response.status}). Try again in a minute.`);
    },
  };
}
