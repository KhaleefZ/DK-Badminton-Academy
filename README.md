# DK Badminton Academy

Website and management workspace for **DK Badminton Academy** (Selvapuram North, Coimbatore), built in React from the Figma file **DK-Badminton** (`WAHyI0hBfuJBPdt2WDGnTm`). It is two independent apps:

| Folder | What it is | Figma pages | Dev URL | Preview URL |
| --- | --- | --- | --- | --- |
| `frontend/` | Public website + live court booking | 03–05 Website & Booking | http://localhost:5173 | http://localhost:4173 |
| `management/` | Academy management workspace (DK Operations), behind a staff login | 06–08 Admin Management | http://localhost:5174 | http://localhost:4174 |
| `backend/` | API (Node.js, TypeScript, Express, Drizzle, PostgreSQL). Admin login and staff so far | n/a | http://localhost:4000 | n/a |

**Stack:** React 18, React Router 6 (v7 future flags on), Vite 6, plain CSS with design tokens, `lucide-react` icons (the set the Figma file uses), and `motion` 12 (Framer Motion) for animation. The backend currently handles admin login and staff accounts. Everything else in both apps still runs on local sample data in the browser.

> **Status: design concept, not launch-ready.** Venue facts, prices and reviews are placeholders or samples, the photography is AI-generated concept imagery, and booking doesn't reserve anything. See [Before launch](#before-launch).

---

## Requirements

- **Node.js 18 or newer** (developed on Node 25) and npm.
- Ports **5173** and **5174** free for development (4173/4174 for preview). The dev servers use the ports fixed in each `vite.config.js`; if a port is busy, Vite picks the next free one and prints it.

## Run locally

Each app is installed and started on its own. Use two terminals:

```bash
# Terminal 1 — public website
cd frontend
npm install        # first time only
npm run dev        # → http://localhost:5173

# Terminal 2 — management workspace
cd management
npm install        # first time only
npm run dev        # → http://localhost:5174
```

Stop a dev server with **Ctrl + C** in its terminal. If one is left running in the background, free the port with:

```bash
lsof -ti tcp:5173 | xargs kill   # website
lsof -ti tcp:5174 | xargs kill   # management
```

### Scripts (same in both apps)

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the built `dist/` locally (4173 website, 4174 management) to check a build before deploying |

### Environment variables

The apps link to each other: the website footer has **Staff login**, and the admin account menu (the **DK** avatar) has **View public website**. Each app has a `.env.example`; copy it to `.env` and change the URLs for staging or production:

| App | Variable | Default |
| --- | --- | --- |
| `frontend` | `VITE_MANAGEMENT_URL` | `http://localhost:5174` |
| `management` | `VITE_WEBSITE_URL` | `http://localhost:5173` |

Vite reads `.env` at startup, so restart the dev server after changing it.

## Deploy

`npm run build` writes a static `dist/` for each app; host each one on its own domain or subdomain (e.g. `dkbadminton.in` and `ops.dkbadminton.in`). Both are single-page apps, so the host must rewrite unknown paths to `index.html`. Vercel and Netlify do this for Vite SPAs; on Nginx use `try_files $uri /index.html`. Set the environment variables above at build time.

---

## Website (`frontend/`)

| Route | Page |
| --- | --- |
| `/` | Homepage: hero, court discovery, booking journey, sample pricing, community, sample reviews, FAQ, contact band |
| `/courts` | Courts discovery (the slot preview feeds the booking flow) |
| `/pricing` | Pricing & membership enquiries, comparison of what to ask, FAQ |
| `/about` | About the academy: philosophy, values, coaching enquiry |
| `/contact` | Contact & directions with an enquiry form (preview only, sends nothing). `?topic=coaching` etc. preselects "Interested in" |
| `/booking` → `/booking/details` → `/booking/outcome` | Sample booking: slot → details → demo outcome (state kept in `sessionStorage`) |
| anything else | 404 "That shot went long." |

**Venue facts live in one file:** `frontend/src/data/site.js`. Address, phone, hours, prices, FAQs, images and the "To be confirmed" placeholders are all set there, so editing that file updates every page. It also holds:

- `samplePricing` / `samplePricingNote`: **illustrative** Home pricing cards (court ₹500/hour, ₹400 off-peak; monthly membership ₹2,999; group coaching ₹3,500/month), shown with "Sample price" badges. The Pricing page still shows ₹— and "to be confirmed".
- `sampleReviews`: three **placeholder** reviews, labelled "Sample review" on the page.

### Website structure

