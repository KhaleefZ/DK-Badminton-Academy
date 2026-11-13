# Cloudflare port plan

Move DK Badminton from "Node + PostgreSQL" to Cloudflare's free plan only: Workers, D1, R2 and Cron Triggers. The only thing bought is the domain from Namecheap.

Status: **phases 0–5 done on the `cloudflare-port` branch (13 Nov 2026); phase 6 (deploy) waits for the domain.** `main` still runs on Postgres.

What changed from the plan while building:
- **More rules became triggers:** batch capacity (`DK004`), referral code use limits (`DK005`) and overpayment (`DK006`) are enforced by triggers, alongside the staff, Owner and overlap rules.
- **`phone_digits` is a generated column,** worked out by the database from `phone`, so it can't go stale.
- **Writes that must save together collect in a `Work` object** ([client.ts](../backend/src/db/client.ts)) and commit as one D1 batch. Emails and referral credit run after the commit.
- **Conditional changes** ("only if still unvoided / still held / same version") use `auditIfChanged` and `previousChanged`, so a refused change leaves no audit row.
- **Drizzle's D1 `batch()` can't run a raw `db.run(sql…)` with parameters.** Builder queries are used instead.
- **Checked so far:** 313 tests pass on local D1, including 3 concurrency tests. Under `wrangler dev` with `--test-scheduled`, these worked: login, a booking, a refused overlapping booking, phone search, a photo upload to R2 that reads back byte-for-byte, and the cron. API bundle: 517 KB gzip.

---

## 1. Target setup

| Part | Runs on | Address |
|---|---|---|
| Public website (Vite build) | Worker with static assets | `yourdomain.in`, `www.yourdomain.in` |
| Admin panel (Vite build) | Worker with static assets | `admin.yourdomain.in` |
| API (Express) | Worker using `nodejs_compat` and `httpServerHandler` | `api.yourdomain.in` |
| Database | D1, which is SQLite | binding `DB` |
| Uploaded photos | R2 bucket | binding `PHOTOS`, served through `api…/public/images/:id` |
| Message queue | Cron Trigger every minute on the API Worker | none |
| Rate limits | Workers rate-limit bindings | none |

Free-plan limits that matter:
- **Workers:** 100k requests a day (requests for static files are free and unlimited) and 10 ms of CPU per request.
- **D1:** 500 MB per database, 100k row writes and 5M row reads a day, 7-day point-in-time restore.
- **R2:** 10 GB.
- **Cron:** 5 triggers.

Your usage is a few hundred writes a day.

Cloudflare now recommends Workers with static assets over Pages for new sites, so all three parts are Workers.

## 2. Decisions

1. **Keep Express. Do not rewrite to Hono.** Cloudflare runs Express directly through `httpServerHandler` from `cloudflare:node`. That keeps the 18 route files and the supertest test suite (275 tests) almost unchanged. The work goes into the database layer, not the web framework.
2. **D1, not a Durable Object database.** D1 has a dashboard SQL console, `wrangler d1 export`, and 7-day Time Travel restore. The owner can look at member data without code.
   - The cost: D1 cannot hold a transaction open. Section 4 covers how each of the 67 transactions is replaced.
   - Fallback if that proves too risky: run the whole API inside one SQLite-backed Durable Object, which has real transactions.
3. **Database rules stay in the database.** SQLite triggers replace the Postgres ones, including the booking-overlap rule. D1 runs one write at a time, so a trigger check cannot race. This keeps the "no double booking" guarantee as strong as it is today.
4. **Tests run against real D1 locally.** Vitest stays on Node and gets a D1 binding from wrangler's `getPlatformProxy()`, which uses the same SQLite engine as production. A small smoke suite uses wrangler's `createTestHarness` to exercise the real Worker entry and the cron handler.
5. **Fresh database.** This assumes nothing is live yet. If there is data to keep, add the export step in Phase 6.

## 3. PostgreSQL features in use and their replacements

