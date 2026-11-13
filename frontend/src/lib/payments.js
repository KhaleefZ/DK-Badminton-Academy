import { useEffect, useState } from 'react';
import { api } from './api';

// Each gateway's own checkout script, loaded only when that gateway is in use.
const SCRIPTS = {
  cashfree: 'https://sdk.cashfree.com/js/v3/cashfree.js',
  razorpay: 'https://checkout.razorpay.com/v1/checkout.js',
};
const loading = {};

function loadScript(src) {
  loading[src] ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      delete loading[src];
      reject(new Error('The payment page couldn’t load. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading[src];
}

/** How the website takes money right now: { online, via: 'cashfree' | 'razorpay' | 'simulator' | null, testMode }. */
export function usePaymentInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    api('/payments')
      .then((result) => live && setInfo(result))
      .catch(() => live && setInfo({ online: false, via: null, testMode: false }));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/**
 * Opens the gateway's checkout over the page. Resolves 'done' when the gateway says it finished,
 * or 'closed' when the person shut it. Either way the server is asked what really happened:
 * what the browser hears is never what confirms a booking.
 */
export async function openCheckout(checkout) {
  await loadScript(SCRIPTS[checkout.gateway]);
  if (checkout.gateway === 'cashfree') {
    const cashfree = window.Cashfree({ mode: checkout.mode });
    const result = await cashfree.checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: '_modal' });
    return result?.paymentDetails ? 'done' : 'closed';
  }
  return new Promise((resolve) => {
    const razorpay = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: 'DK Badminton Academy',
      description: checkout.description,
      prefill: checkout.prefill,
      handler: () => resolve('done'),
      modal: { ondismiss: () => resolve('closed') },
    });
    razorpay.open();
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After the checkout closes: asks the server to check with the gateway, then keeps reading the
 * record until it stops waiting for payment, for up to two minutes. `base` is e.g. /bookings/<token>.
 */
export async function waitForPayment(base, key, { patient }) {
  let record = (await api(`${base}/check`, { method: 'POST' }))[key];
  for (let i = 0; patient && record.status === 'pending_payment' && i < 40; i += 1) {
    await wait(3000);
    // Every fifth look asks the gateway again, in case its webhook is slow.
    record = i % 5 === 4 ? (await api(`${base}/check`, { method: 'POST' }))[key] : (await api(base))[key];
  }
  return record;
}