```
frontend/src/
  pages/            Home, Courts, Pricing, About, Contact, NotFound, booking/ (ChooseSlot, Details, Outcome)
  components/       Header, Footer, Layout, Button, Field, ConceptImage, CourtLines, EnquiryCard, ReviewCard, FaqList…
  booking/          BookingContext (flow state), schedule, slot grid, date strip, stepper, summary, validation
  motion/           Animation component kit (see Motion below)
  lib/              motion.js (easing + reduced-motion helper), formFeedback.js (form error feedback)
  data/site.js      All venue content and placeholders
  styles/           tokens.css, base.css, components.css, pages.css
```

### Motion

The website's animation is designed page by page with the `motion-director` skill. The plans are the source of truth:

- `docs/motion-plan.md`: the main plan (built). Motion character "athletic and precise"; motif **court lines draw themselves** in lime, plus a lime marker sweep. Each page has one signature moment: Home hero split headline + image wipe + court lines; Courts arched-hall reveal; Pricing marker sweep on "Less guesswork."; About hand-drawn circle on "starting point."; Contact typewriter "hello."; 404 shuttle arc.
- `docs/motion-plan-v2-additions.md`: the second pass (built). Route fade, header hide-on-scroll, form error shake and focus, slot/date fill sweep, FAQ arrow nudge, footer rule draw, Courts gallery hover zoom, and the About coaching rotator ("Want to sharpen your footwork? / smash? / stamina? / game?").

How it's built:

- Components in `frontend/src/motion/` (SplitReveal, MaskReveal, Parallax, DrawPath, ScrollDrawPath, ScribbleUnderline, TypewriterText, ScrambleText, Marquee, Magnetic, Stagger, PageFade, TextRotator) plus `motion.css`. They come from the motion-director kit; the app is wrapped once in `LazyMotion` (`domAnimation`).
- Easing tokens `--ease-out` and `--ease-in-out` are in `tokens.css`, mirrored in `src/lib/motion.js`.
- **Reduced motion is respected everywhere:** with the OS setting "Reduce motion" on, text appears complete, lines appear drawn, masks become fades, and parallax, marquee, magnetic, header hiding and the form shake are off.
- Prices, "To be confirmed" values and the booking steps are deliberately kept still.
- The site uses CSS smooth scrolling. When testing scroll effects in an automated browser, set `document.documentElement.style.scrollBehavior = 'auto'` first, or readings are taken mid-scroll.

To change motion, update the plan doc first, then the page. The plan explains why each effect exists and what was rejected.

## Management workspace (`management/`)

| Route | Screen |
| --- | --- |
| `/login` | Staff sign-in (every other route redirects here when signed out, then returns you to where you were) |
| `/` | Overview dashboard |
| `/bookings/schedule` | Court schedule (click an empty slot to add a booking) |
| `/bookings/records/:bookingId?` | Booking table + detail panel (record payment, edit, cancel) |
| `/members`, `/members/:memberId` | Member directory and profile (notes, history, ledger) |
| `/memberships?record=MEM-002` | Membership records, renewal and follow-up preview |
| `/payments?receipt=RC-101` | Transactions, outstanding dues, receipt preview |
| `/reports` | Charts, reconciliation, CSV export |

