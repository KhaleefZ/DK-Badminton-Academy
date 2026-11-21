# Hosting DK Badminton on Cloudflare (free plan) with a Hostinger domain

Step-by-step notes for putting the website, admin panel and API live on Cloudflare's free plan,
using a domain bought at Hostinger. Replace `yourdomain.in` with the real domain everywhere.

**What ends up where**

| Address | What it is | Code |
|---|---|---|
| `https://yourdomain.in` | Public website (booking, memberships) | `frontend/` |
| `https://www.yourdomain.in` | Redirects to the address above | Cloudflare redirect rule |
| `https://admin.yourdomain.in` | Management app for staff | `management/` |
| `https://api.yourdomain.in` | Backend API, Razorpay webhooks, scheduled jobs | `backend/` |

The domain stays registered (and renewed) at Hostinger. Only its DNS moves to Cloudflare.

---

## 1. Before you start

- A Cloudflare account (free) at dash.cloudflare.com.
- Your Hostinger login (hPanel).
- Node.js installed, and this project checked out.
- **Email check:** if you use Hostinger email (`you@yourdomain.in`), note its MX, SPF and DKIM records
  in hPanel → Domains → DNS. They must exist in Cloudflare too, or that email stops working.
  The app itself sends emails through Gmail, so it needs no DNS records.

## 2. Move the domain's DNS to Cloudflare

1. Cloudflare dashboard → **Add a domain** → enter `yourdomain.in` → choose the **Free** plan.
2. Cloudflare scans the existing DNS records. Check the list:
   - Keep MX, TXT (SPF, DKIM, verification) and any email-related records.
   - **Delete** Hostinger's parking or website records for `yourdomain.in`, `www`, `admin` and `api`
     (usually `A` records pointing at a Hostinger IP, and `CNAME www`). The Workers create their own
     records in step 6, and a deploy fails if a record already exists for that name.
3. Cloudflare shows two nameservers, like `ana.ns.cloudflare.com` and `bob.ns.cloudflare.com`.
4. In Hostinger hPanel → **Domains** → your domain → **DNS / Nameservers** → **Change nameservers**
   → choose custom nameservers → enter the two Cloudflare nameservers → save.
   - If **DNSSEC** is on at Hostinger, turn it off first. Turn it on again later in Cloudflare (step 3).
5. Wait until Cloudflare emails that the domain is **Active**. This usually takes under an hour and can
   take up to 24 hours.

## 3. Certificates and security settings (all free)

Cloudflare issues and renews the HTTPS certificates itself. There is nothing to buy or upload.

- **Edge certificate:** Universal SSL covers `yourdomain.in` and every first-level subdomain
  (`www`, `admin`, `api`). It appears under SSL/TLS → Edge Certificates within minutes of the domain
  going Active.
- **Worker custom domains** (step 6) get their certificates automatically too.

Settings to turn on (domain → **SSL/TLS**):

| Setting | Where | Value |
|---|---|---|
| Encryption mode | SSL/TLS → Overview | **Full (strict)** |
| Always Use HTTPS | SSL/TLS → Edge Certificates | On |
| Automatic HTTPS Rewrites | SSL/TLS → Edge Certificates | On |
| Minimum TLS version | SSL/TLS → Edge Certificates | TLS 1.2 |
| HSTS | SSL/TLS → Edge Certificates | Turn on only after everything works over HTTPS. Start with a max-age of 1 month, without "preload". |
| DNSSEC | DNS → Settings | Enable, then add the DS record it shows at Hostinger (hPanel → DNS → DNSSEC) |

**Leave these off for `api.yourdomain.in`:** "Under Attack" mode, Bot Fight Mode and any challenge
on `/webhooks/payments`. Razorpay is a server, not a browser, and can't pass a challenge. A blocked
webhook means payments only settle through the slower background check.

**`www` redirect:** Rules → **Redirect Rules** → Create → "Redirect from WWW to root" template
(or: when hostname equals `www.yourdomain.in`, redirect dynamically to
`https://yourdomain.in${http.request.uri.path}`, 301, keep the query string).
Add a DNS record so `www` resolves: `AAAA www 100::`, **Proxied** (orange cloud).

