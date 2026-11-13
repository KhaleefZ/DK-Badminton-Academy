# DK Badminton to-do

Last updated: 13 Nov 2026. Branch: `cloudflare-port`, not committed yet. Section C code is done (C5–C17); C18–C19 wait for your keys.

**Who does each task:**
- **You** = the academy: accounts, documents, the domain.
- **Dev** = the code.

Nothing in Parts B–D starts until you say so.

Plans behind these tasks:
- [cloudflare-port-plan.md](cloudflare-port-plan.md)
- [payments-plan.md](payments-plan.md)
- [customer-notifications-plan.md](customer-notifications-plan.md)

---

## A. Done so far
- [x] Storage fixes: trimmed audit log, unsaved photos cleared after 24 h
- [x] Port to Cloudflare:
  - D1 database (SQLite), R2 photo storage, cron job for the message queue
  - database triggers for staff limits, last Owner, overlapping bookings, batch capacity, referral limits and overpayment
  - PBKDF2 passwords, worker-mailer for email
- [x] 313 tests pass on local D1, including concurrency tests
- [x] Checked in `wrangler dev`: login, a booking, a refused overlap, a photo upload to R2 and back, the cron job
- [x] Cloudflare config for the website and the admin panel (static files, single-page-app routing)
- [x] Plans written: Cloudflare port, payments, WhatsApp

## B. Go live on Cloudflare (needs the domain)

**You:**
- [ ] B1. Buy the domain on Namecheap; decline their hosting and email add-ons
- [ ] B2. Create a free Cloudflare account and add the domain; set Cloudflare's two nameservers in Namecheap
- [ ] B3. In Cloudflare: SSL "Full (strict)", Always Use HTTPS, DNSSEC on (then add the DS record in Namecheap)
- [ ] B4. Run `npx wrangler login` on the deploy computer

**Dev:**
- [ ] B5. Commit the `cloudflare-port` branch and merge into `main` (only when you say)
- [ ] B6. Create the D1 database and the R2 bucket; put the real database ID into `backend/wrangler.jsonc`
- [ ] B7. Replace the placeholder domains in all three `wrangler.jsonc` files and the two `.env.production` files
- [ ] B8. Set `APP_SECRET` (`wrangler secret put`); apply migrations to the live database (`npm run db:migrate:remote`)
- [ ] B9. Deploy the API, the website and the admin panel
- [ ] B10. Create the Owner on the live database (`npm run create-owner -- --remote`)
- [ ] B11. Smoke checks on the real domain:
  - website pages, including after a refresh
  - login, and the lockout after wrong passwords
  - a booking, and a refused second booking of the same slot
  - a membership and a receipt
  - a photo upload
  - a password-reset email arriving
  - no CPU-limit errors in the Cloudflare dashboard
- [ ] B12. Turn on Cloudflare usage alerts; export the D1 database monthly (`wrangler d1 export`)

## C. Online payments: Cashfree or Razorpay (plan: payments-plan.md)

**You** (can start now, in parallel):
- [ ] C1. Write and publish Terms, Refund & Cancellation, Privacy and Contact pages on the website
- [ ] C2. Sign up with Cashfree as an individual/unregistered business, using the owner's PAN, Aadhaar and savings account
- [ ] C3. Note the account's monthly limit and settlement timing once approved
- [ ] C4. Get the **test (sandbox)** keys, then the **live** keys

**Dev:**
- [x] C5. Migration: payment settings table, gateway order ID, gateway payment ID (unique), refund fields, `online` payment method
- [x] C6. Admin Settings → Online payments: choose gateway, Test/Live, encrypted keys, webhook address shown, "Check connection", On/Off
- [x] C7. One gateway interface plus a fake gateway for tests
- [x] C8. Cashfree adapter (create order, check order, verify webhook, refund)
- [x] C9. Razorpay adapter (same four actions)
- [x] C10. Checkout routes for bookings and memberships; webhook route (raw body, signature check, amount check)
- [x] C11. Confirm-on-payment using the existing "still held?" check; receipt with the gateway reference; duplicate protection
- [x] C12. Late payment: re-hold the slot if it's still free, otherwise refund automatically and alert staff
- [x] C13. Cron sweep that asks the gateway about orders still unconfirmed after 2 minutes
- [x] C14. Admin: "Online" receipts, Refund button, Refunded state, late-payment alerts on Overview
- [x] C15. Website: load the chosen checkout script, Pay button, status polling, result screen, footer policy links
- [x] C16. Remove the `PAYMENT_TEST_MODE` variable (online payment on/off comes from Settings); keep the fake pay button for local development only
- [x] C17. Tests:
  - confirm, duplicate webhook, bad signature, wrong amount
  - late payment re-held or refunded, refund, stale-order sweep
  - signature checks against each gateway's sample payloads
- [ ] C18. Sandbox run with real test keys (**needs C4**)
- [ ] C19. Switch to Live keys and make one real ₹1 test payment, then refund it (**needs C4**)

## D. WhatsApp customer messages (plan: customer-notifications-plan.md)

**You** (can start now, in parallel):
- [ ] D1. Create a Meta Business account
- [ ] D2. Add a WhatsApp account named "DK Badminton Academy" and pick its phone number
- [ ] D3. Add a payment card in Meta for message fees
- [ ] D4. Submit the 6 Utility templates (wording in the plan) and wait for approval
- [ ] D5. Create a **permanent** system-user access token; note the phone number ID

**Dev:**
- [ ] D6. Migration:
  - message template values on messages
  - `notify_whatsapp` on customers and memberships
  - WhatsApp settings in message settings
- [ ] D7. Admin Settings → WhatsApp: phone number ID, encrypted token, "Send test message", On/Off
- [ ] D8. WhatsApp sender (one request to Meta, with plain-words error messages)
- [ ] D9. Booking and membership messages go to WhatsApp instead of email; new payment-receipt message
- [ ] D10. "Resend" and "Remind" buttons resend on WhatsApp; failed messages show the manual WhatsApp link button
- [ ] D11. Website: email field removed from the booking and membership forms; WhatsApp consent checkbox added
- [ ] D12. Admin: WhatsApp toggle on customer and member forms; email kept as optional "for records"; Channel filter on the Messages page
- [ ] D13. Tests:
  - the right template for each event
  - nothing sent without consent
  - retries, then "failed"
  - staff and enquiry emails unchanged
- [ ] D14. Real test message from Settings, then switch on (**needs D1–D5**)

## E. Later, only if needed
- [ ] E1. WhatsApp replies and read receipts in the admin panel (Meta webhook)
- [ ] E2. SMS fallback (₹5,900 DLT registration + an SMS provider)
- [ ] E3. Workers Paid plan ($5 a month) if logins hit the free plan's CPU limit
- [ ] E4. Move settlements to an academy current account when volume grows (a gateway dashboard change, no code)

---

**Suggested order:**
- **Code:** B → C → D, each only when you say.
- **Your side:** C1–C2 and D1–D4 can start right away. Approvals take days, and the code doesn't need them until the final test steps (C18, D14).