**Sign-in:** needs the backend running and an Owner account (see [Backend](#backend)). Sign out from the avatar menu or the bottom of the sidebar. "Keep me signed in" keeps the session for 30 days (otherwise until the browser closes, max 12 hours).

**Data:** every page uses the real API. There is no sample data left in the admin panel.

**Motion** in the management app is deliberately limited to feedback: dialogs, popovers, toasts and button presses. There are no count-ups, chart animations or page transitions, because it is a tool used all day.

## Backend

Requires PostgreSQL running locally.

```bash
cd backend
npm install             # first time only
cp .env.example .env    # first time only
createdb dk_badminton   # first time only
npm run db:migrate      # applies database changes
npm run create-owner    # first time only: asks for the Owner's name, email and password
npm run dev             # → http://localhost:4000
```

In `management/`, copy `.env.example` to `.env` so `VITE_API_URL` points at the API.

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on change |
| `npm test` | Automated tests. Needs a database called `dk_badminton_test` (`createdb dk_badminton_test`), which they empty |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Creates a migration after changing `src/db/schema.ts` |

**Login rules** are in `src/auth/policy.ts`: 10 failed attempts lock an account for 5 minutes; sessions last 12 hours, or 30 days with "keep me signed in"; reset links last 30 minutes. The limit of 5 active accounts and the protection of the last Owner are database triggers in `drizzle/0000_auth_tables.sql`. Role permissions are in `src/auth/permissions.ts`.

**Schedule rules:** the Owner sets venue details, courts, opening hours, prices and closures on the admin **Settings** page (`src/routes/settings.ts`). Availability is calculated in `src/schedule/availability.ts`, and all court time is held through `src/schedule/reservations.ts`. A database exclusion constraint in `drizzle/0001_schedule_tables.sql` makes double-booking impossible. No hours or prices are seeded, so nothing can be booked until the Owner enters them. Times are India time and money is stored in paise.

**Bookings and money:** customers are numbered WLK- (walk-in) or WEB- (website), bookings BKG- and receipts RCP-. All numbers come from database sequences and aren't reused. Payments here are records of cash and UPI received; no money moves through the system. A receipt is never edited: a mistake is voided with a reason and recorded again.

**Website booking:** the website calls `/public` routes (`src/routes/public.ts`), which need no login and read no cookies. A customer picks a slot, which holds it for the minutes set in Settings, then pays. Unpaid holds free themselves when they run out. Each booking has a private link; only a hash of it is stored.

**Test payments:** no gateway is connected. `PAYMENT_TEST_MODE=true` confirms bookings with a simulated payment and shows a "Test mode" notice on the website. The API refuses to start in production with it on, and with it off online booking is closed until a gateway is added.

**Memberships:** individual members (`MEM-`) share batches: fixed weekly times with a set number of places, which the Owner creates under Plans & batches. Court memberships (`CRT-`) hold whole courts at their own fixed time, with up to 10 players per court. Both run monthly. Creating a batch or court membership blocks the court on every chosen date, all or nothing, and any clash is refused with its dates. A batch has a last date, and a member can only be paid up to it, so extend the batch before renewing past it. Members can also join on the website at `/membership`, using test payments for now.

**Website content:** Owners and Managers edit the public website under Website in the admin panel: text, photos, colours, menu, footer, page titles, showing, hiding and reordering sections, and extra pages at `/p/<address>`. It is one saved document (`site_content`), checked against `src/site/defaults.json`; photos are stored in the database (`site_images`). `frontend/src/data/siteDefaults.json` is the same file, used if the API is down, and a test fails if the two differ. Add new website text to both, and it gets an editor by itself. Home price cards, the Pricing rates table and opening hours follow the saved prices and hours.

**Referrals:** off until switched on under Referrals in the admin panel. Every confirmed member gets a code, and the Owner can add promotion codes. A code takes the set discount off a new member's first month, and optionally earns the referrer a credit once that month is fully paid, which comes off their next renewal (`src/memberships/referrals.ts`). A phone or email that has already had a membership can't use a code.

**Messages:** the sender email (Gmail address and app password) and WhatsApp number are set in the admin panel under Settings, not in files. Emails go through a queue (`src/messages/queue.ts`) that retries failures, respects a daily limit and can be watched on the Messages page. Until a sender is saved, development prints emails to the API's terminal and production keeps them waiting. WhatsApp opens a prefilled chat for staff to send by hand; there is no automatic WhatsApp or SMS. Production needs `APP_SECRET` set.

**Hosting note:** password hashing (Argon2id) needs more CPU per request than the free Cloudflare Workers limit, so the API needs a normal Node.js host or a paid plan.

---

## Design tokens

`src/styles/tokens.css` (the same file in both apps) mirrors Figma "01 — Brand & Design Tokens": Court ink `#102B25`, Court green `#174D3D`, Warm ivory `#F4F2E9`, Rally lime `#D5EF72`; Barlow Condensed 600 display + Inter 400–600 UI; 4/8 radii; 24/32/64 gutters; a 224px admin sidebar; status colours for success, warning and danger; and the easing tokens.

---

## Before launch

| Item | Where | What to do |
| --- | --- | --- |
| Venue facts (address, phone, hours, court count, policies) | `frontend/src/data/site.js` | Replace every "To be confirmed" with verified details from the academy |
| Prices | `samplePricing` in `site.js`, Pricing page | Confirm real rates, remove the "Sample price" badges and note, update the Pricing page from ₹— |
| Reviews | `sampleReviews` in `site.js` | Replace with verified reviews (e.g. from the Google Business profile) and remove the "Sample review" labels |
| Photography | `frontend/src/assets`, `images` in `site.js` | Replace the AI concept imagery with real venue photos and drop the "Concept imagery · Not the venue" captions |
| Payments | `backend/src/routes/public.ts` | Connect a payment gateway and set `PAYMENT_TEST_MODE=false`; online booking stays closed until then |
| Sample prices and reviews | `frontend/src/data/site.js` | Replace them with real prices and reviews; the prices on these pages aren't read from Settings yet |
| Contact form | `frontend/src/pages/Contact.jsx` | Wire it to a real endpoint (email/WhatsApp/CRM) and add the privacy notice |
| Staff login | `backend/` | Built. Before launch: choose hosting, set the production Gmail details and `TRUST_PROXY_HOPS`, and serve the API and admin panel over HTTPS on the same domain |
| Management data | `management/src/store/WorkspaceContext.jsx` | Replace `localStorage` with the real API |

Once real photos and numbers exist, `docs/motion-plan-v2-additions.md` lists the motion that becomes available (scroll-zoom hall reveal, a photo gallery, a stats band, review star fill, a confirmed-booking success mark).