## 4. Create the database and storage

From `backend/`:

```sh
npx wrangler login                                  # opens the browser once
npx wrangler d1 create dk-badminton                 # copy the database_id it prints
npx wrangler r2 bucket create dk-badminton-photos   # website photos
npx wrangler r2 bucket create dk-badminton-backups  # weekly database copies (keep private)
```

R2 may ask you to add a payment card the first time you turn it on. The free tier (10 GB) isn't charged.

## 5. Fill in the configuration

**`backend/wrangler.jsonc`**

- `d1_databases[0].database_id`: the id from `d1 create`.
- `routes`: `[{ "pattern": "api.yourdomain.in", "custom_domain": true }]`.
- `vars.ADMIN_ORIGIN`: `https://admin.yourdomain.in`.
- `vars.WEBSITE_ORIGIN`: `https://yourdomain.in`.
- `vars.BACKUP_ACCOUNT_ID`: your account id (dashboard → Workers & Pages → right-hand side, or `npx wrangler whoami`).
- `vars.BACKUP_DATABASE_ID`: the same database id as above.
- Leave `PAYMENT_SIMULATOR` as `"false"`. The API refuses to start in production with it on.

**`frontend/wrangler.jsonc`**: routes `yourdomain.in` (custom domain).
**`management/wrangler.jsonc`**: routes `admin.yourdomain.in` (custom domain).

