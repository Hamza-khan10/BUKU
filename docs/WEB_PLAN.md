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

### Feeling we design for

Calm control → confident momentum → small celebration. Booking and queueing are usually
stressful (waiting, uncertainty, phone calls). BUKU should feel like the opposite: **"I know
exactly when, and it's handled."**

### Colour (psychology → role)

| Token           | Value                      | Feeling / role                                                                 | Contrast (checked)           |
| --------------- | -------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| `ink`           | `#0E1525`                  | Trust, seriousness, premium; text, dark hero sections                          | 17.2:1 on paper              |
| `paper`         | `#FBF8F3`                  | Warm, calm, unhurried (not clinical white); page background                    | —                            |
| `coral` (brand) | `#D4432A` / text `#B83A22` | Energy and action — the "book / join" moment; primary buttons, the ticket stub | white on it 4.53 · text 5.41 |
| `mint`          | `#0B7350` / bg `#E7F6EF`   | Go, available, confirmed, open now                                             | 5.53 on paper                |
| `amber`         | `#F2A516` / text `#9A5B00` | Anticipation — queue progress, "almost your turn", pending                     | ink on it 8.82 · text 5.12   |
| `indigo`        | `#4338CA`                  | Focus rings and links on dark (clarity, not decoration)                        | 7.46 on paper                |
| `slate`         | `#4B5565` / `#667085`      | Secondary / muted text                                                         | 7.11 / 4.70                  |
| `danger`        | `#B42318`                  | Errors only (red never decorates)                                              | ≥ 5:1                        |

Dark theme: the same roles on an ink canvas (tokens are CSS variables; components never use raw
colours). Coral is the only loud colour, so the eye always finds the next action.

### Type

- **Display:** Bricolage Grotesque — friendly, distinctive, confident headlines.
- **Text:** Inter — legible at every size, all scripts we need for names.
- **Tickets and codes:** a monospace (JetBrains Mono) for `BK-7KQ2MX`, `A-023`, times — tabular
  figures so numbers don't jump while counting down.