| Postgres feature (where) | SQLite / D1 replacement |
|---|---|
| `uuid` with `gen_random_uuid()` (every table) | `text` primary key with `$defaultFn(() => crypto.randomUUID())`. IDs are made in JS, so batched statements can refer to them |
| `timestamptz` | `integer` with `{ mode: 'timestamp_ms' }`. Time-zone maths is already done in JS ([time.ts](../backend/src/lib/time.ts)), so no SQL depends on it |
| `date` with `mode: 'string'` | `text` holding `YYYY-MM-DD`, which sorts and compares the same way |
| `jsonb` (audit log, site content) | `text` with `{ mode: 'json' }` |
| `integer[]` / `text[]` (5 columns: price-rule days, batch days, plan features…) | `text` with `{ mode: 'json' }` |
| `bigserial` (audit log id) | `integer primary key autoincrement` |
| 15 `pgEnum`s | `text` with `{ enum: [...] }` plus a `CHECK (col IN (...))` |
| 8 sequences with `dk_number()` (STF-, BKG-, RCP-, WLK-, WEB-, ENQ-, MEM-, CRT-) | `counters(name, value)` table. Each insert batch first runs `UPDATE counters SET value = value + 1 WHERE name = ?`, then the insert reads `printf('BKG-%05d', value)` from it in the same batch, so numbers are never reused |
| `EXCLUDE USING gist` no-overlap rule on `court_reservations` | `BEFORE INSERT` and `BEFORE UPDATE` triggers that `RAISE(ABORT, 'DK003')` when an active reservation on the same court overlaps |
| `enforce_staff_limit()` / `protect_last_owner()` triggers | The same logic as SQLite triggers, raising `DK001` / `DK002` |
| `num_nonnulls(a, b) = 1` (payments) | `CHECK ((a IS NOT NULL) + (b IS NOT NULL) = 1)` |
| Unique indexes on `lower(email)` / `lower(name)`, some partial | Supported by SQLite as written |
| `ILIKE` (9 searches) | `LIKE`. SQLite ignores case for A–Z only; names in Tamil or other scripts match case-sensitively, which is acceptable |
| `regexp_replace(phone, '[^0-9]', '')` (3 member and customer lookups) | New `phone_digits` column, filled in JS on every write; lookups use it |
| `count(*)::int`, `'{}'::text[]`, `make_interval`, `now()` | Plain `count(*)`; `'[]'`; times calculated in JS and passed as parameters |
| `FOR UPDATE SKIP LOCKED` (message queue claim) | One statement: `UPDATE messages SET status='sending' … WHERE id IN (SELECT id … LIMIT ?) RETURNING *` |
| `bytea` photo data | R2 object; the `site_images` row keeps id, type, size and date only |
| Postgres error codes 23505 / 23503 / 23P01 / DK00x ([client.ts](../backend/src/db/client.ts)) | `dbErrorCode()` reads D1's error text instead: `UNIQUE constraint failed`, `FOREIGN KEY constraint failed`, and `DK00x` from `RAISE`. The user-facing messages in `app.ts` stay the same |

Migrations: delete `drizzle/0000–0007`. Generate a single SQLite `0000_init.sql` with drizzle-kit (`dialect: 'sqlite'`, `driver: 'd1-http'`). Add a hand-written `0001_rules.sql` for the triggers and the `counters` rows. Apply with `wrangler d1 migrations apply`.

## 4. Replacing transactions (the main work)

D1 offers `db.batch([...])`: several statements that all succeed or all roll back, but no code can run between them. There are 67 `db.transaction` calls and 12 `FOR UPDATE` row locks. Each one is sorted into one of four patterns:

| Pattern | When | Replacement |
|---|---|---|
| **A. Just atomic** | Several writes with no decision in between, such as change plus audit row | `db.batch([write, writeAudit])`. `writeAudit` returns a statement instead of running it |
| **B. Check, then write** | Read a row, check its status or version, then update (all 12 `FOR UPDATE` uses) | A conditional write: `UPDATE … WHERE id = ? AND version = ?` (or `AND status = 'active'`) `RETURNING`. Zero rows returned means a 409 with today's message |
| **C. Capacity or overlap** | Booking slots, member-batch capacity, referral-code use | Trigger, or `INSERT … SELECT … WHERE (SELECT count(*) …) < capacity`. The rule lives in the statement, so it cannot race |
| **D. Needs a new number or id** | Booking, receipt, member, enquiry, staff numbers | IDs made in JS; numbers from `counters` inside the same batch (see section 3) |

Transactions per file, so each can be ported and tested on its own:

| File | Transactions | Row locks | Notes |
|---|---|---|---|
| [memberships.ts](../backend/src/routes/memberships.ts) | 16 | 3 | Hardest: batches, capacity, periods, payments |
| [settings.ts](../backend/src/routes/settings.ts) | 10 | – | Mostly pattern A (replace hours, prices, courts) |
| [staff.ts](../backend/src/routes/staff.ts) | 7 | – | Covered by staff triggers |
| [bookings.ts](../backend/src/routes/bookings.ts) | 6 | 1 | Overlap trigger plus booking number |
| [customers.ts](../backend/src/routes/customers.ts), [referrals.ts](../backend/src/routes/referrals.ts), [public.ts](../backend/src/routes/public.ts) | 4 each | 0 / 1 / 2 | `public.ts` holds and confirms website bookings |
| [passwords.ts](../backend/src/auth/passwords.ts), [blocks.ts](../backend/src/routes/blocks.ts), [publicMemberships.ts](../backend/src/routes/publicMemberships.ts) | 3 each | – / – / 2 | |
| [enquiries.ts](../backend/src/routes/enquiries.ts) | 2 | – | |
| [siteContent.ts](../backend/src/routes/siteContent.ts), [payments.ts](../backend/src/routes/payments.ts), [messages.ts](../backend/src/routes/messages.ts), [queue.ts](../backend/src/messages/queue.ts) | 1 each | 1 / 1 / – / SKIP LOCKED | site content already has a `version` column (pattern B) |
| [service.ts](../backend/src/memberships/service.ts), [referrals.ts](../backend/src/memberships/referrals.ts) (shared helpers) | – | 1 each | Take a list of statements to add to the caller's batch, instead of a `tx` |