**`frontend/.env.production`** (create it; it's baked into the build):

```sh
VITE_API_URL=https://api.yourdomain.in
VITE_MANAGEMENT_URL=https://admin.yourdomain.in
```

**`management/.env.production`**:

```sh
VITE_API_URL=https://api.yourdomain.in
VITE_WEBSITE_URL=https://yourdomain.in
```

**Secrets** (stored encrypted by Cloudflare, never in the code). From `backend/`:

```sh
openssl rand -base64 32 | npx wrangler secret put APP_SECRET
npx wrangler secret put BACKUP_API_TOKEN   # paste the token from section 9
```

`APP_SECRET` signs booking links and encrypts saved passwords and keys. Keep a copy in a password
manager. Changing it later breaks existing booking links and the saved Gmail and Razorpay secrets.

## 6. Deploy

```sh
cd backend
npm run db:migrate:remote          # creates the tables in the live database
npm run deploy                     # API on api.yourdomain.in
npm run create-owner -- --remote   # the first Owner login (asks for name, email, password)

cd ../frontend && npm run deploy   # website on yourdomain.in
cd ../management && npm run deploy # admin on admin.yourdomain.in
```

On each first deploy Cloudflare creates the DNS record and certificate for that custom domain.
Check each address in a browser.

To update later, run the same `npm run deploy`. Run `npm run db:migrate:remote` first whenever
`backend/drizzle/` has a new migration file.

## 7. Settings inside the admin panel

Sign in at `https://admin.yourdomain.in` as the Owner, then:

1. **Settings**, venue section: name, address, phone, opening hours, courts, prices.
2. **Settings**, email sender section: the academy's Gmail address and a Gmail **app password**
   (Google account → Security → 2-Step Verification → App passwords). Gmail allows about 500 emails a
   day. The app sends 3 every 2 minutes and stops at the daily limit set there.
3. **Settings**, online payments section: Razorpay keys (section 8).
4. **Website**: check the content, and that the **Cancellation & Refund Policy** page reads correctly.

## 8. Razorpay

1. Sign up at razorpay.com. Test mode works immediately. Live mode needs business KYC, and Razorpay
   reviews the website: it must show the Cancellation & Refund Policy (built in, linked in the footer),
   plus Privacy Policy and Terms & Conditions pages (add these under Website → extra pages), and a
   Contact page with the academy's address and phone.
2. Settings → Payment capture: **Automatic** (the default). The app only counts captured payments.
3. Settings → **Webhooks** → Add:
   - URL: `https://api.yourdomain.in/webhooks/payments`
   - Secret: make up a long random string. You'll paste the same string into the admin panel.
   - Events: `payment.captured` and `order.paid`.
4. API Keys → generate a key (test or live). In the admin panel → Settings → Payments, enter the Key ID,
   Key Secret and webhook secret, choose Test or Live to match, and switch online payments on.
5. Make a test booking with Razorpay's test card or UPI. The booking should show as paid within seconds.
6. Test and Live mode each have their own keys **and their own webhook**. When going live, add the
   webhook again in Live mode.

## 9. Weekly backups to R2 (free)

The API copies the whole database into the `dk-badminton-backups` bucket every **Sunday at 03:00 IST**,
keeps the newest 26 copies (about six months) and deletes older ones. Cloudflare's own point-in-time
restore covers only the last 7 days on the free plan.

**One-time setup:** create an API token for it.

1. Dashboard → My Profile → **API Tokens** → Create Token → **Create Custom Token**.
2. Permissions: **Account → D1 → Edit**. Edit, not Read: an export briefly locks the database, so
   Cloudflare requires write permission.
3. Account resources: your account only. Create, copy the token, then from `backend/`:
   `npx wrangler secret put BACKUP_API_TOKEN` and paste it.
4. Make sure `BACKUP_ACCOUNT_ID` and `BACKUP_DATABASE_ID` are set in `wrangler.jsonc` (section 5), and deploy.

Until all three are set, the job logs "Backup skipped" and does nothing else.

**Checking it works:** after the first Sunday, open R2 → `dk-badminton-backups` → `database/`. You should
see `dk-badminton-YYYY-MM-DD.sql`. Failures show in Workers & Pages → `dk-badminton-api` → Logs, as
"Backup: …".

**Extra copy:** once a month, download the newest file to a drive you control:

```sh
npx wrangler r2 object get dk-badminton-backups/database/dk-badminton-2026-11-22.sql --remote --file dk-backup.sql
```

**Restoring** (into a new database, so nothing is overwritten by mistake):

```sh
npx wrangler d1 create dk-badminton-restored
npx wrangler d1 execute dk-badminton-restored --remote --file dk-backup.sql
# Check the data, then put the new database_id in backend/wrangler.jsonc and deploy.
```

For a mistake in the **last 7 days**, Time Travel is faster:
`npx wrangler d1 time-travel restore dk-badminton --timestamp=<unix time before the mistake>`.

## 10. Staying inside the free plan

| Limit (free plan) | How the app stays inside it |
|---|---|
| 100,000 requests a day | Far more than an academy uses |
| 10 ms CPU per request | Normal requests use a few ms. A login can occasionally run over; retrying works. |
| 50 database queries per request or job run | Tested (`backend/test/step-12-free-plan.test.ts`); the busiest request uses well under 45 |
| 5 million database rows read a day | Indexes on the queries that run all the time (also tested) |
| 5 scheduled jobs | 2 used: every minute (payment checks and emails take turns), Sunday backup |
| 500 MB database, 10 GB R2 | Years of bookings, photos and backups |

**Turn on alerts:** dashboard → **Notifications** → Add → usage-based alerts for D1 (rows read and written)
and Workers (errors). If any limit is reached often, Workers Paid ($5 a month) lifts them all without
code changes.

## 11. Checklist

- [ ] Domain shows **Active** in Cloudflare; email still works
- [ ] SSL/TLS: Full (strict), Always Use HTTPS, TLS 1.2; DNSSEC on
- [ ] `www` redirects to the root domain
- [ ] D1 created and migrated, R2 buckets created
- [ ] `wrangler.jsonc` ids, routes and origins filled in; `.env.production` files created
- [ ] Secrets set: `APP_SECRET`, `BACKUP_API_TOKEN`
- [ ] API, website and admin deployed and reachable over HTTPS
- [ ] Owner account created; venue, prices, Gmail and Razorpay set in the admin panel
- [ ] Razorpay webhook added (Test now, Live again later) and a test payment confirmed
- [ ] Cancellation & Refund Policy reviewed; Privacy Policy and Terms pages added
- [ ] First Sunday backup visible in R2
- [ ] Usage alerts turned on
