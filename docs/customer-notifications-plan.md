# WhatsApp customer messages plan (simple version)

Status: **plan, not started** (13 Nov 2026). Builds on the `cloudflare-port` branch. Do after [payments-plan.md](payments-plan.md).

Goal: customers get booking, membership and payment messages on **WhatsApp instead of email**. Like payments, it's built so the Owner only pastes keys into the admin panel to switch it on.

**Kept on email:**
- staff password resets;
- staff "new booking / membership" alerts;
- enquiries.

**Left out of version 1, to keep it simple:**
- **SMS:** needs ₹5,900 DLT registration and template paperwork. Add later only if WhatsApp misses too many customers.
- **Reading customer replies in the admin panel:** customers reply in the academy's WhatsApp Business app as usual.
- Read receipts, chatbots, marketing broadcasts.

---

## 1. Setup (done by the academy, outside the code)

| Step | What | Time |
|---|---|---|
| 1 | Create a Meta Business account (business.facebook.com) | 10 min |
| 2 | Add a WhatsApp account with display name "DK Badminton Academy", and add a phone number | 30 min |
| 3 | Add a payment card for message fees | 5 min |
| 4 | Submit the 6 templates below (category **Utility**) | usually approved the same day |
| 5 | Create a **permanent access token**, through a "system user" in Business settings. The temporary token on the getting-started page expires in 24 hours and must not be used | 15 min |

**Phone number:** best is a number not already used on regular WhatsApp. If the academy wants to keep its current WhatsApp Business app number, check Meta's option to share one number between the app and the API at setup time.

**Limits:** a new account can message 250 different people a day. That's plenty, and it rises with verification or use.

## 2. Templates (6, all Utility, factual wording only)

Wording that sounds like an offer is classed as **Marketing** and costs about 7.5 times more, so these stay plain.

| Template | Example text | Button |
|---|---|---|
| `booking_confirmed` | "Hi {{1}}, your court booking {{2}} is confirmed: {{3}}, {{4}}, {{5}}. Amount ₹{{6}}." | View booking → private link |
| `booking_changed` | "Hi {{1}}, booking {{2}} has changed to {{3}}, {{4}}, {{5}}." | View booking |
| `booking_cancelled` | "Hi {{1}}, booking {{2}} on {{3}} has been cancelled." | none |
| `payment_received` | "Hi {{1}}, we received ₹{{2}} for {{3}}. Receipt {{4}}." | none |
| `membership_update` | "Hi {{1}}, your membership {{2}} is {{3}}. Valid {{4}} to {{5}}." ({{3}} = confirmed / renewed / cancelled) | View membership |
| `membership_reminder` | "Hi {{1}}, membership {{2}} ends on {{3}}. Contact the academy to renew." | none |

Each button opens the customer's private page, built from the same link the email uses today. The link is filled in only at send time, so it is never stored.

## 3. Cost

| | Price (Meta India rate card from 1 Oct 2026) |
|---|---|
| Each message above (Utility) | ₹0.115 |
| Example: 40 messages a day | about ₹140 a month |
| Messages customers send the academy | free |
| Provider fee | none: we connect to Meta directly |

## 4. What the Owner does in the admin panel ("only add keys")

**Admin → Settings → WhatsApp:**
1. Paste the **Phone number ID** and **Permanent access token**.
2. Press **Send test message** to their own phone. The `booking_confirmed` template goes out with sample values.
3. Switch **WhatsApp messages: On.**

The token is stored **encrypted**, like the Gmail app password and the payment keys.

## 5. How it works

```
Booking/membership/payment saved
  → a WhatsApp message is queued (template name + values; the private link added only at send time)
  → the every-minute cron sends it to Meta (one web request)
  → sent / failed shown on the Messages page, with the same retries and daily limit as email today
```

**What decides whether a customer gets a message:**
- They need a phone number. Every booking and membership already requires one.
- They must have agreed: on the website, a ticked-by-default "Send booking updates on WhatsApp" box; in admin, a toggle on the customer or member.
- If WhatsApp is off in Settings, or a message fails after its retries: nothing more is sent automatically. The Messages page shows "Failed", and staff use the existing **WhatsApp link** button to message the customer by hand.

## 6. Code changes

### Backend
1. **Migration:**
   - Messages gain `template_params` (JSON).
   - `notify_whatsapp` (yes/no) added on `customers` and `memberships`.
   - WhatsApp settings (phone number ID, encrypted token, on/off) added to `message_settings`.
2. **`src/messages/whatsapp.ts`:**
   - one function, `sendTemplate(to, template, params, buttonLink)`: a single `fetch` to Meta's messages endpoint;
   - Meta errors turned into plain words ("number not on WhatsApp", "template not approved", "token expired").
3. **Queue:**
   - `enqueueBookingMessage` and `enqueueMembershipMessage` queue WhatsApp instead of email.
   - New `enqueuePaymentReceipt`, called after a desk or online payment saves.
   - The cron sends WhatsApp messages next to the staff emails.
4. **Admin actions:** "Resend" (booking) and "Remind" (membership) resend on WhatsApp.
5. **Removed:**
   - the customer-email part of bookings and memberships;
   - the "this customer has no email" errors.

### Website
- Booking and membership forms: **email field removed**; WhatsApp checkbox added.
- The Contact / enquiry form keeps email.

### Admin panel
- **Settings:** a WhatsApp section (section 4).
- **Customer and member forms:**
  - WhatsApp toggle added;
  - email kept as optional "for records".
- **Messages page:**
  - Channel filter (WhatsApp / Email);
  - the existing WhatsApp link button next to any failed message.

### Tests
- A fake WhatsApp sender checks that:
  - each event queues the right template and values;
  - no message goes to a customer who said no;
  - failures retry, then show as failed;
  - staff and enquiry emails are unchanged.
- One real test message from the Settings screen once the Meta account exists.

## 7. Order of work (about 2 days)

| # | Step | Needs the Meta account? |
|---|---|---|
| 1 | Migration, Settings screen, encrypted token | No |
| 2 | WhatsApp sender, queue changes, payment receipt | No (fake sender in tests) |
| 3 | Website and admin form changes; email removed for customers | No |
| 4 | Real test message, then switch on | **Yes** |

## 8. Later, only if needed
- **Customer replies inside the admin panel and read receipts:** Meta webhook, about 1 day.
- **SMS fallback for customers without WhatsApp:** DLT registration at ₹5,900, about 1 day of code.
