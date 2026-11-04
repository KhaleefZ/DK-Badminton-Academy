# Motion plan — v2 additions (proposed)

Produced with motion-director v2 on 29 Oct 2026, as an audit of the built plan (`docs/motion-plan.md`). Status: **approved and built (29 Oct 2026)**. All 8 additions are implemented. Deviations: in #8 the "?" sits inside each rotating word (`footwork?` … `game?`), so the slot's reserved width trails after the line instead of leaving a gap before the "?"; the heading carries an `aria-label` with the clean sentence. The footer rule appears instantly under reduced motion (Motion reports the preference after the first render).

Files: `components/Layout.jsx` (PageFade), `components/Header.jsx` (hide on scroll), `lib/formFeedback.js` + `pages/Contact.jsx` + `pages/booking/Details.jsx` (error feedback), `components/Footer.jsx`, `pages/Courts.jsx`, `pages/About.jsx`, the v2 block at the end of `styles/pages.css`, and `motion/{PageFade,TextRotator}.jsx` plus the v2 `motion.css` from the skill kit.

Verified (Playwright): desktop 1440 and phone 390, motion on and reduced; no horizontal overflow on any route; console clean.

## Audit summary

- **Profile:** Athletic, intensity ceiling 3 (functional surfaces 1). The existing motion character, the court-line motif and the lime marker stay as they are.
- **What's already strong:** every marketing page has one distinct signature; truth is respected (no motion on prices or TBC values); booking stays functional; the marquee is the site's only loop.
- **Gaps found:**
  1. **Between pages:** routes snap in with no transition, and the sticky header never gets out of the way while reading.
  2. **Feedback:** submitting a form with errors gives no feedback beyond error text popping in; slot and date selection jumps instantly to the filled state; FAQ links have no hover affordance on their ↗ arrow; footer links have no hover state matching the header.
  3. **Home is at budget:** 1 signature plus 4 supporting (marker, journey line, community split, CTA split). Any *expressive* addition there would break the budget, so new Home motion is feedback-level only.
  4. **Content truth blocks the cinematic options:** the photography is AI concept imagery, the prices and reviews are samples, and there are no verified numbers. Scroll zoom, horizontal galleries, star fills and stat counters are therefore deferred, not rejected forever (see "Unlocked by real content").

## Proposed additions (in build order)

| # | Where | Addition | Level | Values | Meaning ("tells the visitor…") | Reduced motion |
|---|---|---|---|---|---|---|
| 1 | All pages (`Layout`) | `PageFade` on `<main>`, keyed by pathname; no exit | 1 | 280ms, 8px rise, ease-out | "You've moved to a new page," without the jump-cut | Opacity only |
| 2 | Header | Hide on scroll down, show on scroll up; hairline border appears once scrolled | 1 | `translateY(-100%)` 200ms ease-out; hides after 80px down; any upward scroll shows it; never hides at top or while the mobile menu is open | "The page is yours while you read; the nav comes back the moment you want it" (most valuable at 390px) | Stays put (sticky, no hiding) |
| 3 | Contact form + Booking details | On submit with errors: `.md-shake` once on the first invalid field, which also gets focus; error text fades and rises 4px | 1 | Shake 300ms (6→5→3px); error 150ms | "This field needs you": the eye is taken to the problem | Focus only, no shake; error appears instantly |
| 4 | Slots and date tiles (booking + Courts preview) | Selected fill sweeps in from the left instead of snapping | 1 | `::before` `scaleX(0→1)`, origin left, 180ms ease-out | "You claimed this slot": a lane being filled, close to the court-line motif | Instant fill |
| 5 | FAQ rows (Home, Pricing) | ↗ arrow nudges 2px up-right on hover/focus | 1 | 160ms ease-out, pointer-gated (focus always) | "This goes somewhere" | Static |
| 6 | Footer | The footer rule draws left→right once (court line); links get the header's underline draw | 2 | Rule 0.8s in-out, in view · underline 200ms | The court-line motif closes the page; consistent link feedback | Rule shown; underline instant |
| 7 | Courts gallery (2 tiles) | Hover zoom inside the frame | 1 | `scale(1.04)` 600ms ease-out, pointer-gated (1.04, not 1.05, because the imagery is AI-generated) | "Look closer" | Static |
| 8 | About coaching (optional, needs a copy change) | `TextRotator` in the heading: "Want to sharpen your **footwork / smash / stamina / game**?", resting on "game"; **swap out** this section's image parallax | 3 | 2200ms interval, 500ms roll, 1 pass | "Coaching for whatever you want to improve" | Shows "game" |

