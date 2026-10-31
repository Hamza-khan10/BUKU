# Phase 3 — the BUKU web app: plan

The website is how the world meets BUKU. It has two jobs at once: show, in seconds, why booking
and queueing with BUKU is better than calling or standing in line — and then actually do it,
flawlessly, for customers, businesses and the people who run the platform. This plan is the
contract for Phase 3: every page, what it shows, where its data comes from, how it behaves when
things go wrong, and the order we build it in.

## 1. Principles (non-negotiable)

1. **Only the truth.** Every number, claim and promise on the site is real: counts come from the
   API, prices from the billing catalog, "2 times left today" from real availability, ratings
   from real reviews. No invented testimonials, no fake stats, no "coming soon" for things we
   haven't decided to build, no countdown timers that reset. Where we have nothing true to show
   yet (no reviews), we show an honest empty state.
2. **Respect people's time** — the product's whole idea. Fewest steps to a booking; never ask
   twice; never lose what someone typed; instant feedback.
3. **Ethical engagement.** We keep people exploring with genuinely useful discovery (open now,
   free times near you, your usual place has openings), clear progress and moments of delight —
   not with dark patterns: no fake scarcity, no confirm-shaming, no hidden cancel, no pre-ticked
   consent, no infinite manipulation loops.
4. **Accessible to everyone.** WCAG 2.2 AA: contrast ≥ 4.5:1 (checked numerically), full keyboard
   use, visible focus, screen-reader labels, reduced-motion respected, 44 px touch targets, works
   from 320 px wide to 2560 px.
5. **Fast.** Server-rendered public pages, Core Web Vitals green (LCP < 2.5 s, INP < 200 ms,
   CLS < 0.1), Lighthouse ≥ 95 on public pages, no layout jumps, images sized and lazy.
6. **Secure by construction.** No tokens readable by JavaScript; strict CSP with nonces; same
   validation rules as the API; every page assumes the API may refuse.
7. **Clean data in.** Text fields refuse emojis, invisible characters, control characters and
   look-alike tricks — in the browser (instant hint) and, authoritatively, in the API (§6).
8. **Separate and debuggable.** Each feature lives in its own folder (`features/<name>`) with its
   API calls, components, validation and tests; shared UI in `components/ui`; nothing reaches
   into another feature's internals. Every request carries a request id shown on error screens.

## 2. Brand and design system

Redesigned 2026-10-10 (D-093) from the owner's brief: luxury, modern, trustworthy and crafted,
suited to booking and queueing, "not a gradient of colours". The first design (warm paper, coral,
Bricolage + Inter) had become the commonest generated look; this replaces it.

