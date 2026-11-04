# Motion plan — DK Badminton Academy (website)

Produced with the `motion-director` skill. Status: **approved and built (29 Oct 2026)**. Deviations from the plan: the Home community heading splits by word rather than by line, so the underline can wrap "rally."; the About statement splits by word with the circle drawn around "starting point.".

## Motion character

- **Personality:** athletic, precise, quick off the mark, disciplined. Movement is directional (like a shuttle off the racket), never floaty or bouncy, except on the one celebration moment.
- **Timing scale:** micro 160ms · UI 200–250ms · reveals 600–750ms · signature sequences ≤ 1.6s.
- **Curves:** entrances `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` · line drawing, masks `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)` · one spring `{ duration: 0.5, bounce: 0.2 }` (success / 404 only).
- **Signature motif: court lines draw themselves.** Thin lime (`#D5EF72`) or ivory strokes trace service lines, centre lines and boundaries over imagery and between ideas. Secondary motif: a **lime marker sweep** behind a key phrase.
- **Stagger:** words 70ms · cards/items 70–80ms · lines 110ms.
- **Reduced motion:** text appears complete, lines appear already drawn, masks become fades, parallax, marquee and magnetic effects are off.

## Component kit

From the motion-director library into `frontend/src/motion/`: `SplitReveal`, `TypewriterText`, `ScrambleText`, `ScribbleUnderline`, `DrawPath`, `ScrollDrawPath`, `MaskReveal`, `Parallax`, `Marquee`, `Magnetic`, `Stagger`/`StaggerItem`, `motion.css`, `easing.js`. The existing `LazyMotion` (`domAnimation`) wrapper and easing tokens stay. The current quiet `Reveal` remains the baseline for unlisted sections.

---

## Page: `/` — Home

**Story:** "You're stepping onto the court." The hall opens, the lines get drawn, and the headline is called out like a match start.
**Signature moment:** hero choreography, with the headline arriving word by word while the player image wipes open and court lines draw across it.

| # | Section | Pattern | Role | Effect(s) | Values | Meaning | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1 | Hero "Make time for the game." | Hero | **Signature** | `SplitReveal` headline by word (rotate 3°); image `MaskReveal` up + `Parallax` inside; `DrawPath` court lines (service line + centre line) over the image; `Magnetic` on "Discover the courts" | Headline 700ms, 70ms stagger, on load · mask 1.2s in-out, starts with the headline · lines 0.9s each, start 0.9s, 0.35s apart · parallax 50px · sub-copy/CTAs keep the current CSS fade-rise | The game starts now; the court is being set up for you | Headline fades; image fades; lines already drawn |
| 2 | Location strip | Info strip | Quiet | Fade (unchanged) | — | Facts stay readable | — |
| 3 | "A little less scrolling. A little more play." | Media + text | Supporting | Hall image `MaskReveal` right (reading direction); **lime marker sweep** behind "MORE PLAY." | Mask 1.1s · marker 0.7s, 0.5s after the heading appears | The payoff is play | Fade; marker shown |
| 4 | "From interest to court." | Process / steps | Supporting | `ScrollDrawPath`: one court line runs across the three stages as you scroll; stage numbers `ScrambleText` 01/02/03 | Line scroll-linked (`start 85%` → `end 55%`) · scramble 600ms, 80ms apart | The journey is one connected path | Line drawn; numbers static |
| 5 | "Your game. Your routine." + cards (sample prices) | Pricing cards | Quiet | `Stagger` cards; banner fade (no count-up on prices) | 600ms, 80ms stagger | Options presented calmly | Fade |
| 6 | "Come for the rally. Stay for the game." | Statement band | Supporting | `SplitReveal` by line; hand-drawn lime `ScribbleUnderline` under "RALLY"; image `Parallax` | Lines 750ms, 110ms stagger · underline 0.9s, +0.5s · parallax 60px | Emphasis on what brings people together | Fade; underline drawn; static image |
| 6b | Reviews "Players say it best." (sample reviews) | Testimonials | Quiet | `Stagger` review cards | 550ms, 80ms stagger | Social proof, calmly | Fade |
| 7 | FAQ | FAQ | Quiet | `Stagger` questions | 500ms, 60ms stagger | Easy scanning | Fade |
| 8 | "Let's get you playing." | CTA band | Supporting | `SplitReveal` by word | 650ms, 60ms stagger | The final call to act | Fade |

