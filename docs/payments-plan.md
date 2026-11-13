# Online payments plan: Cashfree or Razorpay, keys only

Status: **built (13 Nov 2026), waiting for keys.** Steps 1–5 are done on `cloudflare-port`; step 6 (sandbox and live check) needs the approved account.

What was built, and where it differs from the plan:
- **Code:** gateway interface in [gateway.ts](../backend/src/payments/gateway.ts), with [cashfree.ts](../backend/src/payments/cashfree.ts) and [razorpay.ts](../backend/src/payments/razorpay.ts) (plain `fetch`, no SDK). Settling, refunds and the cron sweep are in [settle.ts](../backend/src/payments/settle.ts).
- **"Check connection" creates nothing.** It asks the gateway for an order that can't exist (Cashfree) or lists orders (Razorpay), so working keys answer and wrong keys get 401. Online payments can't be switched on until this passes.
- **The money is recorded first,** once only (the gateway payment ID is unique). Only then is the booking confirmed. A late payment whose slot or batch seat was taken, a cancelled booking, or a second payment is refunded automatically and listed under Payments → Needs attention. If the refund itself fails, staff are told to refund from the dashboard.
- **Refunds:** a refunded receipt is also voided, so every existing total leaves it out. Online receipts can't be voided, only refunded.
- **`PAYMENT_TEST_MODE` is replaced by `PAYMENT_SIMULATOR`,** for local development only; production refuses to start with it on.
- **Rate limit:** the public write limit is raised to 10 a minute, because a real payment uses three requests (hold, checkout, check).
- **Checked so far:** 333 tests pass, 20 of them on payments. Under `wrangler dev`, Cashfree's and Razorpay's real servers refused fake keys, and a signed webhook was accepted while a forged one was refused.

Goal: build online payment once, for **both** Cashfree and Razorpay. When the academy's account is approved, the Owner pastes the keys into the admin panel and switches payments on. No code change and no redeploy.

---

## 1. Account (done by the academy, outside the code)

Both gateways accept an **individual / unregistered business** that is paid into a **personal savings account**:

| Needed | Notes |
|---|---|
| Owner's personal PAN and Aadhaar | The person who runs the academy, not staff or a developer |
| Savings account in the same name | Settlements land here |
| Live website with Terms, Refund & Cancellation, Privacy and Contact pages | Gateways check these before approving; create them with the site's custom pages |
| No GST or company needed | Unregistered accounts may have lower monthly limits; check the limit when signing up |

**Which gateway** (fees checked 13 Nov 2026):

| | Cashfree | Razorpay |
|---|---|---|
| Fee now | 0% platform fee up to ₹20 lakh, until 31 Mar 2027 (sign-ups after 21 Jul 2026) | 0% for 90 days or ₹5 lakh, whichever comes first; then 2% + GST (2.36%), UPI included |
| Recommendation | **Start here** | Keep as the switch-over option |

Separately, a UPI payment over ₹2,000 from a bank account may carry a 0.4% bank charge (MDR), capped at ₹300, from 15 Oct 2026. This applies with either gateway. Court bookings are under ₹2,000; memberships may not be.

---

## 2. What the Owner does once the account is approved ("only add keys")

In **Admin → Settings → Online payments**:
1. Choose the gateway: **Cashfree** or **Razorpay**.
2. Choose the mode: **Test (sandbox)** or **Live**.
3. Paste the keys:
   - **Cashfree:** App ID (Client ID) and Secret key.
   - **Razorpay:** Key ID, Key Secret, and a Webhook secret (made up when creating the webhook).
4. Copy the **webhook address** the page shows, e.g. `https://api.<domain>/webhooks/payments`, into the gateway's dashboard. Then pick the events (Cashfree: payment success and failed; Razorpay: `payment.captured`, `payment.failed`, `refund.processed`).
5. Press **Check connection.** The panel creates and cancels a ₹1 test order, so a wrong key shows up straight away.
6. Switch **Online payments: On.** The website starts taking bookings and memberships online.

Keys are stored **encrypted** in the database with the existing `APP_SECRET`, the same way as the saved Gmail app password. They are never sent back to the browser; the panel only shows "saved".

---

## 3. How a payment works

```
Customer picks a slot or plan
  → API holds it for 10 min (pending_payment)                  [already built]
  → API creates a gateway order for the amount in the database (never the browser's)
  → Website opens the gateway's checkout (UPI / card / net banking / wallet)
  → Customer pays
  → Gateway sends a webhook → API checks the signature → confirms the booking, records the receipt,
    queues the confirmation (email now, WhatsApp later)
  → Website polls the booking status and shows "Confirmed"
```

**What confirms a booking:** only one of these two:
- a **signed webhook** from the gateway;
- the API **asking the gateway directly** for the order's status.

What the browser reports is never trusted. If the customer closes the tab after paying, the booking is still confirmed.

**Safety net:** the every-minute cron (already running) asks the gateway about any order still unconfirmed after 2 minutes. A webhook that never arrives costs at most a minute or two.

---