`DbOrTx` is removed. Helpers that took `conn` either return statements for the caller's batch or run on `db` when no atomicity is needed.

## 5. Runtime changes outside the database

| Today | Change | File |
|---|---|---|
| `@node-rs/argon2`, a native binary | PBKDF2-SHA256 through WebCrypto, 100,000 iterations (the Workers maximum), stored as `pbkdf2$100000$salt$hash`. The decoy hash is created on first use, because Workers forbid random values at load time | [crypto.ts](../backend/src/auth/crypto.ts) |
| `nodemailer` through Gmail | `worker-mailer` (SMTP over `cloudflare:sockets`, Gmail port 587 with STARTTLS) using the saved Gmail app password. `friendlyMailError` updated for its error shapes | [email.ts](../backend/src/lib/email.ts), [queue.ts](../backend/src/messages/queue.ts) |
| `setInterval` worker in `server.ts` | `scheduled()` handler with cron `* * * * *` that calls `processMessages()`, which already handles being run from several places | new `worker.ts` |
| `express-rate-limit`, kept in memory, 5-minute windows | Rate-limit bindings (window must be 10 s or 60 s; counted per data centre, approximate). Limits rescaled: login 10/min, reset 2/min, public writes 4/min, keyed on `CF-Connecting-IP`. The database-backed login lockout stays the main defence | [app.ts](../backend/src/app.ts) |
| `trust proxy` / `TRUST_PROXY_HOPS` | Removed; the client IP comes from `CF-Connecting-IP` | [app.ts](../backend/src/app.ts), [config.ts](../backend/src/config.ts) |
| `pg.Pool` with `drizzle-orm/node-postgres` | `drizzle(env.DB)` from `drizzle-orm/d1`; `env` imported from `cloudflare:workers` | [client.ts](../backend/src/db/client.ts) |
| `dotenv`, `server.ts`, `listen()`, `SIGTERM` handling | Worker entry: `app.listen(3000)` with `export default { fetch: httpServerHandler({ port: 3000 }).fetch, scheduled }`. Secrets go in `wrangler secret`, local values in `.dev.vars` | new `worker.ts` |
| `node:crypto` (`createHash`, `createHmac`, `randomBytes`, AES-GCM) | No change; `nodejs_compat` supports these | – |
| `helmet`, `cors`, `cookie-parser`, `zod` | No change | – |
| Photo bytes in Postgres | `PUT` to R2 key `photos/<id>`; `GET /public/images/:id` streams from R2 with the same headers, so the website and admin code don't change. Clean-up on save and on upload (added 13 Nov) deletes the R2 object as well as the row | [siteContent.ts](../backend/src/routes/siteContent.ts), [public.ts](../backend/src/routes/public.ts) |
| Scripts: `create-owner`, `seed-demo`, `migrate` | `migrate` becomes `wrangler d1 migrations apply`. The other two run in Node with `getPlatformProxy({ remoteBindings: true })` so they write to the real D1 | [scripts/](../backend/src/scripts) |

`wrangler.jsonc` for the API (outline):

```jsonc
{
  "name": "dk-badminton-api",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-13",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "api.yourdomain.in", "custom_domain": true }],
  "d1_databases": [{ "binding": "DB", "database_name": "dk-badminton", "database_id": "…", "migrations_dir": "drizzle" }],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "dk-badminton-photos" }],
  "triggers": { "crons": ["* * * * *"] },
  "ratelimits": [
    { "name": "LOGIN_LIMIT", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
    { "name": "RESET_LIMIT", "namespace_id": "1002", "simple": { "limit": 2, "period": 60 } },
    { "name": "PUBLIC_WRITE_LIMIT", "namespace_id": "1003", "simple": { "limit": 4, "period": 60 } }
  ],
  "vars": { "NODE_ENV": "production", "PAYMENT_TEST_MODE": "false", "ADMIN_ORIGIN": "https://admin.yourdomain.in", "WEBSITE_ORIGIN": "https://yourdomain.in" },
  "observability": { "enabled": true }
}
```

Secrets: `APP_SECRET`.

