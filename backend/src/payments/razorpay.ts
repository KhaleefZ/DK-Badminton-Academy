import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Gateway, GatewayKeys, OrderState, WebhookResult } from './gateway.js';
import { gatewayJson, GatewayError, tenDigits } from './gateway.js';

// Razorpay Orders and Payments API, called with plain fetch so it runs on Cloudflare Workers.
// Docs: https://razorpay.com/docs/api/  Payments must be set to capture automatically (the default).

/** Razorpay signs a webhook as hex(HMAC-SHA256(webhook secret, raw body)). */
export function razorpaySignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

type RazorpayPayment = { id: string; order_id: string; amount: number; status: string };

export function razorpayGateway(keys: GatewayKeys): Gateway {
  const base = 'https://api.razorpay.com/v1';
  const auth = `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json' } });

  return {
    name: 'razorpay',
    live: keys.live,

    async createOrder(order) {
      const created = await gatewayJson<{ id: string }>(
        await call('/orders', { method: 'POST', body: JSON.stringify({ amount: order.amountPaise, currency: 'INR', receipt: order.reference.slice(0, 40), notes: { reference: order.reference } }) }),
        'start the payment',
      );
      return {
        orderId: created.id,
        checkout: {
          gateway: 'razorpay',
          keyId: keys.keyId,
          orderId: created.id,
          amountPaise: order.amountPaise,
          currency: 'INR',
          description: order.description,
          prefill: { name: order.customer.name, contact: tenDigits(order.customer.phone), ...(order.customer.email ? { email: order.customer.email } : {}) },
        },
      };
    },

    async fetchOrder(orderId): Promise<OrderState> {
      const { items } = await gatewayJson<{ items: RazorpayPayment[] }>(await call(`/orders/${encodeURIComponent(orderId)}/payments`), 'look up the payment');
      const captured = items.find((p) => p.status === 'captured');
      if (captured) return { status: 'paid', paymentId: captured.id, amountPaise: captured.amount };
      return { status: 'pending' };
    },

    verifyWebhook(header, rawBody): WebhookResult | null {
      const signature = header('x-razorpay-signature');
      if (!signature || !keys.webhookSecret || !sameText(signature, razorpaySignature(keys.webhookSecret, rawBody))) return null;
      const event = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: RazorpayPayment } } };
      const payment = event.payload?.payment?.entity;
      if (!payment?.order_id) return { kind: 'ignored' };
      if ((event.event === 'payment.captured' || event.event === 'order.paid') && payment.status === 'captured') {
        return { kind: 'paid', orderId: payment.order_id, paymentId: payment.id, amountPaise: payment.amount };
      }
      if (event.event === 'payment.failed') return { kind: 'failed', orderId: payment.order_id };
      return { kind: 'ignored' };
    },

    async refund({ paymentId, amountPaise, reason, reference }) {
      const refund = await gatewayJson<{ id: string }>(
        await call(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: JSON.stringify({ amount: amountPaise, receipt: reference.slice(0, 40), notes: { reason: reason.slice(0, 250) } }) }),
        'refund the payment',
      );
      return { refundId: refund.id };
    },

    async checkCredentials() {
      if (keys.live !== keys.keyId.startsWith('rzp_live_')) {
        throw new GatewayError(keys.live ? 'These are Razorpay test keys (rzp_test_…) but Live is chosen.' : 'These are Razorpay live keys (rzp_live_…) but Test is chosen.');
      }
      if (!keys.webhookSecret) throw new GatewayError('Add the webhook secret you typed when creating the Razorpay webhook.');
      const response = await call('/orders?count=1');
      if (response.ok) return;
      if (response.status === 401) throw new GatewayError('Razorpay refused these keys. Check the Key ID and Key Secret.');
      throw new GatewayError(`Razorpay answered with an error (HTTP ${response.status}). Try again in a minute.`);
    },
  };
}