## 4. Situations that must be handled

| Situation | What happens |
|---|---|
| Customer clicks Pay twice, or the gateway sends the same webhook twice | The gateway's payment ID is unique on receipts, so the second is ignored |
| Payment fails or the customer closes checkout | Booking stays held until its 10 minutes run out; they can try again |
| Payment arrives **after** the 10-minute hold ended | If the slot is still free: re-hold it and confirm. If someone else took it: **refund automatically** through the gateway, record "Refunded: slot no longer free", and alert staff |
| Staff cancel a paid online booking | A **Refund** button on the receipt sends the refund through the gateway; the receipt is marked refunded, not voided |
| Gateway is down or keys are wrong | The website says online payment is unavailable and shows the academy's phone/WhatsApp; nothing is held |
| Someone fakes a webhook | Refused: bad signature (Cashfree: HMAC-SHA256 of timestamp + raw body with the secret key; Razorpay: HMAC-SHA256 of the raw body with the webhook secret) |
| Amount tampered with in the browser | Impossible: the order amount comes from the database, and the webhook amount is checked against it |

---

## 5. Code changes

### Backend (`backend/`)
1. **Database (one new migration):**
   - `payment_settings` table, single row: provider, mode, encrypted keys, on/off.
   - On `bookings` and `memberships`: `gateway_order_id`.
   - On `payments`:
     - `gateway_payment_id`, unique, for duplicate protection;
     - `refunded_at`, `refund_reason`, `gateway_refund_id`.
   - Payment method list: `online` added, `online_test` kept for local development.
2. **One gateway interface,** `src/payments/gateway.ts`, with two small adapters (`cashfree.ts`, `razorpay.ts`). Each is plain `fetch` calls, no SDK, so they run on Workers:
   - `createOrder(ref, amountPaise, customer)` → `{ orderId, checkoutData }`
   - `fetchOrder(orderId)` → paid / pending / failed, plus the payment ID and amount
   - `verifyWebhook(headers, rawBody)` → `{ orderId, paymentId, amountPaise, status }` or "reject"
   - `refund(paymentId, amountPaise, reason)` → refund ID
3. **Routes:**
   - `POST /public/bookings/:token/checkout` and `/public/memberships/:token/checkout`: create the order and return what the checkout needs.
   - `GET /public/bookings/:token` (exists): the website polls this.
   - `POST /webhooks/payments`:
     - reads the **raw body**, mounted before `express.json`;
     - skips the website-origin check, because the gateway calls it, not a browser;
     - checks the signature, then confirms.
   - `POST /bookings/:id/payments/:paymentId/refund` (admin, `payments.void` permission).
   - Settings: `GET/PUT /settings/payments` and `POST /settings/payments/check` (Owner only, password re-confirmed like other sensitive settings).
4. **Confirming** reuses the test-mode code that exists today: a one-statement "still held?" update, then a receipt and messages after it. Test mode's fake "pay" button stays for local development only.
5. **Cron:** add the "ask the gateway about stale orders" sweep next to the message queue.
6. **Remove the `PAYMENT_TEST_MODE` variable.** Whether online payment is on now comes from Settings. Production can't use the fake button.

### Website (`frontend/`)
- Load the gateway's checkout script, only the chosen one:
  - Cashfree: `sdk.cashfree.com/js/v3/cashfree.js`;
  - Razorpay: `checkout.razorpay.com/v1/checkout.js`.
- On "Pay", call `/checkout`, open the gateway checkout with what came back, then poll status every 2 seconds for up to 2 minutes and show Confirmed / Failed / "We're checking your payment".
- Booking and membership pages show "Paid online" with the gateway reference.
- Footer links to the policy pages the gateway requires.

### Admin (`management/`)
- **Settings → Online payments** (section 2 above).
- **Receipts:** "Online" with the gateway reference; a **Refund** button; a "Refunded" state.
- **Overview:** a small alert list showing "Paid after the slot was taken: refunded".

### Tests
- A **fake gateway adapter** covers every flow: confirm, duplicate webhook, bad signature, wrong amount, late payment that is re-held or refunded, refund, and the stale-order sweep.
- Both real adapters' signature checks are tested against the sample payloads from each gateway's docs.
- **Sandbox run** with real test keys before going live (needs the account).

---

## 6. Order of work (about 3 days, all doable before the account exists)

| # | Step |
|---|---|
| 1 | Migration, settings storage, Settings screen with "Check connection" |
| 2 | Gateway interface, fake adapter, checkout/webhook/confirm/refund using the fake |
| 3 | Cashfree adapter and Razorpay adapter (signature checks tested on doc samples) |
| 4 | Website checkout and status polling; admin refund and receipts |
| 5 | Stale-order sweep and late-payment refund |
| 6 | Sandbox run with real test keys, then switch to Live (**needs the approved account**) |

## 7. Facts to re-check when building
- **Cashfree:** current `x-api-version` value and webhook event names (the docs list a "latest" version).
- **Razorpay:** webhook event list for the account.
- **The unregistered account's monthly limit,** once approved.