Frontends: each gets a small `wrangler.jsonc` with `assets.directory: "./dist"` and `not_found_handling: "single-page-application"`. They are built with:
- website: `VITE_API_URL`, `VITE_MANAGEMENT_URL`
- admin: `VITE_API_URL`, `VITE_WEBSITE_URL`

No source changes in either React app.

## 6. Phases

Each phase ends with something that runs and passes tests.

| # | Phase | Work | Done when | Days |
|---|---|---|---|---|
| 0 | Setup | Branch; add wrangler and drizzle D1 driver; `getPlatformProxy` test setup. Replace `TRUNCATE` in `test/setup.ts` with per-table `DELETE` plus `counters` reset | Vitest starts on an empty local D1 | 0.5 |
| 1 | Schema | Rewrite `schema.ts` for SQLite (section 3); generate `0000_init.sql`; write `0001_rules.sql` triggers; rewrite `phase-a-database.test.ts` (staff limit, last owner, numbers never reused, email case) | Database-rule tests pass, including a new **overlapping-booking trigger** test | 1 |
| 2 | Auth and runtime | PBKDF2; `dbErrorCode` from D1 messages; worker entry, cron and rate-limit bindings; replace `ILIKE`, `regexp_replace` and `count::int` | Login, logout, password and staff suites pass | 0.5–1 |
| 3 | Transactions, simple files | settings, staff, customers, enquiries, payments, messages, siteContent, passwords, blocks | Those suites pass | 1 |
| 4 | Transactions, hard files | bookings, public bookings, memberships, public memberships, referrals, message-queue claim. Add a test that fires 10 parallel bookings for one slot and expects exactly 1 to succeed | All 275+ tests pass on D1 | 1.5–2 |
| 5 | Photos and email | R2 upload, serve and clean-up; `worker-mailer`; `wrangler dev` check that a reset email arrives in Gmail | Photo tests pass on R2; a real email arrives | 0.5 |
| 6 | Deploy | Namecheap → Cloudflare nameservers; create D1 and R2; set secrets; apply migrations; deploy 3 Workers; run create-owner. (If old data must be kept: `pg_dump --data-only --inserts` turned into SQLite inserts and loaded with `wrangler d1 execute`) | Smoke checklist below passes on the real domain | 0.5 |

**Total: about 5–6 working days.**

## 7. Domain and DNS (Namecheap)

1. Buy the domain on Namecheap and decline their hosting, email and "PremiumDNS" add-ons.
2. In Cloudflare: Add a domain → Free plan → copy the two nameservers.
3. In Namecheap: Domain → Nameservers → Custom DNS → paste the two nameservers. The switch can take up to 24 hours.
4. In Cloudflare: SSL/TLS mode **Full (strict)**, Always Use HTTPS on, DNSSEC on (then add the DS record in Namecheap's Advanced DNS).
5. Custom domains are attached by the Workers themselves (`routes … custom_domain: true`), so no manual DNS records are needed for the site, admin or API.
6. Optional: free Email Routing to forward `contact@yourdomain.in` to Gmail.

## 8. Smoke checklist after deploy

- Website loads on `yourdomain.in` and `www`, and deep links such as `/pricing` work after a refresh
- Admin login works, and a wrong password 5 times locks the account
- Book a court from the website, and booking the same slot again is refused
- Create a membership, record a payment, and a receipt number appears
- Upload a website photo, it shows on the site, and removing it deletes it
- The password-reset email arrives in Gmail within 1–2 minutes
- In the Cloudflare dashboard: D1 row metrics are far below 100k writes a day, and Workers show no `exceededCpu`

## 9. Risks and what we do about them

| Risk | Likelihood | Handling |
|---|---|---|
| Login uses more than 10 ms of CPU (PBKDF2 at 100k iterations takes about 30–50 ms) | Medium | Cloudflare tolerates occasional overruns, and logins are rare (3 staff). If `exceededCpu` appears in logs: Workers Paid at $5 a month, with no code change |
| A missed race when a transaction is split | Medium | Rules enforced by triggers and conditional statements, not JS checks; parallel-request tests in Phase 4 |
| D1 daily free limit reached (queries fail until 05:30 IST) | Very low | Indexes on every lookup column; usage alert email; Paid plan lifts it instantly |
| `worker-mailer` and Gmail SMTP don't work together | Low | Fall back to the Resend HTTP API (free 3,000 emails a month) behind the same `Mailer` interface |
| Express on Workers has an edge-case gap | Low | Full suite and `createTestHarness` smoke run against real `workerd` before deploy |
| Tied to Cloudflare | Accepted | `wrangler d1 export` produces plain SQL, so moving to SQLite or Turso elsewhere is easy |

## 10. Not changing

- React website and admin source code, except build-time env values
- API routes, request and response shapes, error messages and permissions
- The website-content editor and photo shrinking in the browser
- Venue time handling ([time.ts](../backend/src/lib/time.ts)) is already done in JS
