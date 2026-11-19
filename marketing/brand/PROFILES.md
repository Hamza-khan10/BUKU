# Social profiles: what to enter when creating each account

## Accounts that exist (update as they change)

| Platform                  | Handle     | Link                                | Status                                                              |
| ------------------------- | ---------- | ----------------------------------- | ------------------------------------------------------------------- |
| Facebook                  | onbuku     | https://www.facebook.com/onbuku     | Live (2026-11-19)                                                   |
| X                         | @onbukuapp | https://x.com/onbukuapp             | Live (2026-11-19); @onbuku was taken. Display name should be "BUKU" |
| Instagram                 | @onbukuapp | https://www.instagram.com/onbukuapp | Live (2026-11-19); @onbuku was taken                                |
| LinkedIn, TikTok, YouTube | not yet    |                                     | Use onbukuapp (matches X and Instagram)                             |

Mention BUKU as @onbukuapp on X and Instagram, and as onbuku on Facebook. **@onbukuapp is now the
handle to promote**: create LinkedIn, TikTok and YouTube as onbukuapp too, so one name finds BUKU everywhere.

Handle everywhere: **@onbuku**. If one platform has it taken, use **@onbukuapp** there (letters
only, so it's valid everywhere, X included). Never `@buku.app` or `@buku`: buku.app is another
company, and dots aren't allowed on X. Same handle on every platform wherever possible.
Display name: **BUKU**. Email: the official address (hello@onbuku.com). Phone: the BUKU SIM.
Two-step sign-in with an authenticator app on every account. Profile picture: `exports/profile-1080.png`.

## Bios (checked against each platform's limit on 2026-11-20)

**Instagram** (@onbukuapp, Business account, category "App page")

- Name (searchable, 30 max): `BUKU · Book & Queue`
- Bio (136/150):
  ```
  Book the time. Skip the wait.
  Book appointments or join walk-in queues from your phone. Free for you.
  Opening city by city. Join early ↓
  ```
- Link: `https://onbuku.com/early-access?source=instagram`

**Facebook** (onbuku, Page, category "App page" or "Software"; cover `exports/facebook-cover-1640x624.png`)

- Bio / Intro (94/101): `Book appointments and join walk-in queues from your phone. Free for you. Opening city by city.`
- Website: `https://onbuku.com/early-access?source=facebook`

**X** (@onbukuapp; header `exports/x-header-1500x500.png`; display name `BUKU`)

- Bio (139/160): `Book the time. Skip the wait. Appointments and walk-in queues for barbers, clinics, salons and more, from your phone. Opening city by city.`
- Website: `https://onbuku.com/?source=x`; location: leave empty

**TikTok** (onbukuapp, Business account; the website link may need 1,000 followers)

- Bio (69/80): `Skip the wait. Book or join the queue from your phone. Opening soon ↓`
- Link: `https://onbuku.com/early-access?source=tiktok`

**LinkedIn** (company page onbukuapp; cover `exports/linkedin-cover-1128x191.png`; industry "Software Development")

- Tagline (91/120): `Bookings and walk-in queues for local businesses, from the phone in your customer's pocket.`
- About (642/2000):
  ```
  BUKU takes bookings and runs walk-in queues for barbers, clinics, salons, offices and 116 kinds of place.

  People book a time from real availability, or take their place in a walk-in queue from their phone, and arrive when it's their turn. Booking and queueing are always free for them.

  Businesses get bookings from their real hours, a live queue display, check-in by code, reminders before each visit, team logins and their own page. Starter is free; every business can try Professional free for 30 days.

  BUKU is opening city by city. Businesses can join the early-access list at https://onbuku.com/early-access?as=business&source=linkedin
  ```
- Website: `https://onbuku.com/?source=linkedin`

**YouTube** (@onbukuapp; banner `exports/youtube-banner-2560x1440.png`)

- Description (364/1000):
  ```
  BUKU takes bookings and runs walk-in queues for barbers, clinics, salons, offices and more. People book a time or take their place in line from their phone, for free, and arrive when it's their turn.

  Here: how BUKU works, and practical tips for running a calmer front desk.

  BUKU is opening city by city. Join early: https://onbuku.com/early-access?source=youtube
  ```
- Link: `https://onbuku.com/?source=youtube`

After creating them, send the profile links: they go into the website's structured data
(`lib/brand.ts`, PROFILES on `main`) so search engines tie them to onbuku.com.