**Rejected here:** marquee on the location strip (it holds real location info; moving text hurts reading) · count-up on the ₹— prices (they're placeholders; counting to a dash means nothing) · a typewriter in the hero (the headline is 22 characters across 3 lines, and a typed version would delay reading. The typewriter is used on Contact instead, where it carries meaning) · a second magnetic button on the CTA band (one per page).

---

## Page: `/courts` — Courts discovery

**Story:** "Here's the space." The big hall photo is the star, and the court lines draw themselves onto it.
**Signature moment:** the arched-hall photo wipes open with slow parallax, then lime court lines trace the floor.

| # | Section | Pattern | Role | Effect(s) | Values | Meaning | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1a | "Find your next rally." | Page intro | Supporting | `SplitReveal` by word | 700ms, 70ms stagger, on load | Arrival | Fade |
| 1b | Arched hall image | Hero image | **Signature** | `MaskReveal` up + `Parallax`; `DrawPath` court lines over the floor | Mask 1.2s · parallax 60px · lines 1.0s, start +0.6s, 0.3s apart | The court comes to life | Fade; lines drawn |
| 1c | Gallery row (2 images + note) | Gallery | Quiet | `Stagger` tiles | 600ms, 80ms | Supporting images | Fade |
| 2 | "Good questions. Clear answers." + facility rows | List | Supporting | Facility rows `Stagger`; each row's bottom rule draws left→right (court-line motif) | Rows 70ms stagger · rule 0.6s in-out | A checklist being marked out | Fade; rules drawn |
| 3 | "A time that fits." + "Take the next step" | Functional preview | Quiet | Slot press feedback (existing); `Magnetic` on "Continue sample booking" | Strength 0.25 | Invitation to try | No magnetic |

**Rejected here:** parallax on the gallery thumbnails (too small, and it reads as jitter) · scramble on the "To be confirmed" badges (placeholder text shouldn't draw attention to itself).

---

## Page: `/pricing` — Pricing & memberships

**Story:** "Calm and clear." This page is about trust, so it stays quiet apart from one emphasis.
**Signature moment:** a lime marker sweeps behind "LESS GUESSWORK."

| # | Section | Pattern | Role | Effect(s) | Values | Meaning | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1 | "More game. Less guesswork." + cards | Page intro + pricing | **Signature** (light) | `SplitReveal` by word; lime marker sweep on "LESS GUESSWORK."; cards `Stagger` | Headline 700ms · marker 0.7s, +0.6s · cards 80ms stagger | Clarity is the promise | Fade; marker shown |
| 2 | "Know what to ask." table | Compare table | Quiet | Fade once (existing reveal) | — | Data to read | — |
| 3 | "Before you commit." + FAQ | FAQ | Quiet | `Stagger` questions | 60ms | Scanning | Fade |

**Rejected here:** row-by-row table animation, count-ups and scrambles on prices. This is data people are comparing, and motion there undermines trust.

---

## Page: `/about` — About the academy

**Story:** "What we stand for." Handwritten emphasis gives the brand a human voice; the values beat like a rhythm.
**Signature moment:** "THE GAME IS THE STARTING POINT." arrives line by line, then a hand-drawn lime circle rings "STARTING POINT".

| # | Section | Pattern | Role | Effect(s) | Values | Meaning | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1 | Hero statement + player image | Hero | **Signature** | `SplitReveal` by line; `ScribbleUnderline variant="circle"` (lime) on "STARTING POINT"; image `MaskReveal` left | Lines 750ms, 110ms · circle 1.0s, +0.9s · mask 1.2s | Personal conviction, written by hand | Fade; circle drawn |
| 2 | "Focus. Respect. Keep playing." values | Feature list | Supporting | Heading `SplitReveal` by word (three beats); values `Stagger` | 650ms, 120ms between words · items 80ms | The three values land one by one | Fade |
| 2b | *New:* values marquee band | Marquee | Supporting | `Marquee` "FOCUS ● RESPECT ● KEEP PLAYING ● SELVAPURAM NORTH" in display type on ink | 40s per loop, pauses on hover | The values as a mantra | Static row |
| 3 | "What would you like to work on?" coaching | Media + text | Supporting | Image `Parallax`; hand-drawn `DrawPath` arrow curving toward "Enquire about coaching" | Parallax 50px · arrow 0.9s, in view | A friendly nudge to enquire | Static; arrow drawn |
| 4 | "Local to Coimbatore." band | CTA band | Quiet | Fade (existing) | — | — | — |

**Rejected here:** a typewriter on the statement (too long; split-by-line carries it better) · marquee duplicated elsewhere (one per site keeps it special).

---

## Page: `/contact` — Contact & directions

**Story:** "Say hello." The page literally speaks its greeting.
**Signature moment:** "YOUR NEXT GAME STARTS WITH A" is static, and **"HELLO."** is typed out with a blinking caret.

| # | Section | Pattern | Role | Effect(s) | Values | Meaning | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1 | Title | Page intro | **Signature** | `TypewriterText` on "HELLO." | 70ms/char (slow, deliberate), start 400ms, caret hides 1.2s after | A greeting being spoken | Full text, no caret |
| 2 | "Check before you travel." card | Contact / map | Supporting | Map-pin icon drops in (spring); dashed route line `DrawPath` from the pin | Pin spring 0.5s bounce 0.2 · line 1.0s, +0.3s | Directions: a path to us | Static |
| 3 | Enquiry form | Form | Quiet (functional) | Press feedback only; preview notice cross-fades | 200ms | Form stays instant | — |

**Rejected here:** form field entrance animations (they delay input) · a scramble on the maps URL (it's a link people copy).

---

## Page: `/booking/*` — Sample booking (functional)

| Surface | Motion | Why |
|---|---|---|
| Stepper | Connector line between steps draws to the current step on navigation (300ms in-out) | State indication: progress |
| Slots / dates | Existing press feedback; selected fill transitions 150ms | Feedback |
| Summary card time line | Cross-fade when the slot changes (200ms) | Shows the summary updated |
| Outcome | Keep the flag spring; add `ScrambleText` on "PREVIEW-001" (800ms) | The rare completion moment; a reference "resolving" |

**Rejected:** reveals, split headlines and typewriters on steps 1–2 (people are trying to act).

## Page: 404

`DrawPath` of a shuttle's arc flying past a drawn baseline ("That shot went long."), 1.2s in-out, then the arc's end dot springs. A rare moment, so the playfulness is allowed.

## Functional surfaces: management app

No change. It keeps press feedback, dialog, popover and toast transitions only. Expressive motion on a tool used all day reads as delay.

## Verification checklist

- [x] Each page: the signature plays once, the final state is correct, no layout shift (typewriter and split text reserve their size)
- [x] Scroll every page: all revealed elements end at opacity 1; scroll-drawn lines complete at the section end
- [x] Reduced motion emulated: content complete, lines drawn, nothing moving
- [x] 390px: no horizontal overflow; magnetic off on touch; marquee legible; parallax smooth
- [x] Console clean; CTAs clickable during every sequence
- [x] Feel-check for a human: hero choreography timing (0.25× in DevTools Animations), typewriter speed on "HELLO.", marker sweep length, parallax on a real phone
