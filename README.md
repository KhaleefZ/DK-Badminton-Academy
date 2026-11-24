# DK Badminton Academy

Public website, staff admin panel and API for **DK Badminton Academy** (Selvapuram North, Coimbatore).

| Folder | What it is | Dev URL |
| --- | --- | --- |
| `frontend/` | Public website: courts, pricing, online court booking, memberships, contact | http://localhost:5173 |
| `management/` | Staff admin panel: schedule, bookings, customers, memberships, payments, reports, website editor, settings | http://localhost:5174 |
| `backend/` | API: Node.js, TypeScript, Express, Drizzle, PostgreSQL | http://localhost:4000 |

**Stack:** React 18, React Router 6, Vite 6 and plain CSS on the frontends; Express, Drizzle ORM and PostgreSQL on the backend.

> **Not launch-ready yet.** Payments run in test mode, and some venue content is still placeholder. See [Before launch](#before-launch).

---

## Requirements

- Node.js 18 or newer, and npm
- PostgreSQL running locally (`brew install postgresql@16 && brew services start postgresql@16`)
- Free ports: 4000, 5173 and 5174

## First-time setup

```bash
# Database
createdb dk_badminton

# Backend
cd backend
npm install
cp .env.example .env
npm run db:migrate
npm run create-owner     # asks for the Owner's name, email and password
npm run seed-demo        # optional: demo hours, prices and plans so booking can be tried
cd ..

# Website and admin panel
cd frontend   && npm install && cp .env.example .env && cd ..
cd management && npm install && cp .env.example .env && cd ..
```

The default `.env` values work for local development as they are.

## Run

Open three terminals in VS Code (`` Ctrl + ` ``, then the **+** button) and start the API first:

```bash
# Terminal 1: API
cd backend && npm run dev

# Terminal 2: public website
cd frontend && npm run dev

# Terminal 3: admin panel
cd management && npm run dev
```

Sign in to the admin panel with the Owner account from `create-owner`. Nothing can be booked until opening hours and prices are set under **Settings**, or until you've run `seed-demo`.

After pulling new changes, run `npm install` in any app whose `package.json` changed, and `npm run db:migrate` in `backend/`.

### Stop

Press **Ctrl + C** in each terminal. If a port is still taken:

```bash
lsof -ti tcp:4000,5173,5174 | xargs kill
```

## Scripts

| Where | Command | What it does |
| --- | --- | --- |
| all | `npm run dev` | Dev server with reload |
| frontend, management | `npm run build` / `npm run preview` | Production build into `dist/`, then serve it locally (ports 4173 / 4174) |
| backend | `npm run db:migrate` | Apply database migrations |
| backend | `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| backend | `npm run create-owner` | Create an Owner account |
| backend | `npm run seed-demo` | Add demo hours, prices and plans (refuses to run in production) |
| backend | `npm test` | Tests; needs `createdb dk_badminton_test` once (the tests empty it) |
| backend | `npm run typecheck` | TypeScript check |

## Environment variables

Each app has a `.env.example`. Restart the dev server after changing `.env`.

| App | Variable | Default | Purpose |
| --- | --- | --- | --- |
| backend | `DATABASE_URL` | `postgresql://localhost:5432/dk_badminton` | Database |
| backend | `ADMIN_ORIGIN` / `WEBSITE_ORIGIN` | `:5174` / `:5173` | Only these sites may call the API |
| backend | `PAYMENT_TEST_MODE` | `true` | Confirms bookings with a simulated payment; the API refuses to start with it on in production |
| backend | `APP_SECRET` | unset | Required in production (`openssl rand -base64 48`) |
| backend | `TRUST_PROXY_HOPS` | `0` | Number of proxies in front of the API once hosted |
| frontend, management | `VITE_API_URL` | `http://localhost:4000` | API address |
| frontend | `VITE_MANAGEMENT_URL` | `http://localhost:5174` | "Staff login" link in the footer |
| management | `VITE_WEBSITE_URL` | `http://localhost:5173` | "View website" link in the account menu |

The email sender (Gmail address and app password) and the WhatsApp number are set in the admin panel under **Settings**, not in `.env`. Until a sender is saved, development prints emails to the API terminal.

## Where things live

| Topic | Location |
| --- | --- |
| Website pages | `frontend/src/pages/` (incl. `booking/`, membership and `/p/<address>` custom pages) |
| Website text, photos and sections | Edited in the admin panel under **Website**. Defaults: `backend/src/site/defaults.json`, mirrored in `frontend/src/data/siteDefaults.json` (a test fails if they differ) |
| Admin panel pages | `management/src/pages/` |
| API routes | `backend/src/routes/` |
| Database schema / migrations | `backend/src/db/schema.ts`, `backend/drizzle/` |
| Login rules and roles | `backend/src/auth/policy.ts`, `backend/src/auth/permissions.ts` |
| Availability and double-booking protection | `backend/src/schedule/` |
| Memberships (and member credit) | `backend/src/memberships/` |
| Email queue | `backend/src/messages/queue.ts` |
| Design tokens | `src/styles/tokens.css` in each frontend |
| Website motion plans | `docs/motion-plan.md`, `docs/motion-plan-v2-additions.md` |

## Deploy

- **frontend / management:** `npm run build` makes a static `dist/`. Host each on its own domain or subdomain and rewrite unknown paths to `index.html` (Vercel and Netlify do this; on Nginx use `try_files $uri /index.html`). Set the `VITE_*` variables at build time.
- **backend:** needs a normal Node.js host with PostgreSQL. Password hashing (Argon2id) is too heavy for the free Cloudflare Workers tier. Serve the API and admin panel over HTTPS on the same domain.

## Before launch

| Item | What to do |
| --- | --- |
| Payments | Connect a payment gateway and set `PAYMENT_TEST_MODE=false`. Online booking is closed until then |
| Hours, prices, courts | Enter the real values in the admin panel under **Settings**, and remove any `seed-demo` data |
| Venue content and reviews | Replace placeholder text and the sample reviews in the admin panel under **Website** |
| Photos | Replace the AI concept imagery with real venue photos (admin panel → **Website**) |
| Email | Save the production Gmail sender under **Settings** |
| Hosting | Choose a host, then set `APP_SECRET`, `TRUST_PROXY_HOPS` and the production origins and URLs |