### Self-critique after the additions (rubric /20)

| Page | Before | After | Note |
|---|---|---|---|
| Home | 19 | 19 | Additions are level 1–2 only; the budget is unchanged |
| Courts | 19 | 19 | Hover zoom and slot sweep are feedback, not supporting slots |
| Pricing | 18 | 18 | Stays calm by design |
| About | 19 | 19 with the swap · 17 without | Adding the rotator *and* keeping the parallax puts 3 effects in one section (effect soup) |
| Contact | 18 | 19 | Form feedback closes the readability gap |
| Booking | — | +1 | Slot sweep plus validation feedback |

## Unlocked by real content (deferred, with the trigger)

| When this arrives… | …add this | Where |
|---|---|---|
| Real venue photography (≥ 2400px wide) | `ScrollZoom` hall reveal as the Courts signature (replacing the mask); `HorizontalScroll` gallery of 4–8 photos | Courts |
| Verified numbers (courts, members, years open) | A stats band with `RollingNumber` (the athletic profile's favourite); demote the Home CTA split to quiet to stay in budget | Home, between journey and pricing |
| Verified Google reviews | Stars fill lime one by one (60ms stagger) after each card lands | Home reviews |
| A live booking system | `SuccessMark` replacing the flag on a *confirmed* booking; reference scramble kept | Booking outcome |

## Rejected (and why)

- **Scroll zoom / horizontal scroll now:** they magnify AI concept imagery, and the profile says to lean on type and lines when photos aren't real.
- **Glow border or a court-line trace on the "Most popular" card:** it would be Home's 5th supporting effect (over budget), and it would spotlight a sample price.
- **Rolling numbers or count-ups:** there are no true numbers to count.
- **Star fill on reviews:** the reviews are placeholders, and animating fake proof makes it more convincing, not less.
- **`SuccessMark` on the booking outcome or the contact preview:** both say *nothing was booked or sent*; a check mark would contradict the copy.
- **`Disclosure` accordion for FAQs:** the answers are one line and visible answers scan faster; hiding them adds clicks.
- **A sliding active-nav indicator:** the underline already draws on hover and on the active route; a sliding version needs `domMax` (+~15KB) for little gain.
- **Card hover lift on pricing/review cards:** the cards aren't clickable as a whole, so a lift would promise a click that doesn't exist.
- **Blur reveal, tilt, spotlight:** off-profile (blur is banned for athletic; tilt and spotlight don't suit a light, local sports brand).
- **`ScrollProgress`:** the pages are short.
- **Shine on the CTA band button:** Home already has its one CTA treatment (magnetic in the hero).
- **Management app:** unchanged (intensity 0–1, as before).

## Build plan (on approval)

1. **Foundation:** copy `PageFade`, `TextRotator` (if #8 is approved) and the v2 `motion.css` utilities (`.md-shake`, `.md-link`) into `src/motion/`. Build ✓.
2. **Layout + header:** #1, #2. Check at 1440/390: the header must never hide while the mobile menu is open.
3. **Forms:** #3 on Contact and Details (shared helper: focus the first invalid field, add/remove `.md-shake` on `animationend`).
4. **Booking surfaces:** #4 in `pages.css` (`.slot--selected`, `.date-strip__day.is-selected`).
5. **Small feedback:** #5, #6, #7.
6. **About coaching:** #8 (copy approval first).
7. **Verify:** reduced motion via Playwright `emulateMedia`; 390px overflow; console clean; feel-check the header threshold on a real phone.