- Self-hosted through `next/font` (no requests to font CDNs from visitors' browsers).

### Signature motifs

- **The ticket.** Receipts and queue tickets look like real tickets: a stub with a perforated
  edge, the code large, a QR, a live status band. People already trust paper tickets; we borrow
  that trust.
- **Time as pills.** Free times are tappable pills; the chosen one fills coral; taken ones simply
  aren't there (no greyed-out clutter).
- **Live.** A soft pulsing dot means "this updates by itself" (queue position, open now).
- **The "now" line** on calendars and day views.

### Motion

Short (150–300 ms), purposeful: elements arrive in the order you read them; the ticket "prints"
when a booking is confirmed; the queue position counts down; one modest burst of celebration on
a confirmed booking. Everything is disabled under `prefers-reduced-motion`.

### Voice

Plain, warm, specific. "You're booked — Haircut with Ali, Thu 10:30." Not "Your request was
processed successfully." Errors say what happened and what to do next, never blame. Numbers
before adjectives.

### Logo

A single `Logo` component (mark + wordmark) so the brand stays swappable: a ticket with a check
cut into the stub — booking and queue in one shape.

## 3. Pages (information architecture)

Legend — **Data:** API used. **Auth:** who may open it. Every page has designed loading
(skeletons in the final layout), empty, error (with retry and request id) and offline states.

### 3.1 Public (server-rendered, indexed)

| Route                                  | Purpose                                                                                                                                 | Data                                                                   | Key edge cases                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/`                                    | The pitch + live discovery: search bar, categories, featured, trending, how it works, for business                                      | search featured/trending/categories, billing plans for "Free to start" | no location → city picker; no featured yet → hide section (never fake)                   |
| `/explore`                             | Search with filters (text, near me, open now, has queue, rating, category, date), list + map                                            | `/v1/businesses/search`, `nearby`, `autocomplete`                      | location denied, no results (suggest wider radius), typos, slow network, page beyond end |
| `/categories`, `/c/[slug]`             | All categories; one category's businesses                                                                                               | `/v1/categories`, `/v1/categories/:slug/businesses`                    | hidden/inactive category → 404; empty category                                           |
| `/b/[idOrSlug]`                        | Business profile: photos, rating + reliability, services and prices, team, hours, open now, live queue, reviews, map; Book / Join queue | public profile, services, staff, reviews, queue public, availability   | suspended → 404; unverified → label; no services but queue; no photos; closed today      |
| `/for-business`                        | Why businesses use BUKU: bookings, queue screen, check-in, reminders, insights                                                          | billing plans                                                          | —                                                                                        |
| `/pricing`                             | Real plans for customers and businesses with their benefits                                                                             | `/v1/billing/plans`                                                    | billing off → "Everything is included right now"                                         |
| `/how-it-works`                        | Booking and queue explained step by step                                                                                                | static                                                                 | —                                                                                        |
| `/about`, `/contact`, `/help`          | Who we are; how to reach us; honest FAQ                                                                                                 | static                                                                 | —                                                                                        |
| `/security`                            | Trust page: the real controls (encryption, two-step, audit) in plain words                                                              | static (from SECURITY.md)                                              | —                                                                                        |
| `/legal/*`                             | privacy, terms, business-terms, cookies, acceptable-use, refunds, sub-processors                                                        | static, matching the system (retention, processors)                    | version + effective date on each                                                         |
| `sitemap.xml`, `robots.txt`, OG images | SEO                                                                                                                                     | businesses + categories                                                | suspended businesses excluded                                                            |
| `404`, `500`, offline                  | Designed, helpful                                                                                                                       | —                                                                      | request id shown on 500                                                                  |

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
| `/account/billing`                            | Plan, trial, upgrade                                                                              | billing me, trial, checkout                            |
| `/account/settings`                           | Profile, phone, picture, two-step, sessions/devices, export my data, delete account               | auth me, mfa, sessions, export, delete                 |

Edge cases throughout: slot taken while choosing (refresh times, keep choices), plan limit
(explain + trial), booking limit per business, overlapping booking elsewhere, late cancellation
warning (window), queue too far (distance, retry with location), already in a queue, queue
closed/paused, business suspended mid-flow, session expired mid-flow (resume after sign-in).

### 3.4 Businesses (`/business/...`)

| Route                         | Purpose                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `/business`                   | My businesses (owner or team) + "Add your business"                                               |
| `/business/new`               | Guided setup: profile → location → hours → first service → first team member → publish            |
| `/business/[id]`              | Today: appointments timeline with now-line, queue status, arrivals, quick check-in, real KPIs     |
| `/business/[id]/appointments` | Day view + list, search by code or name, confirm/decline/cancel, complete, no-show                |
| `/business/[id]/calendar`     | Week view per employee                                                                            |
| `/business/[id]/check-in`     | Scan the QR with the camera or type the code                                                      |
| `/business/[id]/queue`        | Front-desk board: call next, serve, done, no-show, walk-ins, priority, pause/close (live)         |
| `/business/[id]/queue/screen` | Full-screen waiting-room display: now serving, next tickets (public data only)                    |
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
- **Session (backend-for-frontend):** sign-in goes through Next.js route handlers which call
  auth-service and set the tokens as `__Host-` cookies: `HttpOnly; Secure; SameSite=Lax`
  (access token, 15 min) and `SameSite=Strict; Path=/api/session` (refresh token). The browser
  never sees a token. Client calls go to same-origin `/api/v1/*`, which forwards to the gateway
  with the bearer token, refreshes once on expiry (rotation race handled), and passes errors
  through. CSRF: mutating requests need a custom header and same-origin `Origin`.
- **Security headers:** CSP with a per-request nonce (`script-src 'nonce-…' 'strict-dynamic'`),
  `frame-ancestors 'none'`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera only on the check-in page, geolocation only where used).
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