**Design read:** a premium consumer marketplace for booking times and joining queues at local
businesses, for everyday customers and the businesses serving them, in a calm, precise, physical
language (Apple's design principles, translated for the web). Dials: variance 7, motion 6,
density 3 on public pages; 5 / 4 / 5 in the account and business areas.

### Feeling we design for

Calm control, then confident momentum, then a small celebration. Booking and queueing are usually
stressful (waiting, uncertainty, phone calls). BUKU feels like the opposite: **"I know exactly
when, and it's handled."** Restraint everywhere, so the one thing that matters on each screen
(the time, your place in line, the next step) is the most obvious thing on it.

### Colour

Refined 2026-10-11 (D-094) into a colour system the business can also market with: five
colours, each with one job. Porcelain and Ink carry most of every screen (60/30); the accents
share the last 10%. Nothing is a gradient.

- **Porcelain** (60%): the calm page. A cool, barely green white that reads as clean and quiet.
- **Ink** (30%): text and structure. Near-black with a hint of green, never pure black.
- **Emerald** (the accent): go, available, confirmed. Green is the colour of "proceed" and
  of growth and trust; it is the brand and logo colour.
- **Saffron** (the spark, used sparingly): your number, the "live" dot, waiting. Warm and
  optimistic, the opposite of a cold queue; the pivot of the logo's clock.
- **Midnight**: the board and the scroll story, a deep green-black stage that makes the emerald
  and saffron glow.

Red is for errors only. The palette, its rules and ready-to-use combinations are published as
"BUKU colour system" (brand page, owner's link).

| Token                      | Light                             | Dark                              | Role                                           |
| -------------------------- | --------------------------------- | --------------------------------- | ---------------------------------------------- |
| `canvas`                   | `#F4F8F6` porcelain               | `#0C1310`                         | Page                                           |
| `surface`                  | `#FCFEFD`                         | `#141C18`                         | Raised things: tickets, dialogs, menus, inputs |
| `sunken`                   | `#EAEEEC`                         | `#08100C`                         | Wells, tracks, quiet sections                  |
| `ink` / `ink-2` / `ink-3`  | `#131A17` / `#4F5754` / `#5E6662` | `#EDF3F0` / `#BAC3BF` / `#9BA4A0` | Text: primary, secondary, muted                |
| `line` / `control`         | `#D4DDD9` / `#7F8883`             | `#26302B` / `#6A746F`             | Hairlines; input borders (3:1)                 |
| `brand` (emerald)          | `#056549`, logo `#067F5D`         | `#2BBC8E`, text `#79D7B1`         | Book, join, available, confirmed; focus rings  |
| `wait` / `spark` (saffron) | `#FFAD52`, text `#7A4802`         | `#FFAD52`, text `#FED1A5`         | Your number, live, in a queue, pending         |
| `danger` (crimson)         | `#C51D28`                         | `#FFA69E`                         | Errors only                                    |
| `board` (midnight)         | `#011E14`, tiles `#0D2A20`        | the same                          | The board, the scroll story                    |

Every text pair meets WCAG 2.2 AA, checked numerically: body text 6.9:1 and up, muted text
5.0:1 and up, white on emerald 7.1:1 (dark: 7.3:1), saffron on midnight 9.5:1, input borders
3.4:1. Components use the tokens only, never raw colours (the board has its own `board-*`
tokens, the same in both themes).

### Type

- **Instrument Sans** for everything (one family; hierarchy from size, weight and tracking, the
  way Apple sets type). Display sizes are tight (negative tracking, leading about 1.02); small
  text is slightly open. Numbers are tabular wherever they count or line up (times, queue
  positions, prices).
- **A monospace only for codes** people read aloud (`BK-7KQ2MX`), where 0 and O must never be
  confused.
- Self-hosted through `next/font` (no requests to font CDNs from visitors' browsers).
- **One scale for every page** (D-095), named by a heading's job, never set by hand:
  `type-title` (a page's h1), `type-app-title` (h1 in the parts you use: account, a visit, a
  ticket, signing in), `type-section` (a section of a page that tells), `type-heading` (a list, a
  form, a panel), `type-subheading`, `type-lead` (the sentence under a heading). The home page's
  headline is the one exception, its own size.

### One design language on every page (D-095)

The home page is the most striking page, but every page is built from the same parts, so it
all reads as one product:

- **`PageHeading`** on every page: an optional label (an `Eyebrow`, whose Saffron dot is the
  logo's pivot), the title, a sentence of context, then the page's controls. Titles rise in word
  by word, as the home page's does; `compact` (the account area) simply fades up.
- **`SectionHeading`** for every section: label, title, sentence, optional link.
- **The Midnight footer** closes every page with the promise ("Book the time. Skip the wait.")
  and the links (two columns on phones).
- **The header adapts**: over a Midnight section (the story, the footer; anything marked
  `data-tone="dark"`) its glass turns dark too, instead of going grey.
- **Places look the same everywhere**: a place without a photo gets its initial on mint (never a
  grey box or a stock picture); in a list on a phone each place is a row (picture beside the
  text), so a list is quick to scan.
- **Phone first**: filters sit in one row you swipe, City and Order are compact pills, so results
  start on the first screen of a small phone.

### Shape and material

- Buttons, chips and time pills are pills. Inputs: 12 px corners. Panels and tickets: 20 px.
  Pictures: 16 px.
- Raised things (tickets, dialogs, menus) have a hairline and a soft shadow tinted to the page,
  never black. Everything else is grouped by space and hairlines, not boxes.
- The header is a translucent material: content scrolls under it, blurred, with a soft fade at
  its edge instead of a hard divider (solid when reduced transparency is asked for).

### Signature motifs

- **The board.** The split-flap display of a station or a waiting room: "Now serving 07", your
  time. The one bold thing on the home page; everywhere else stays quiet.
- **The ticket.** Bookings and queue places look like real tickets: a stub with a perforated
  edge, the code large, a QR, a live status band.
- **Time as pills.** Free times are tappable pills; the chosen one fills emerald; taken ones
  simply aren't there.
- **Live.** A soft pulse means "this updates by itself" (queue position, open now), and only that.

### Motion

Springs, not timelines (critically damped by default; a little bounce only after a flick), so
everything can be interrupted and starts from where it is. Feedback on press, not on release.
One orchestrated moment per page: the board on the home page, the ticket arriving when a booking
is confirmed, your place counting down in a queue. Lenis smooths wheel scrolling on desktop;
GSAP runs the one scroll-told story (how a visit goes, on a phone, phones included). The
story's phone is drawn once at one size (320 × 664) and scaled to the space it has, so a small
phone shows the same screen smaller, never a squashed one; its screens move as a phone's do
(pushed in from the right, the queue rising as a sheet, "your turn" opening from the middle) and
reverse when scrolling back; it can be tapped too, and a tap that changes step scrolls the page there (D-099). The hero's
words rise in once as the page opens; sections below reveal as they scroll in (CSS
scroll-driven, where the browser supports it). Words that move only with the scroll, cards laid down as the page scrolls (wide screens), main buttons that lean toward a mouse and counts that roll up when seen (D-099). Anything that moves for more than five seconds
can be paused. Under `prefers-reduced-motion`: no smooth scrolling, no pinning, no reveals, short
cross-fades instead of movement.

### Voice

Plain, warm, specific. "You're booked: haircut with Ali, Thursday 10:30." Not "Your request was
processed successfully." Errors say what happened and what to do next, never blame. Numbers
before adjectives. Sentence case, no all-caps labels, no em dashes.

### Logo

Redrawn 2026-10-11 (D-094) so it explains itself: **a ticket whose two clock hands make a
check.** The ticket is the queue (take a number) and the booking (your ticket); the hands are the
time; together they read "your time, confirmed". Emerald ticket, white hands, a saffron pivot.

- Drawn on a 48-unit grid (`src/components/brand/mark.ts` holds the geometry; `Logo` and
  `LogoMark` draw it; favicon, app icons and share images use the same paths).
- Reusable files in `apps/web/public/brand/`: the mark (colour, reversed for dark backgrounds,
  one-colour), the lockup with the wordmark outlined (colour and reversed), and app icons
  (emerald tile, maskable, midnight).
- Clear space: half the mark's height on every side. Smallest size: 16 px for the mark, 80 px
  wide for the lockup. Never recoloured outside these versions, never on a busy picture.

## 3. Pages (information architecture)

Legend — **Data:** API used. **Auth:** who may open it. Every page has designed loading
(skeletons in the final layout), empty, error (with retry and request id) and offline states.

### 3.1 Public (server-rendered, indexed)

| Route                                  | Purpose                                                                                                                                                              | Data                                                                   | Key edge cases                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/`                                    | The pitch + live discovery: search bar, categories, featured, trending, how it works, for business                                                                   | search featured/trending/categories, billing plans for "Free to start" | no location → city picker; no featured yet → hide section (never fake)                                                   |
| `/explore`                             | Search with filters (text, near me, open now, has queue, rating, category), changed in place; places keep coming as you scroll; loading skeletons (D-104). Map later | `/v1/businesses/search`, `nearby`, `autocomplete`                      | location denied, no results (suggest wider radius), typos, slow network, an old link to a later page (starts at the top) |
| `/categories`, `/c/[slug]`             | All categories (find by typing, jump to a group, stacked group cards — D-102); one category's businesses                                                             | `/v1/categories`, `/v1/categories/:slug/businesses`                    | hidden/inactive category → 404; empty category                                                                           |
| `/b/[idOrSlug]`                        | Business profile: photos, rating + reliability, services and prices, team, hours, open now, live queue, reviews, map; Book / Join queue                              | public profile, services, staff, reviews, queue public, availability   | suspended → 404; unverified → label; no services but queue; no photos; closed today                                      |
| `/for-business`                        | Why businesses use BUKU: bookings, queue screen, check-in, reminders, insights                                                                                       | billing plans                                                          | —                                                                                                                        |
| `/pricing`                             | Real plans for customers and businesses with their benefits                                                                                                          | `/v1/billing/plans`                                                    | billing off → "Everything is included right now"                                                                         |
| `/how-it-works`                        | Booking and queue explained step by step                                                                                                                             | static                                                                 | —                                                                                                                        |
| `/about`, `/contact`, `/help`          | Who we are; how to reach us; honest FAQ                                                                                                                              | static                                                                 | —                                                                                                                        |
| `/security`                            | Trust page: the real controls (encryption, two-step, audit) in plain words                                                                                           | static (from SECURITY.md)                                              | —                                                                                                                        |
| `/legal/*`                             | privacy, terms, business-terms, cookies, acceptable-use, refunds, sub-processors                                                                                     | static, matching the system (retention, processors)                    | version + effective date on each                                                                                         |
| `sitemap.xml`, `robots.txt`, OG images | SEO                                                                                                                                                                  | businesses + categories                                                | suspended businesses excluded                                                                                            |
| `404`, `500`, offline                  | Designed, helpful                                                                                                                                                    | —                                                                      | request id shown on 500                                                                                                  |

### 3.2 Signing in

| Route              | Purpose                                                                                   | Edge cases                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/signin`          | Continue with Google (and Apple when configured); development sign-in only in development | popup blocked, account suspended, deletion pending (offer restore), terms changed |
| `/signin/business` | Employee sign-in: business handle + username + password                                   | wrong password count, locked (time left), temporary password → must change        |
| `/signin/verify`   | Two-step code or recovery code                                                            | expired challenge, wrong code, locked, paste with spaces                          |
| `/welcome`         | First time: accept terms, add phone (+WhatsApp consent), notification choices             | skip phone, invalid number, back button                                           |
| `/signout`         | Ends the session everywhere it should                                                     | —                                                                                 |

### 3.3 Customers

| Route                                         | Purpose                                                                                           | Data                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/b/[idOrSlug]/book`                          | Booking: service → person (or anyone) → day → time → review → confirmed ticket                    | services, staff, availability, `POST /v1/appointments` |
| `/account`                                    | Home: next visit as a ticket, live queue ticket, your usual places, reliability, quick rebook     | appointments, my-ticket, reliability                   |
| `/account/appointments`, `/appointments/[id]` | Upcoming/past; the receipt (code + QR), cancel (reason, "remind me later"), move, add to calendar | appointments, cancel, reschedule                       |
| `/appointments/[id]/review`                   | Review a visit                                                                                    | reviews                                                |
| `/queue/[entryId]`                            | Live ticket: position, people ahead, called → come to the counter                                 | my-ticket, public queue stream (live)                  |
| `/account/reviews`                            | My reviews (edit within 7 days, delete)                                                           | `/v1/appointments/reviews`                             |
| `/account/notifications`                      | Inbox + preferences + WhatsApp connect + suggestions opt-in                                       | notifications, prefs, whatsapp                         |
| `/account/settings`                           | Profile, phone, picture, two-step, sessions/devices, export my data, delete account               | auth me, mfa, sessions, export, delete                 |

Customers use BUKU for free, with no plan (D-101): there is no customer billing page, and the old
`/account/plan` goes to `/account`. Edge cases throughout: slot taken while choosing (refresh
times, keep choices), booking limit per business, overlapping booking elsewhere, late cancellation
warning (window), queue too far (distance, retry with location), already in a queue, queue
closed/paused, business suspended mid-flow, session expired mid-flow (resume after sign-in).

### 3.4 Businesses (`/business/...`)

| Route                         | Purpose                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `/business`                   | My businesses (owner or team) + "Add your business"                                               |
| `/business/new`               | Guided setup: what it is → where it is (phone location or pasted coordinates) → business terms    |
| `/business/[id]/setup`        | Opening hours → first service and who does it → live (each step saved as it's done)               |
| `/business/[id]`              | Today: appointments timeline with now-line, queue status, arrivals, quick check-in, real KPIs     |
| `/business/[id]/appointments` | Day view + list, search by code or name, confirm/decline/cancel, complete, no-show                |
| `/business/[id]/calendar`     | Week view per employee                                                                            |
| `/business/[id]/check-in`     | Scan the QR with the camera or type the code                                                      |
| `/business/[id]/queue`        | Front-desk board: call next, serve, done, no-show, walk-ins, priority, pause/close (live)         |
| `/b/[slug]/screen`            | Full-screen waiting-room display: now serving, next tickets (public data only, no sign-in; D-126) |
| `/business/[id]/services`     | Menu: categories, services, prices, durations, who does what                                      |
| `/business/[id]/staff`        | Profiles, hours, time off, photos (with consent), attendance                                      |
| `/business/[id]/hours`        | Opening hours, closures and holidays                                                              |
| `/business/[id]/team`         | Employee accounts and roles                                                                       |
| `/business/[id]/reviews`      | Reviews, reply, report                                                                            |
| `/business/[id]/insights`     | Cancellations and no-shows (charts), reliability                                                  |
| `/business/[id]/billing`      | Plan, trial, request a plan                                                                       |
| `/business/[id]/settings`     | Profile, photos and logo, booking settings, queue settings, verification documents, legal profile |

Every page respects the person's role (owner, manager, front desk, staff): tools they can't use
aren't shown, and the API refuses anyway.

### 3.5 Platform operators (`/admin/...`, two-step sign-in required)

Overview · business verification queue and suspensions · reported businesses · review
moderation · billing (plans, prices, settings, grants, plan requests, economics) · notification
settings and WhatsApp usage · access review. Every action asks for a reason where the API needs
one and shows the audit trail.

## 4. Architecture

- **Location:** `apps/web` (Next.js 16 App Router, React 19, TypeScript strict), added to the
  pnpm workspace; Tailwind CSS 4 with design tokens; Radix primitives for accessible dialogs,
  menus, popovers, tabs; TanStack Query for client data; React Hook Form + Zod with the shared
  rules; `motion` for animation; `lucide-react` icons.
- **Folders:** `app/` (routes only, thin) · `features/<feature>/` (api, components, hooks,
  schema, tests) · `components/ui/` (design system) · `lib/` (api client, session, formatting,
  validation re-exports) · `content/` (legal and help texts).
- **Rendering:** public pages are server components fetching the public API with short
  revalidation; signed-in areas render shells on the server and fetch on the client with
  TanStack Query (optimistic updates where safe).
- **Session (backend-for-frontend, D-085):** the browser never holds a token. Sign-in answers
  pass through the web server, which turns the tokens into cookies and removes them from the
  answer: the access token `HttpOnly; SameSite=Lax; Path=/` (lapses 30 s before the token), the
  refresh token `HttpOnly; SameSite=Strict; Path=/api`, and a hint cookie with no secret (when the
  access token lapses) that our scripts read to renew just in time, once per tab. `__Host-` /
  `__Secure-` prefixes over HTTPS. The browser calls same-origin `/api/v1/*`, which forwards to
  the gateway with the bearer token and the visitor's address (D-084), renews once when the token
  has lapsed (a concurrent renewal elsewhere answers "retry", never a sign-out), and passes errors
  through in the API's envelope. CSRF: every call needs our custom header, a same-origin `Origin`
  and `Sec-Fetch-Site`; calls that need the refresh token are only reachable through
  `/api/session/*`.
- **Security headers:** CSP with a per-request nonce (`script-src 'self' 'nonce-…'
'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`), built in
  `src/proxy.ts`; styles allow inline (React style attributes and the dialog/toast libraries —
  injected CSS can't run code and no secret lives in the markup). HSTS (no preload until the
  domain is final), `nosniff`, `DENY` framing, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera off except the check-in page, geolocation only for our pages).
- **No tracking cookies.** Only essential cookies (session, theme) → no consent banner needed;
  the cookie policy says exactly this. Any analytics later must be cookieless.
- **Errors:** typed `ApiError` (code, message, request id); one error boundary per area;
  toasts for background failures; never a blank screen.
- **Config:** server-only env (`API_URL`, `SESSION_SECRET`, Google client id, dev-login flag);
  nothing secret is `NEXT_PUBLIC_`.
- **Deploy:** Vercel (root `apps/web`) for previews and production; the API stays on DigitalOcean.

## 5. Backend additions Phase 3 needs

| Need                                                    | Where                             | Why                                                       |
| ------------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| Clean-text rules (§6) on every text field               | `@buku/validation` + all services | Refuse emojis/invisible/control characters everywhere     |
| Favourites (save a business)                            | business-service                  | "Saved" places — the model exists, no API yet             |
| Public platform counts (businesses, cities, categories) | search-service                    | Truthful numbers for the landing page                     |
| Google client id for the web                            | config                            | Google sign-in on the web (you create it in Google Cloud) |

## 6. Clean data (what "no corrupt input" means)

A shared, browser-safe package `@buku/validation` defines the rules once; the API enforces them
(authoritative) and the web uses the same rules for instant feedback.

- **Everywhere:** Unicode normalised; trimmed; repeated spaces collapsed; refused:
  emoji and pictographs (incl. flags, keycaps, skin-tone and variation selectors),
  control characters, invisible/format characters (zero-width spaces, bidirectional overrides
  used for "Trojan source" spoofing, byte-order marks, soft hyphens), private-use and unassigned
  code points. Zero-width joiners only between letters (Urdu, Persian and Indic scripts need them).
- **Names (people):** letters of any script (Urdu, Arabic, Latin, …), combining marks, spaces,
  `. ' -`. **Business, service, category, city names (titles):** plus digits and
  `& , ( ) / + # : !` and the Urdu comma and full stop. Both use NFKC, so styled "fancy" letters
  (𝐁𝐔𝐊𝐔) and full-width ones become ordinary letters instead of being refused.
- **One line (addresses, short notes, references):** a pasted line break becomes a space.
- **Free text (reviews, notes, descriptions):** letters, numbers, punctuation and ordinary
  symbols, line breaks allowed (max 2 in a row); no HTML.
- **Text people didn't type here** (a name from Google/Apple, a phone's device name): what isn't
  allowed is removed rather than refused, so sign-in never fails over it.
- **Structured:** usernames, slugs, phone (E.164), email, codes — exact patterns.
- In the browser: typing an emoji is blocked with a gentle hint ("Emojis can't be used here");
  pasted text is cleaned visibly; the API error, if any, is shown on the field.

(For the record: emojis can't technically corrupt the database — it stores Unicode safely — but
refusing them keeps names, search and printed tickets clean and consistent, so we refuse them.)

The repository itself follows the same rule: `pnpm check:hidden` (CI and pre-commit) refuses
invisible characters in any committed file; code that needs one writes an escape.

## 7. Delivery (PRs, each shippable)

| Step | Delivers                                                                                                                                                             | Done when                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 3.1  | `@buku/validation` + API enforcement; `apps/web` foundation: tokens, fonts, logo, UI kit, layouts, session (BFF), API client, security headers, error pages, CI jobs | kit page renders in light/dark; session round-trip tested; CSP has no violations; CI green |
| 3.2  | Public site: landing, explore, categories, business profile, pricing, for-business, how-it-works, about, help, contact, security, legal, sitemap, OG                 | Lighthouse ≥ 95, axe clean, every page at 320–1920 px                                      |
| 3.3  | Sign-in, two-step, employee sign-in, welcome/onboarding                                                                                                              | Playwright: sign in → welcome → home                                                       |
| 3.4  | Booking flow, tickets, queue join + live ticket, account area, reviews, notifications, settings, billing, favourites                                                 | Playwright: book → receipt → cancel; join queue → called                                   |
| 3.5  | Business area: setup wizard, today, appointments, calendar, check-in, queue board + screen, services, staff, hours, team, reviews, insights, billing, settings       | Playwright: create business → take a booking → check in → complete                         |
| 3.6  | Operator console                                                                                                                                                     | Playwright: verify a business, hide a review (with two-step)                               |
| 3.7  | Polish and proof: accessibility audit, Lighthouse CI budgets, visual pass at all breakpoints, copy review, E2E in CI against the stack                               | all budgets met                                                                            |

## 8. What we need from you (not blocking the start)

- A **Google OAuth web client id** (Google Cloud console) for Google sign-in on the web; until
  then development sign-in is used locally.
- The **domain** (until then `thebuku.vercel.app`), and the Vercel project's root directory set
  to `apps/web`.
- Real **contact addresses** (support@, privacy@, security@) to publish.
- **Legal review** of the legal pages before launch (they are written to match exactly what the
  system does).
