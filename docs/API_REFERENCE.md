# API reference

Base URL: `http://localhost:8000` locally (Kong gateway); production URL decided with the domain.
All bodies are JSON. Unknown body fields are rejected with `400 VALIDATION_ERROR`.

Every response uses one envelope:

```json
{ "success": true, "data": { … }, "meta": { … } }
{ "success": false, "error": { "code": "SESSION_REVOKED", "message": "…", "details": { … }, "requestId": "…" } }
```

Clients branch on `error.code`, never on `message`. Send `X-Request-ID` to correlate with server logs.

**Text fields** follow the clean-text rules (D-083, `@buku/validation`): HTML is stripped; text is
normalised (trimmed, spaces collapsed); emoji, invisible and control characters are refused with
`400 VALIDATION_ERROR` and a readable message on the field. Person names accept letters of any
script and `. ' -`; names of businesses, services, categories and cities also digits and
`& , ( ) / + # : !`; one-line fields turn a line break into a space; free text (reviews,
descriptions) keeps up to two line breaks in a row. Length limits apply after cleaning.
The request/response contracts are defined in each service's `src/routes/schemas.ts`
(OpenAPI generation from those Zod schemas is added with the web app in Phase 3).

## Authentication model

- **Access token** — JWT (RS256), 15 minutes. Send as `Authorization: Bearer <accessToken>`.
- **Refresh token** — opaque, single-use. Exchange at `POST /v1/auth/refresh` for a new pair
  (the old one stops working). Sessions last until the user logs out; they expire only after
  180 days without use (24 hours for platform admins).
- When a session is ended server-side, requests fail with `401 SESSION_REVOKED` and
  `details.reason` tells the app what to show:

| `reason`                                | Show the user                                      |
| --------------------------------------- | -------------------------------------------------- |
| `password_changed`                      | "Your password was changed. Please sign in again." |
| `logged_out_everywhere`                 | "You were signed out of all devices."              |
| `revoked_by_user`                       | "This device was signed out from another device."  |
| `reuse_detected`                        | "For your security, please sign in again."         |
| `expired` / `logged_out`                | Normal sign-in screen                              |
| `account_suspended` / `account_deleted` | Account status message                             |

- **Gateway rejections** (missing/forged/expired token on a protected route) are answered by
  the gateway itself as `401 {"message": "Unauthorized" | "Invalid signature" | …}` — not the
  envelope. Client rule for ANY `401`: try `POST /v1/auth/refresh` once, then show sign-in.
- `401 TOKEN_EXPIRED` → refresh and retry. `401 TOKEN_INVALID` with `details.reason = "superseded"`
  on refresh → another request already rotated the token; use the newest one you have.

## Auth service — `/v1/auth`

| Method & path                                                            | Auth | Rate limit | Purpose                                                         |
| ------------------------------------------------------------------------ | ---- | ---------- | --------------------------------------------------------------- |
| `POST /oauth/google`                                                     | —    | 10/min/IP  | Sign in or sign up with a Google ID token                       |
| `POST /oauth/apple`                                                      | —    | 10/min/IP  | Sign in with Apple — **locked**: `403 FEATURE_DISABLED`         |
| `POST /dev/login`                                                        | —    | 10/min/IP  | **Development only** (404 elsewhere): sign in as any email/role |
| `POST /business-login`                                                   | —    | 10/min/IP  | Employee account sign-in: business + username + password        |
| `POST /password`                                                         | ✔    | 30/min     | Change my password → every device signs out, this one included  |
| `POST /refresh`                                                          | —    | 60/min/IP  | Rotate the refresh token, get a new access token                |
| `POST /logout`                                                           | —    | 60/min/IP  | End this device's session → `204`                               |
| `POST /logout-all`                                                       | ✔    | 30/min     | End every session on every device → `204`                       |
| `GET /sessions`                                                          | ✔    | —          | My signed-in devices                                            |
| `DELETE /sessions/:id`                                                   | ✔    | 30/min     | Sign out one of my devices → `204` (`404` if not mine)          |
| `GET /me`                                                                | ✔    | —          | My account                                                      |
| `PATCH /me`                                                              | ✔    | 30/min     | Update name / timezone / locale                                 |
| `PUT /me/phone`                                                          | ✔    | 30/min     | Set my phone number + WhatsApp consent                          |
| `POST /me/avatar/uploads` → `POST /me/avatar/uploads/:uploadId/complete` | ✔    | 30/min     | My profile picture (private: only I see it)                     |
| `DELETE /me/avatar`                                                      | ✔    | 30/min     | Remove my profile picture (also the one from Google)            |
| `POST /push-tokens`                                                      | ✔    | 30/min     | Register this device for push → `204`                           |
| `DELETE /push-tokens/:token`                                             | ✔    | 30/min     | Unregister a device → `204` (`404` if not mine)                 |

### `POST /v1/auth/oauth/google`

```json
{
  "idToken": "<Google ID token from Google Identity Services / the mobile SDK>",
  "acceptedTermsVersion": "1.0",
  "device": { "name": "Ayesha's iPhone", "platform": "ios" },
  "timezone": "Asia/Karachi",
  "locale": "en"
}
```

`acceptedTermsVersion` is required only when the account is new; otherwise `422 TERMS_NOT_ACCEPTED`
with `details.termsVersion` (show the consent screen, then retry). Response `201` (new account) or
`200` (existing):

```json
{
  "user": {
    "id": "…",
    "name": "Ayesha Khan",
    "email": "ayesha@gmail.com",
    "phone": null,
    "whatsappOptIn": false,
    "avatarUrl": "https://…",
    "timezone": "Asia/Karachi",
    "locale": "en",
    "role": "user",
    "createdAt": "…",
    "onboarding": { "phoneRequired": true }
  },
  "isNewUser": true,
  "accessToken": "…",
  "accessTokenExpiresAt": "…",
  "refreshToken": "…",
  "refreshTokenExpiresAt": "…",
  "sessionId": "…"
}
```

Errors: `401 OAUTH_TOKEN_INVALID` (bad/expired/foreign token, or email not verified by Google),
`403 ACCOUNT_SUSPENDED` — if `details.reason` is `account_deleted` with `canRestore: true`, the
account is scheduled for deletion on `details.purgeAfter`: offer "Restore my account" and resend
the same request with `"restoreAccount": true`, `403 FEATURE_DISABLED` (Google client id not configured), `429 RATE_LIMITED`.

When `onboarding.phoneRequired` is `true`, the app must collect a phone number (`PUT /me/phone`)
before booking.

### `POST /v1/auth/refresh` · `POST /v1/auth/logout`

```json
{ "refreshToken": "…" }
```

Refresh returns the same token fields as sign-in (without `user`). Store the NEW refresh token
immediately — the one you sent is now used up. Logout always answers `204`.

### `PATCH /v1/auth/me`

```json
{ "name": "Ayesha Khan", "timezone": "Asia/Karachi", "locale": "en" }
```

At least one field. HTML is stripped from `name`. Fields like `role` are rejected (`400`).

### `PUT /v1/auth/me/phone`

```json
{ "phone": "+923001234567", "whatsappOptIn": true }
```

E.164 format only. The number is stored encrypted and marked unverified until phone
verification exists; the most recently entered number is the one used for notifications.

### `POST /v1/auth/push-tokens`

```json
{ "token": "<FCM / APNs token>", "platform": "android" }
```

### `GET /v1/auth/me/export`

Returns (as a `Content-Disposition: attachment` JSON download) everything BUKU holds about the
signed-in person: account, sign-in methods, devices, notification preferences, appointments
(without the business's internal notes), reviews, favourites, queue history, notifications and
their security log. Format id: `buku-data-export/1`.

### `DELETE /v1/auth/me`

```json
{ "confirmation": "DELETE", "reason": "optional feedback" }
```

Requires that this session signed in within the last 10 minutes, otherwise
`403 REAUTH_REQUIRED` (sign in again, then retry). Response `202`:

```json
{ "status": "scheduled", "purgeAfter": "2026-10-30T12:00:00.000Z" }
```

Immediately: every device is signed out (`SESSION_REVOKED` / `account_deleted`), push
notifications stop, and other services are told (`users.deleted`): booking-service cancels every
visit still to come (as the customer, so the business is told; ones they've arrived for stay), and
queue-service gives up their places in line (`queue.entry.left`, reason `account_closed`). A
restored account's bookings stay cancelled.
Until `purgeAfter` the person can restore the account by signing in (see above). After it,
personal data is erased for good; appointment records remain for the businesses, anonymized.

### Employee accounts (D-034)

A business creates sign-ins for its staff phones and shared tablets. They sign in with the
business handle (the slug in its BUKU link), a username and a password:

```json
POST /v1/auth/business-login
{ "business": "fade-masters-lahore", "username": "ali", "password": "<the temporary or own password>" }
```

The response is the same as any sign-in. `user.account` tells the app what kind of account it is:

```json
{ "type": "employee", "businessId": "…", "username": "ali", "mustChangePassword": true }
```

- **`mustChangePassword: true`** — the account is on the temporary password the business gave
  out. It has **no business access** until the employee picks their own via
  `POST /v1/auth/password` `{ "currentPassword", "newPassword" }`. The app should show only that
  screen.
- A password change returns `{ "signInAgain": true }` and ends **every** session of the account,
  including the current one; the app signs in again with the new password.
- Wrong business, username or password all return the same `401 INVALID_CREDENTIALS`.
- 5 wrong passwords in a row lock sign-in for 15 minutes (`429 ACCOUNT_LOCKED`,
  `details.retryAfterSeconds`). The owner or a manager can unlock at once by resetting the password.
- Access turned off by the business → `403 ACCOUNT_SUSPENDED` (only shown after a correct password).
- Employee accounts can't register a business or delete themselves; the business removes them.

### A business's team — `/v1/businesses/:id/members`

Served by auth-service. Requires `members.manage` (owner, manager). Managers create and manage
**front desk and staff only**; nobody changes their own access here.

| Method & path                            | Purpose                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /members`                           | Team list: role, status, username, `passwordChangePending`, `locked`, last sign-in                           |
| `POST /members`                          | `{ "name", "username", "role": "manager" \| "front_desk" \| "staff" }` → `201 { member, temporaryPassword }` |
| `PATCH /members/:memberId`               | `{ "name"?, "role"?, "status"?: "active" \| "disabled" }`; turning off ends the employee's sessions          |
| `POST /members/:memberId/reset-password` | New temporary password (also unlocks); ends the employee's sessions                                          |
| `DELETE /members/:memberId`              | Remove: the employee account is closed and the username is free again → `204`                                |

The temporary password is returned **once** and never stored in clear: hand it to the employee
in person. Usernames: 3–40 characters (letters, digits, `.`, `_`, `-`), case-insensitive,
unique within the business (`409 USERNAME_TAKEN`). How many active team logins a business has depends on its plan (`409 PLAN_LIMIT_REACHED`); turning an account off frees its place, turning it back on uses one.

## Business service — `/v1/businesses`, `/v1/admin`

Roles inside a business: **owner** (whoever registered it) and members with **manager**,
**front desk** or **staff** roles. What each role may do is defined once in
`packages/common/src/authz.ts`. Someone with no role in a business gets `404` for its private
endpoints (we don't confirm what they can't manage); a role without the permission gets `403`.

| Method & path                                                                                       | Auth | Who                                        | Purpose                                                               |
| --------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------ | --------------------------------------------------------------------- |
| `POST /v1/businesses`                                                                               | ✔    | anyone signed in (5/hour, max 5 per owner) | Register a business → `201`, status `pending`, **not verified**       |
| `GET /v1/businesses/mine`                                                                           | ✔    | —                                          | Businesses I own or work at, with `myRole`                            |
| `GET /v1/businesses/:idOrSlug`                                                                      | —    | public                                     | Public profile (pending + verified only)                              |
| `GET /v1/businesses/:id/manage`                                                                     | ✔    | any team role                              | Private view: status, rejection reason, settings                      |
| `PATCH /v1/businesses/:id`                                                                          | ✔    | owner, manager                             | Edit profile                                                          |
| `PUT /v1/businesses/:id/hours`                                                                      | ✔    | owner, manager                             | Replace weekly opening hours                                          |
| `POST /v1/businesses/:id/reports`                                                                   | ✔    | anyone but the owner (once)                | Report a business                                                     |
| `GET /v1/admin/businesses?status=`                                                                  | ✔    | super_admin                                | Review queue (oldest first)                                           |
| `POST /v1/admin/businesses/:id/verify` · `/reject` · `/suspend` · `/reinstate`                      | ✔    | super_admin                                | Moderation (reject/suspend need `{ "reason" }`)                       |
| `GET /v1/admin/business-reports` · `POST /v1/admin/business-reports/:id/resolve`                    | ✔    | super_admin                                | Handle reports                                                        |
| `GET /v1/businesses/:id/verification`                                                               | ✔    | any team role                              | Verification checklist: what's still missing                          |
| `GET` · `PUT /v1/businesses/:id/legal-profile`                                                      | ✔    | owner                                      | Legal/registration details (identifiers masked in responses)          |
| `POST /v1/businesses/:id/documents/uploads` → `POST …/documents/:docId/complete`                    | ✔    | owner                                      | Upload a verification document (private)                              |
| `GET /v1/businesses/:id/documents` · `DELETE …/documents/:docId`                                    | ✔    | owner                                      | List / remove (approved ones are kept)                                |
| `POST /v1/businesses/:id/photos/uploads` → `POST …/photos/uploads/:uploadId/complete`               | ✔    | owner, manager                             | Add a gallery photo (cleaned; the first is the cover)                 |
| `POST …/photos/:photoId/primary` · `DELETE …/photos/:photoId`                                       | ✔    | owner, manager                             | Choose the cover / remove                                             |
| `POST /v1/businesses/:id/logo/uploads` → `POST …/logo/uploads/:uploadId/complete` · `DELETE …/logo` | ✔    | owner, manager                             | Business logo                                                         |
| `POST /v1/businesses/:id/staff/:staffId/photo/uploads` → `…/uploads/:uploadId/complete`             | ✔    | owner, manager                             | Employee photo; needs `"consentConfirmed": true`                      |
| `DELETE /v1/businesses/:id/staff/:staffId/photo`                                                    | ✔    | owner, manager, **or that employee**       | Remove an employee photo                                              |
| `GET /v1/admin/businesses/:id/review`                                                               | ✔    | super_admin                                | Checklist + decrypted legal details + documents with 5-min view links |
| `POST /v1/admin/business-documents/:id/review`                                                      | ✔    | super_admin                                | `{ "decision": "approved" \| "rejected", "note"? }`                   |
| `POST /v1/admin/business-exports`                                                                   | ✔    | super_admin (10/day)                       | Lawful per-country export (see below)                                 |

### `POST /v1/businesses`

```json
{
  "name": "Fade Masters",
  "categoryId": "…",
  "description": "Classic cuts and hot-towel shaves.",
  "phone": "+924235550000",
  "email": "hello@fademasters.pk",
  "website": "https://fademasters.pk",
  "address": "12 Main Boulevard, Gulberg",
  "city": "Lahore",
  "state": "Punjab",
  "country": "PK",
  "postalCode": "54000",
  "lat": 31.5204,
  "lng": 74.3587,
  "timezone": "Asia/Karachi",
  "currency": "PKR",
  "acceptedBusinessTermsVersion": "1.0"
}
```

`country` is an ISO 3166-1 code, `currency` ISO 4217, `timezone` IANA; websites must be `https://`.
HTML is stripped from text. Errors: `422 TERMS_NOT_ACCEPTED`, `409 PLAN_LIMIT_REACHED`.

**Verification lifecycle:** `pending` → (admin) `verified` or `rejected`. Changing the name,
category or address of a verified business sends it back to `pending` (it's what was verified).
A rejected business is resubmitted by fixing its details. `suspended` businesses are hidden
from the public and read-only for their team (`403 BUSINESS_SUSPENDED`).

### Public profile

```json
{
  "id": "…",
  "slug": "fade-masters-lahore",
  "name": "Fade Masters",
  "category": { "id": "…", "name": "Barbershop", "slug": "barbershop" },
  "contact": { "phone": "+924235550000", "email": null, "website": "https://fademasters.pk" },
  "address": { "line": "…", "city": "Lahore", "state": null, "country": "PK", "postalCode": null },
  "location": { "lat": 31.5204, "lng": 74.3587 },
  "timezone": "Asia/Karachi",
  "currency": "PKR",
  "verification": { "status": "not_verified", "label": "Not verified by BUKU", "verifiedAt": null },
  "rating": { "average": 4.5, "count": 12 },
  "hours": [{ "dayOfWeek": 1, "openTime": "09:00", "closeTime": "13:00" }],
  "logoUrl": "https://…/businesses/…/logo/….webp",
  "photos": [{ "id": "…", "url": "https://…", "altText": "Front of the shop", "isPrimary": true }],
  "team": [{ "id": "…", "displayName": "Ali Raza", "photoUrl": "https://…" }]
}
```

`team` lists active employees; `photoUrl` is `null` unless the business added a photo. Picture
links are permanent CDN links in production and 1-hour signed links in development.

Apps must show the `verification.label` badge on unverified businesses (D-032).

### `PUT /v1/businesses/:id/hours`

```json
{
  "hours": [
    { "dayOfWeek": 1, "openTime": "09:00", "closeTime": "13:00" },
    { "dayOfWeek": 1, "openTime": "14:00", "closeTime": "18:00" }
  ]
}
```

`dayOfWeek` 0 = Sunday … 6 = Saturday, local time of the business. Days not listed are closed;
overlapping or inverted intervals are rejected.

### Verification requirements

`POST /v1/admin/businesses/:id/verify` succeeds only when the checklist is complete, otherwise
`409 VERIFICATION_REQUIREMENTS_NOT_MET` with `details.missing`:

- `legal_profile` — legal/registration details submitted
- `approved_document` — at least one document approved by an admin
- `medical_license` — additionally, for categories under **Health & Medical**

### `PUT /v1/businesses/:id/legal-profile` (owner)

```json
{
  "legalName": "Fade Masters (Private) Limited",
  "registrationCountry": "PK",
  "registrationType": "SECP company",
  "registrationNumber": "0123456-78",
  "taxId": "1234567-8",
  "registeredAddress": "12 Main Boulevard, Gulberg, Lahore",
  "responsiblePerson": { "name": "Ayesha Khan", "role": "Director", "email": "…", "phone": "+92…" }
}
```

`registrationType` is free text because every country has its own scheme ("NTN", "Companies
House", "EIN", "Trade licence"…). Identifiers are stored encrypted and returned masked
(`••••5678`). Changing the legal name, number or country of a verified business sends it back
to review (`reverificationRequired: true`).

### Uploading a document (3 steps)

1. `POST …/documents/uploads` `{ "type": "business_license", "contentType": "application/pdf", "sizeBytes": 183201 }`
   → `201 { "documentId", "upload": { "method": "PUT", "url", "headers", "expiresAt" } }`
2. The app sends the file itself **directly to `upload.url`** with exactly `upload.headers`
   (the link is valid 10 minutes, for this one file, type and size only).
3. `POST …/documents/:documentId/complete` → the server checks the file really arrived, has the
   declared size and is genuinely a PDF/JPEG/PNG (file signature), then marks it `pending` review.
   Anything else is deleted and refused (`400 FILE_TYPE_NOT_ALLOWED`, `409 UPLOAD_NOT_FOUND`).

Documents: PDF, JPEG, PNG up to 25 MB, max 20 per business. Kept exactly as uploaded (evidence).

### Uploading a picture (gallery photo, logo, employee photo, profile picture)

Same three steps, with an `uploadId`:

1. `POST …/uploads` `{ "contentType": "image/jpeg", "sizeBytes": 2483011 }` (plus `altText` for
   gallery photos, `"consentConfirmed": true` for employee photos)
   → `201 { "uploadId", "upload": { "method": "PUT", "url", "headers", "expiresAt" } }`
2. `PUT` the file to `upload.url` with exactly `upload.headers` (10 minutes, this file only).
3. `POST …/uploads/:uploadId/complete` → the picture is checked (size, real file type), then
   **cleaned**: turned upright, every hidden detail removed (GPS position, camera, names),
   resized and saved as WebP. Only the cleaned copy is ever shown; the original is deleted.

JPEG, PNG or WebP up to 10 MB and 40 megapixels. An `uploadId` works once, only for the
business (or person) it was requested for, and for 30 minutes. Completing before the file has
arrived returns `409 UPLOAD_NOT_FOUND` and can be retried. Gallery: max 20 photos.

**Employee photos** are optional and the business's choice. The uploader confirms the employee
agreed (`consentConfirmed`); the employee can remove their own photo, and it is deleted
automatically when they leave the team.

### `POST /v1/admin/business-exports`

```json
{ "country": "PK", "reference": "SECP/2026/0042", "legalBasis": "Written request from … under …" }
```

Returns every business in that country with decrypted legal details (JSON attachment). The
admin, reference, legal basis and row count are written to the audit log. Use only for
requests that have gone through the legal process (docs/DECISIONS.md D-033).

## Booking service — menu, staff and schedules (2.3 part 1)

All under `/v1/businesses/:id/…`. Public pages accept the business's id **or slug**.

| Method & path                                                       | Auth | Who                                  | Purpose                                                                 |
| ------------------------------------------------------------------- | ---- | ------------------------------------ | ----------------------------------------------------------------------- |
| `GET /:idOrSlug/services`                                           | —    | anyone                               | The menu: active services by category, plus booking terms (cached 60 s) |
| `GET /:idOrSlug/staff`                                              | —    | anyone                               | Active staff: name, bio, photo, services they do (cached 60 s)          |
| `GET /:id/services/manage` · `GET /:id/staff/manage`                | ✔    | any team role                        | Same, archived/inactive included                                        |
| `POST /:id/service-categories` · `PATCH`/`DELETE …/:categoryId`     | ✔    | owner, manager                       | Categories (deleting keeps the services, uncategorized)                 |
| `POST /:id/services` · `PATCH …/:serviceId` · `DELETE …/:serviceId` | ✔    | owner, manager                       | Services; `DELETE` archives (history keeps pointing at it)              |
| `POST /:id/staff` · `PATCH …/:staffId` · `DELETE …/:staffId`        | ✔    | owner, manager                       | Staff profiles; `DELETE` deactivates                                    |
| `GET`/`PUT /:id/staff/:staffId/hours`                               | ✔    | owner, manager, **or that employee** | Weekly working hours                                                    |
| `GET`/`POST /:id/staff/:staffId/time-off` · `DELETE …/:entryId`     | ✔    | owner, manager, **or that employee** | Days off, part of a day off, extra hours                                |
| `GET`/`POST /:id/closures` · `DELETE …/:closureId`                  | ✔    | owner, manager (list: any team role) | Whole business closed (public holiday)                                  |
| `GET`/`PUT /:id/booking-settings`                                   | ✔    | owner, manager (read: any team role) | How bookings work here                                                  |

### Services

```json
POST /v1/businesses/:id/services
{ "name": "Skin fade", "categoryId": "…", "durationMinutes": 45, "bufferMinutes": 10, "price": 1200, "staffIds": ["…"] }
```

`price` has at most 2 decimals and is always in the business's currency (returned as a string,
`"1200.00"`, never through floating point). `bufferMinutes` is clean-up time after the service,
used for availability, never shown to customers. Unknown fields (e.g. `currency`) are refused.

### Staff profiles

```json
POST /v1/businesses/:id/staff
{ "displayName": "Ali Raza", "bio": "Fades & beards", "specializations": ["Fades"], "userId": "…", "serviceIds": ["…"] }
```

`userId` links the profile to a team account (the owner or a member, also one still on a
temporary password), once per business. A linked person manages their own hours and time off.
When someone is removed from the team, their profile is deactivated automatically
(`businesses.member_removed`).

### Working hours and time off

```json
PUT /v1/businesses/:id/staff/:staffId/hours
{ "days": [{ "dayOfWeek": 1, "ranges": [{ "start": "09:00", "end": "13:00" }, { "start": "14:00", "end": "18:00" }] }] }
```

Replaces the whole week; days not listed are days off. `dayOfWeek` 0 = Sunday. Up to 4 ranges a
day, no overlaps. Times are in the business's timezone.

```json
POST /v1/businesses/:id/staff/:staffId/time-off
{ "from": "2026-10-20", "to": "2026-10-24", "reason": "Eid holidays" }      // whole days
{ "from": "2026-10-06", "startTime": "13:00", "endTime": "15:00" }          // part of a day
{ "kind": "extra_hours", "from": "2026-10-07", "startTime": "18:00", "endTime": "21:00" }
```

Dates are in the business's timezone, never in the past, up to 62 days at once.

### Booking settings

| Field                          | Default     | Range                                                       |
| ------------------------------ | ----------- | ----------------------------------------------------------- |
| `confirmationMode`             | `automatic` | `automatic` · `manual` (the business approves each booking) |
| `bookingHorizonDays`           | 365         | 1–1825                                                      |
| `maxFutureBookingsPerCustomer` | 3           | 1–20                                                        |
| `cancellationWindowHours`      | 12          | 0–168 (later = late cancel)                                 |
| `minNoticeMinutes`             | 60          | 0–10080                                                     |
| `slotStepMinutes`              | 15          | 5, 10, 15, 20, 30, 60                                       |

## Booking service — availability and appointments (2.3 part 2)

| Method & path                                                               | Auth | Who                        | Purpose                                                     |
| --------------------------------------------------------------------------- | ---- | -------------------------- | ----------------------------------------------------------- |
| `GET /v1/businesses/:idOrSlug/availability?serviceId=&date=&days=&staffId=` | —    | anyone (60/min)            | Free start times, 1–14 days                                 |
| `POST /v1/appointments`                                                     | ✔    | customers (20/hour)        | Book → `201` with the receipt                               |
| `GET /v1/appointments?scope=upcoming\|past&page=&limit=`                    | ✔    | the customer               | My receipts                                                 |
| `GET /v1/appointments/:id`                                                  | ✔    | the customer               | One receipt (`404` for anyone else)                         |
| `POST /v1/appointments/:id/cancel`                                          | ✔    | the customer               | `{ "reasonCode", "note"?, "bookLater"? }`                   |
| `POST /v1/appointments/:id/reschedule`                                      | ✔    | the customer               | `{ "startAt", "staffId"? }`, before the cancellation window |
| `GET /v1/businesses/:id/appointments?date=&staffId=&status=&q=`             | ✔    | team (staff: own only)     | The day's list, or search by code / customer name           |
| `GET /v1/businesses/:id/appointments/:appointmentId`                        | ✔    | team (staff: own only)     | One appointment                                             |
| `POST …/appointments/:appointmentId/confirm` · `/decline`                   | ✔    | owner, manager, front desk | Manual approval                                             |
| `POST …/appointments/:appointmentId/cancel`                                 | ✔    | owner, manager, front desk | `{ "reason" }` (counts against the business)                |

### Availability

```json
GET /v1/businesses/noor-beauty-lounge-lahore/availability?serviceId=…&date=2026-10-04&days=1
{ "timezone": "Asia/Karachi", "serviceId": "…", "durationMinutes": 45,
  "days": [{ "date": "2026-10-04", "slots": [
    { "startAt": "2026-10-04T05:00:00.000Z", "endAt": "2026-10-04T05:45:00.000Z", "time": "10:00", "staffIds": ["…", "…"] }
  ] }] }
```

Times come from each employee's working hours and extra hours, minus time off, closures and
existing appointments (with their clean-up time), between the minimum notice and the booking
horizon, every `slotStepMinutes`. Daylight-saving changes are handled. Never cached.

### Booking

```json
POST /v1/appointments
{ "businessId": "…", "serviceId": "…", "staffId": "…", "startAt": "2026-10-04T05:00:00.000Z", "notes": "Please use a round brush" }
```

`startAt` must be one of the offered times. Leave out `staffId` for "anyone": the person with
the fewest bookings that day. Automatic businesses confirm at once; manual ones leave it
`pending` until the business confirms or declines.

| Error                                                       | When                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `409 SLOT_UNAVAILABLE`                                      | The time isn't offered, or someone just took it                   |
| `409 APPOINTMENT_OVERLAP`                                   | The customer already has an appointment then, anywhere (D-036)    |
| `409 LIMIT_REACHED`                                         | Already at this business's limit of upcoming bookings (default 3) |
| `422 SLOT_IN_PAST` · `SLOT_TOO_SOON` · `SLOT_TOO_FAR_AHEAD` | Outside "now + notice … horizon"                                  |
| `403 BOOKING_NOT_ALLOWED`                                   | Employee accounts can't book                                      |

### The receipt (D-057)

```json
{
  "id": "…",
  "code": "BK-YQR924",
  "qr": "BK-YQR924",
  "status": "confirmed",
  "business": {
    "name": "Noor Beauty Lounge",
    "address": { "line": "5 Gulberg", "city": "Lahore" },
    "phone": null
  },
  "service": { "name": "Blow-dry", "durationMinutes": 45 },
  "staff": { "displayName": "Hina" },
  "startAt": "…",
  "endAt": "…",
  "local": { "date": "2026-10-04", "startTime": "10:00", "endTime": "10:45", "timezone": "Asia/Karachi" },
  "price": "2500.00",
  "currency": "PKR",
  "payment": "pay_at_venue",
  "policy": { "canCancel": true, "canReschedule": true, "freeCancellationUntil": "…" },
  "cancellation": null
}
```

The app draws a QR code from `qr` (only the code, never personal data) and shows it with the
code in large letters. Nothing is generated or stored: the receipt is the appointment itself.
The business sees the same appointment in its list with the customer's **name only** (no contact
details, no picture) and finds it by scanning, by typing the code, or by the customer's name.

Cancelling after `freeCancellationUntil` is a late cancellation (it affects the customer's
reliability, 2.8). `bookLater: true` schedules a "book again?" reminder. Rescheduling creates a
new appointment with a new code; the old one becomes `rescheduled`.

## Booking service — at the venue and employee shifts (2.3 part 3)

| Method & path                                                              | Who                                             | Purpose                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /v1/businesses/:id/check-in` `{ "code" }`                            | owner, manager, front desk; staff for their own | Scan or type the receipt code (any case)                                  |
| `POST …/appointments/:appointmentId/check-in`                              | same                                            | Check in from the list (customer without a phone)                         |
| `POST …/appointments/:appointmentId/complete`                              | same                                            | Visit done (from its start time) → `bookings.completed`                   |
| `POST …/appointments/:appointmentId/no-show`                               | same                                            | Didn't come (after the grace period, default 15 min) → `bookings.no_show` |
| `POST /v1/businesses/:id/staff/:staffId/attendance/check-in` `{ "note"? }` | the employee; owner, manager, front desk        | Clock in                                                                  |
| `POST …/staff/:staffId/attendance/check-out`                               | same                                            | Clock out                                                                 |
| `GET /v1/businesses/:id/attendance?date=&staffId=`                         | team (employees: own shifts)                    | Shifts that started on a date, with minutes worked                        |
| `GET /v1/businesses/:id/attendance/present`                                | any team role                                   | Who is in right now                                                       |
| `PATCH /v1/businesses/:id/attendance/:shiftId`                             | owner, manager                                  | Correct a shift (audited)                                                 |

**Check-in** opens 2 hours before the start and closes when the appointment ends. Scanning twice
is harmless. A request still `pending` (manual approval) is approved by checking in (front desk,
manager or owner). The appointment stays `confirmed` with `checkedInAt` set; from then on it can
only be completed — the customer can't cancel or move it, nor can the business cancel it.
A code from another business is "not found". Employees (staff role) only handle their own
customers.

**Shifts:** one open shift per person (`409` on a second clock-in, even from two devices at
once). Clocking out after more than 24 hours is refused — a manager corrects the shift instead.
Attendance doesn't change bookable times; those come from working hours.

## Queue service — the virtual queue (2.4 part 1)

| Method & path                                                              | Auth | Who                         | Purpose                                                                                |
| -------------------------------------------------------------------------- | ---- | --------------------------- | -------------------------------------------------------------------------------------- |
| `GET /v1/queue/public/:idOrSlug`                                           | —    | anyone                      | Open or not, how many waiting, tickets called / being served, wait estimate (no names) |
| `POST /v1/queue/join` `{ businessId, lat, lng }`                           | ✔    | customers (10/hour)         | Join from the phone → `201` ticket                                                     |
| `GET /v1/queue/my-ticket`                                                  | ✔    | the customer                | My live ticket anywhere, or `null`                                                     |
| `GET /v1/queue/tickets/:id` · `POST …/leave`                               | ✔    | the customer                | A ticket (`404` for anyone else) · leave the line                                      |
| `GET /v1/businesses/:id/queue`                                             | ✔    | any team role               | The front desk's screen: waiting (in order), called, being served, staff on shift      |
| `POST …/queue/open` · `/pause` · `/resume` · `/close`                      | ✔    | owner, manager, front desk  | Today's queue; pause = no new remote joins                                             |
| `POST …/queue/walk-ins` `{ name?, priority? }`                             | ✔    | owner, manager, front desk  | Someone at the counter (also while paused)                                             |
| `POST …/queue/call-next`                                                   | ✔    | owner, manager, front desk  | Priority lane first, then by ticket                                                    |
| `POST …/queue/entries/:entryId/call` · `/serve` · `/complete` · `/no-show` | ✔    | owner, manager, front desk  | Per ticket; no-show only after the grace period                                        |
| `PUT …/queue/entries/:entryId/priority` `{ priority }`                     | ✔    | owner, manager, front desk  | Move a waiting ticket into or out of the priority lane                                 |
| `GET`/`PUT …/queue/settings`                                               | ✔    | owner, manager (read: team) | Distance, size, grace, ticket letters, starting estimate                               |

### The ticket (D-057)

```json
{
  "id": "…",
  "ticket": "A-023",
  "qr": "A-023",
  "status": "waiting",
  "business": { "id": "…", "name": "NADRA Centre Gulberg", "slug": "…" },
  "ahead": 3,
  "estimatedWaitMinutes": 15,
  "priority": false,
  "joinedAt": "…",
  "calledAt": null,
  "comeBy": null,
  "servedAt": null
}
```

The app shows the ticket number large, with a QR of it. When called, `comeBy` says until when the
customer should reach the counter (the grace period, default 5 minutes). The estimate shares the
people ahead among the staff clocked in and uses the day's real average service time.

**Joining:** only within `remoteJoinRadiusMeters` of the business (default 5 km, measured by
PostGIS from the phone's position): `422 QUEUE_TOO_FAR` with `details.distanceMeters`; a business
without a location takes sign-ups at the counter only. One live ticket per customer anywhere:
`409 QUEUE_ALREADY_JOINED`. `409 QUEUE_CLOSED` / `QUEUE_PAUSED` / `QUEUE_FULL`. Employee
accounts can't join.

**Alerts:** `queue.position.updated` events (ids, ticket and `ahead`, never names) when a customer
reaches 10 ahead, 5 ahead, then every step — delivered as push notifications in 2.6.
`queue.entry.called` tells them it's their turn.

### Live queue screens (2.4 part 2)

`GET /v1/queue/public/:idOrSlug/stream` — no sign-in. A **Server-Sent Events** stream of the same
public state as `GET /v1/queue/public/:idOrSlug`, sent on connect and after every change:

```
retry: 5000

id: 41
event: state
data: {"businessId":"…","status":"open","waiting":3,"line":["A-007","A-004","A-005"],"called":["A-003"],"serving":["A-002"],"estimatedWaitMinutes":15,"avgServiceSeconds":300,"staffOnShift":1,"remoteJoinRadiusMeters":5000}

: ping
```

- **Ticket numbers only, never names.** `line` is the waiting order (priority lane first, up to
  300). A phone finds its position from its own ticket: `ahead = line.indexOf(myTicket)`, wait ≈
  `ceil(ahead / max(1, staffOnShift)) × avgServiceSeconds`. If the ticket appears in `called`, it's
  their turn. Not in `line` with many waiting → use `GET /v1/queue/my-ticket`.
- Browsers: `new EventSource(url)` reconnects on its own (`retry`), and each connection starts
  with the full state, so nothing is missed. `: ping` comments every 15 s keep it open.
- `event: unavailable` → the queue is no longer public (e.g. business suspended); stop listening.
- Limits: 30 new streams per minute per address; 50 open per address (mobile networks share
  addresses); `429`/`503` with `Retry-After` beyond that. Unknown business → normal `404` JSON.
- Phones in the background don't keep streams open: alerts reach them as push notifications (2.6).

## Billing service — plans, prices and entitlements (2.5 part 1)

| Method & path                                                                          | Auth | Who                | Purpose                                                                                |
| -------------------------------------------------------------------------------------- | ---- | ------------------ | -------------------------------------------------------------------------------------- |
| `GET /v1/billing/plans?audience=user\|business&channel=web\|android\|ios&currency=USD` | —    | anyone             | The pricing page (cached 5 min)                                                        |
| `GET /v1/billing/me`                                                                   | ✔    | a customer         | My plan and how many bookings/queue joins I have left                                  |
| `GET /v1/businesses/:id/billing`                                                       | ✔    | any team role      | The business's plan, features, and usage against each limit                            |
| `GET`/`POST /v1/admin/billing/plans` · `PATCH …/plans/:code`                           | ✔    | super_admin        | Plans: name, tagline, benefits, limits, features, on the page or not                   |
| `POST …/plans/:code/archive` · `/restore`                                              | ✔    | super_admin        | Stop / resume selling a plan (fallback plans are protected)                            |
| `POST …/plans/:code/prices`                                                            | ✔    | super_admin        | New price for a channel; replaces the one in force for new customers                   |
| `POST …/prices/:id/archive` · `PUT …/prices/:id/external-id`                           | ✔    | super_admin        | Stop selling on one channel · link the store's price id                                |
| `GET …/settings` · `PUT …/settings/:audience`                                          | ✔    | super_admin        | `{ enabled, defaultPlanCode, planWhenDisabledCode }`                                   |
| `GET`/`POST …/costs` · `PATCH`/`DELETE …/costs/:id`                                    | ✔    | super_admin        | Monthly running costs (USD)                                                            |
| `GET …/fees` · `PUT …/fees/:channel`                                                   | ✔    | super_admin        | What each channel keeps: `{ percent, fixedAmount }`                                    |
| `POST …/economics` `{ taxPercent?, subscribers? }`                                     | ✔    | super_admin        | Profit per price and in total; break-even                                              |
| `GET …/subscriptions` · `POST …/grants` · `POST …/subscriptions/:id/end`               | ✔    | super_admin        | List · give any plan free (`replace: true` swaps a grant/trial) · end a grant or trial |
| `POST /v1/billing/me/trial`                                                            | ✔    | a customer         | Start my free trial (once)                                                             |
| `POST /v1/businesses/:id/billing/trial`                                                | ✔    | owner              | Start the business's free trial (once)                                                 |
| `GET`/`POST /v1/businesses/:id/billing/plan-requests` · `POST …/:requestId/withdraw`   | ✔    | owner (list: team) | Ask for a plan, e.g. Enterprise free of charge                                         |
| `GET /v1/admin/billing/plan-requests?status=` · `POST …/:id/approve` · `/decline`      | ✔    | super_admin        | Approve (→ grant, optional `until`, other `planCode`) or decline (`note`)              |

### The pricing page

```json
GET /v1/billing/plans?audience=business&channel=web
{ "billingEnabled": false, "defaultPlan": "business_free",
  "comparison": { "limits": [{ "key": "team_accounts", "label": "Team logins", "description": "…" }, …],
                  "features": [{ "key": "queue", "label": "Virtual queue", … }, …] },
  "plans": [{ "code": "business_essential", "name": "Essential", "tagline": "For barbers, clinics and local shops",
              "benefits": ["Online bookings and receipts", "Virtual queue with live display", …],
              "limits": { "team_accounts": 3, "staff_profiles": 5, "services": 30, "photos": 10 },
              "features": { "queue": true, "manual_approval": true, "staff_photos": true, "ads": false, "priority_support": false },
              "prices": [{ "id": "…", "amount": "24.99", "currency": "USD", "interval": "month", "taxInclusive": false, "trialDays": 0 }],
              "free": false }, …] }
```

`limits` values: a number, or `null` for unlimited. `benefits` are the marketing bullets;
`comparison` labels the limit and feature rows of a plan comparison table. Plans without a
price on the asked channel aren't listed (except the free default plan).

### Changing prices and plans

`POST /v1/admin/billing/plans/user_plus/prices { "channel": "web", "amount": 2.49 }` →
`{ price, replaced, subscribersOnPreviousPrice }`. The old price is archived, never edited:
**new** customers pay $2.49; subscribers keep the price they agreed to until moved (and in many
countries must be told before an increase). Plan edits merge `limits`/`features` (keys given are
set, `null` = unlimited); unknown keys are refused with the list of known ones.

**Switching billing off** for an audience (`PUT …/settings/user { "enabled": false }`) puts
everyone on the "billing off" plan at once (unlimited); subscriptions stay recorded and apply again
when switched back on. If the settings were ever missing, everyone is treated as unlimited.

### Plan and usage

```json
GET /v1/businesses/:id/billing
{ "plan": { "code": "business_essential", "name": "Essential" }, "source": "subscription", "billingEnabled": true,
  "features": { "queue": true, … },
  "usage": { "team_accounts": { "used": 2, "limit": 3, "remaining": 1 }, "photos": { "used": 4, "limit": 10, "remaining": 6 }, … } }
```

`source`: `subscription`, `default` (no subscription: the Free / Starter plan) or `billing_off`.
Over a limit (e.g. after a downgrade), nothing is removed — only adding more is refused
(`409 PLAN_LIMIT_REACHED`).

### Free trial (once per account)

Settings per audience: `PUT /v1/admin/billing/settings/user { "trialEnabled": true, "trialDays": 30, "trialPlanCode": "user_plus" }`
(`trialPlanCode: null` or `trialEnabled: false` → no new trials; running ones finish). The
pricing page shows `trial: { days, plan }` while trials are offered. `GET /v1/billing/me` and
`GET /v1/businesses/:id/billing` include:

```json
"trial": { "available": false, "reason": "already_used", "days": 30, "plan": { "code": "user_plus", "name": "BUKU Plus" }, "endsAt": "2026-11-01T…" }
```

`reason`: `null` (can start) · `billing_off` · `trials_off` · `in_trial` · `already_used` ·
`has_subscription`. Starting is `POST …/trial` → the plan and `source: "trial"`; refused with
`409` and the same `reason`. Two taps at once start one trial (database rule). When it ends, the
account is back on the default plan (Free / Starter) — nothing is deleted.

### Plan requests

```json
POST /v1/businesses/:id/billing/plan-requests
{ "planCode": "business_enterprise", "message": "Hospital group, 14 branches, 300 staff" }
```

One open request per business. The admin approves — optionally free `until` a date, or with a
different `planCode` — which creates a grant (replacing a trial or grant the business has) and
links it to the request; or declines with a `note`.

### Plan limits in every service (2.5 part 2)

While billing is on, creating something a plan limits is checked against the account's plan:

| What               | Where                                                   | Refusal                                         |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| A visit (customer) | `POST /v1/appointments`, `POST /v1/queue/join`          | `409 PLAN_LIMIT_REACHED` `limit: visits`        |
| Team logins        | `POST /v1/businesses/:id/members`, re-enabling a member | `limit: team_accounts`                          |
| Bookable staff     | `POST …/staff`, re-activating a profile                 | `limit: staff_profiles`                         |
| Services           | `POST …/services`, restoring an archived one            | `limit: services`                               |
| Gallery photos     | `POST …/photos/uploads` (and when saved)                | `limit: photos` (platform cap 100)              |
| Virtual queue      | `POST …/queue/open`                                     | `403 PLAN_FEATURE_UNAVAILABLE` `feature: queue` |
| Staff photos       | `POST …/staff/:staffId/photo/uploads`                   | `feature: staff_photos`                         |
| Manual approval    | `PUT …/booking-settings { confirmationMode: "manual" }` | `feature: manual_approval`                      |

```json
{
  "success": false,
  "error": {
    "code": "PLAN_LIMIT_REACHED",
    "message": "Your Starter plan includes 1 team login; upgrade to add more",
    "details": { "limit": "team_accounts", "max": 1, "used": 1, "plan": "business_free" }
  }
}
```

Apps show the message and offer the trial or an upgrade (`GET …/billing` says which). A
customer's visits are bookings and queue tickets that are live, completed or missed — cancelled,
declined and left ones don't count. Over a limit after a downgrade, everything already there
keeps working; only adding more is refused.

## Paying online — Paddle (2.5 part 3)

| Method & path                                           | Auth      | Who                  | Purpose                                                  |
| ------------------------------------------------------- | --------- | -------------------- | -------------------------------------------------------- |
| `POST /v1/billing/checkout { planCode }`                | ✔         | a customer           | Start paying for a plan → Paddle checkout                |
| `POST /v1/businesses/:id/billing/checkout { planCode }` | ✔         | owner                | Same for the business                                    |
| `POST …/subscription/cancel` · `/undo-cancel`           | ✔         | the customer / owner | Cancel at the end of the paid period · keep it after all |
| `POST …/subscription/change { planCode }`               | ✔         | the customer / owner | Switch plan now (difference charged or credited)         |
| `GET …/subscription/portal`                             | ✔         | the customer / owner | Links to update the card and see invoices (Paddle)       |
| `POST /v1/billing/webhooks/paddle`                      | signature | Paddle               | Subscription events (signed; no sign-in)                 |
| `POST /v1/admin/billing/prices/:id/sync-paddle`         | ✔         | super_admin          | Create the plan's product and this web price in Paddle   |

`…` = `/v1/billing/me` for customers, `/v1/businesses/:id/billing` for businesses.

### Checkout in the app

```json
POST /v1/businesses/:id/billing/checkout { "planCode": "business_essential" }
→ 201 { "transactionId": "txn_…", "checkoutUrl": "https://…?_ptxn=txn_…", "clientToken": "test_…",
        "environment": "sandbox", "plan": { "code": "business_essential", "name": "Essential" },
        "price": { "amount": "24.99", "currency": "USD", "interval": "month" } }
```

```js
Paddle.Environment.set('sandbox'); // only in sandbox
Paddle.Initialize({ token: clientToken });
Paddle.Checkout.open({ transactionId });
```

Paddle shows the payment form, collects the card and the sales tax/VAT, and charges monthly. The
plan starts when Paddle's webhook arrives (seconds): poll `GET …/billing` until `source` is
`subscription`. The BUKU account is attached to the transaction by the server — the browser can't
point a payment at another account.

| Refusal                   | When                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `409 CONFLICT`            | Billing is off (everything included), or a paid plan already exists (use `change`) |
| `409 FEATURE_DISABLED`    | The plan's web price isn't linked to Paddle yet (sync it)                          |
| `503 FEATURE_DISABLED`    | Paddle isn't configured on this server                                             |
| `502 SERVICE_UNAVAILABLE` | Paddle didn't answer; try again                                                    |

### Webhooks

Paddle signs every notification (`Paddle-Signature: ts=…;h1=…`, HMAC-SHA256 of `ts:body` with the
destination's secret). Refused with `401` when unsigned, wrongly signed or older than 5 minutes;
each `event_id` is processed once (duplicates answer `{ processed: false }`); updates older than
the last one applied are ignored (Paddle can deliver out of order). Events BUKU can't use (unknown
price, no BUKU account) are acknowledged and logged so Paddle stops retrying.

## Notification service — inbox, preferences, email and WhatsApp (2.6)

| Method & path                                                         | Auth  | Purpose                                     |
| --------------------------------------------------------------------- | ----- | ------------------------------------------- |
| `GET /v1/notifications?unread=true&page=&limit=`                      | ✔     | My inbox, newest first; `meta.unread`       |
| `GET /v1/notifications/unread-count`                                  | ✔     | `{ unread }` for the badge                  |
| `POST /v1/notifications/:id/read` · `POST /v1/notifications/read-all` | ✔     | Mark read                                   |
| `DELETE /v1/notifications/:id`                                        | ✔     | Remove from my inbox                        |
| `GET`/`PUT /v1/users/me/notification-prefs`                           | ✔     | Which messages also come as push / WhatsApp |
| `POST /v1/auth/push-tokens` `{ token, platform }` (auth-service)      | ✔     | Register this device (Expo push token)      |
| `GET /v1/users/me/whatsapp`                                           | ✔     | Connected? masked number, stopped?          |
| `POST /v1/users/me/whatsapp/link`                                     | ✔     | One-time code + `wa.me` link (5/hour)       |
| `DELETE /v1/users/me/whatsapp`                                        | ✔     | Disconnect WhatsApp                         |
| `GET`/`POST /v1/notifications/unsubscribe?u=&p=&s=`                   | —     | Email unsubscribe link (signed)             |
| `GET`/`POST /v1/webhooks/whatsapp`                                    | —     | Meta's webhook (verify token / signature)   |
| `GET`/`PUT /v1/admin/notifications/settings`                          | admin | Switches, quiet hours, WhatsApp money       |
| `GET /v1/admin/notifications/whatsapp/usage`                          | admin | This month: window/template counts, cost    |
| `GET /v1/admin/notifications/whatsapp/templates`                      | admin | Templates to create in Meta                 |

```json
GET /v1/notifications
{ "data": [{ "id": "…", "type": "booking_confirmed", "title": "Booking confirmed",
             "body": "Facial at Glow Skin Clinic, Mon 5 Oct, 10:30 with Dr. Sana. Your code: BK-ZZ5UDB",
             "data": { "screen": "appointment", "appointmentId": "…" }, "readAt": null, "createdAt": "…" }],
  "meta": { "page": 1, "limit": 20, "total": 1, "unread": 1 } }
```

`data.screen` tells the app where to go: `appointment`, `business-appointment` (team),
`queue-ticket`. The same title, text and `data` arrive as a push.

**What is sent, to whom**

| Event                     | Customer                                                | Business                                                           |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Booked (automatic)        | "Booking confirmed" + code                              | the employee doing it (or the owner): "New booking"                |
| Booked (needs approval)   | "Request sent"                                          | owner, managers, front desk: "New booking request"                 |
| Approved / declined       | "Booking confirmed" / "Booking not accepted" (+ reason) | —                                                                  |
| Cancelled by the customer | —                                                       | the employee (or owner): "Booking cancelled" / "Late cancellation" |
| Cancelled by the business | "Booking cancelled" (+ reason)                          | —                                                                  |
| Moved                     | "Booking moved" + new code                              | the employee (or owner): "Booking moved"                           |
| No-show                   | "We missed you"                                         | —                                                                  |
| Queue: 10 / 5 / … ahead   | "N people ahead of you" / "You're next"                 | —                                                                  |
| Queue: called             | "It's your turn — A-023" (always pushed)                | —                                                                  |
| Queue closed early        | "The queue has closed"                                  | —                                                                  |

Businesses see customers as "Ayesha K." (first name and initial).

**Timed messages**

| When                                                      | To                              | Message                                   |
| --------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| 24 h before (booked 30 h+ ahead; not at night)            | customer                        | "Reminder: Haircut tomorrow" + code       |
| 2 h before (booked 2½ h+ ahead; not at night)             | customer                        | "Soon: Haircut at 10:30"                  |
| Request unanswered for 2 h, or visit under 24 h away      | owner, managers, front desk     | "A booking request is waiting"            |
| Cancelled with "remind me later", when that time comes    | customer (unless booked again)  | "Time to book Haircut again?"             |
| Trial ends in 3 days / ended                              | the account (or business owner) | "Your free trial ends soon" / "has ended" |
| Gifted plan ends in 7 days; cancelled plan ends in 3 days | the account (or business owner) | "Your Professional plan ends soon"        |
| Payment failed                                            | the account (or business owner) | "Payment didn't go through"               |

Plan notices are only sent while billing is on for that audience, and not if the account already
moved to another plan. `data.screen` adds `book` (`businessId`, `serviceId`), `billing` and
`business-billing`.

**Suggestions** (opt-in; every 30 minutes, never at night; D-075)

| Who                                                                | Message                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Regular (3+ visits at one place, steady rhythm) whose visit is due | "Time for your usual Haircut?" — "Ali has an opening on Thu 5 Mar at 10:30 — book it in a tap." |
| Last booking or queue 45–180 days ago, nothing booked              | "Fade Studio is taking bookings"                                                                |
| New account, never booked (day 2, day 10)                          | "Book your first visit" / "Skip the waiting room"                                               |

`data` opens the booking screen pre-filled: `{ screen: "book", businessId, serviceId, staffId?, startAt? }`
(or `explore`, `business`). They need `suggestions: true` (inbox, push, free WhatsApp) or
`marketingEmails: true` (email, only for people without the app). At most one per 7 days, 3 per
30 days, and none after 3 with no booking in between (admin-editable).

**Channels** — the inbox always; push to every device; then per person:

| Message                                           | Email                                        | WhatsApp (if connected) |
| ------------------------------------------------- | -------------------------------------------- | ----------------------- |
| Confirmed, declined, cancelled by business, moved | always (`emailBookingConfirmation`)          | ✔                       |
| Day-before reminder                               | always (`emailReminders`)                    | ✔                       |
| 2 h reminder, "book again"                        | only without the app (`emailReminders`)      | 2 h reminder ✔          |
| Team alerts                                       | only without the app (`emailBusinessAlerts`) | —                       |
| Queue (ahead, called, closed)                     | never                                        | "your turn" ✔           |
| Plan notices                                      | always (can't be switched off)               | —                       |

WhatsApp ✔ means: free text while their 24-hour window is open; outside it, a paid template only
for people without the app, for types the admin allowed, within the month's budget. Email needs a
verified address; every email (except plan notices) has a one-click unsubscribe for its kind.

**Connecting WhatsApp** — `POST /v1/users/me/whatsapp/link` returns
`{ code, text: "BUKU 7KQ2MX", link: "https://wa.me/<our number>?text=BUKU%207KQ2MX", expiresAt }`
(15 minutes; a new code replaces the old). The app opens `link`; the person taps send. That
message proves the number and connects it. Afterwards, any message they send gets their upcoming
visits back; `STOP` / `START` switch WhatsApp messages off / on. 503 until WhatsApp is set up.

**Preferences** (`PUT …/notification-prefs`, any subset): `pushBookingConfirmation`,
`pushReminders`, `pushQueueUpdates`, `pushBusinessAlerts`, `whatsappUpdates`, `smsReminders`,
`emailBookingConfirmation`, `emailReminders`, `emailBusinessAlerts`, `suggestions` and
`marketingEmails` (both explicit opt-ins; the time of consent is recorded and cleared on opt-out). Switching off a push keeps the
message in the inbox. Being called in a queue, and plan notices, are always pushed.

**Admin settings** (`PUT /v1/admin/notifications/settings`, any subset): `emailEnabled`,
`whatsappEnabled` (default off), `whatsappPaidTypes` (from the templates list),
`whatsappMonthlyBudgetCents` (0 = never pay), `whatsappMessageCostCents` (Meta's rate for your
market), `whatsappFreeWindowPerMonth` (1000), `reminder24h`, `reminder2h`, `quietStartHour` /
`quietEndHour` (21 / 9, local time), `suggestionsEnabled`, `suggestionMinDays` (7),
`suggestionMaxPer30Days` (3), `suggestionMaxIgnored` (3). Changes apply within 30 seconds and are
audited.

## Search service — finding businesses (2.7)

All public (no sign-in), rate-limited at the gateway (200/minute per address).

| Method & path                                    | Purpose                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `GET /v1/businesses/search`                      | Text, place and filters; paged                                       |
| `GET /v1/businesses/nearby?lat=&lng=`            | Same, nearest first (default radius 5 km)                            |
| `GET /v1/businesses/autocomplete?q=`             | As-you-type: businesses, categories, services (2+ characters)        |
| `GET /v1/businesses/featured?city=` or `lat,lng` | Homepage picks: verified, with a photo, best first, ≤ 2 per category |
| `GET /v1/businesses/trending?city=` or `lat,lng` | Busiest this week (bookings + queue joins, at least 3)               |
| `GET /v1/cities`                                 | Cities with businesses on BUKU and how many, most first              |
| `GET /v1/categories`                             | Category tree (active only)                                          |
| `GET /v1/categories/:slug`                       | One category with its children and parent                            |
| `GET /v1/categories/:slug/businesses`            | Search within a category (and its sub-categories)                    |

**Search parameters** (all optional): `q` (words; partial last word and small typos are fine),
`lat` + `lng` (together), `radiusKm` (default 10, max 100), `city`, `category` (slug, includes
sub-categories), `minRating` (1–5), `verifiedOnly`, `openNow`, `hasQueue` (an open queue today),
`availableDate` (`YYYY-MM-DD`: open that day), `sort` (`relevance` default · `distance` needs
`lat`/`lng` · `rating` · `newest`), `page` (≤ 50), `limit` (≤ 50, default 20). Unknown parameters
are refused (400).

```json
GET /v1/businesses/search?q=haircut&lat=31.52&lng=74.35&openNow=true
{ "data": [{
    "id": "…", "slug": "fade-masters", "name": "Fade Masters",
    "category": { "slug": "barbershop", "name": "Barbershop" },
    "city": "Lahore", "address": "…", "location": { "lat": 31.52, "lng": 74.36 }, "distanceKm": 1.3,
    "rating": { "average": 4.7, "count": 128 }, "verified": true,
    "reliability": { "keptPercent": 98, "basedOn": 240 },
    "priceFrom": { "amount": 400, "currency": "PKR" },
    "openNow": true, "queue": { "open": true, "waiting": 4 },
    "logoUrl": "https://…", "coverPhotoUrl": "https://…", "isPromoted": false }],
  "meta": { "page": 1, "limit": 20, "total": 7, "totalPages": 1, "sort": "relevance" } }
```

`reliability` is null until a business has 10 decided bookings; `queue` is null without an open
queue today; `priceFrom` is the lowest active service price. **Ranking** (`relevance`): how well
the words match (name first, then category and services, description, city) + quality (rating
adjusted for how many reviews there are, reliability, verified) + closeness. A 5.0 from 2
reviews does not beat a 4.8 from 200.

```json
GET /v1/businesses/autocomplete?q=hai
{ "data": { "businesses": [{ "id": "…", "slug": "…", "name": "Hair by Sana", "city": "Lahore", "category": "Hair Salon" }],
            "categories": [{ "slug": "hair-salon", "name": "Hair Salon", "icon": null }],
            "services": ["Haircut", "Haircut + Beard", "Hair Colour"] } }
```

## Reviews (2.8 part 1)

| Method & path                                                     | Auth          | Purpose                                                                       |
| ----------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `GET /v1/businesses/:idOrSlug/reviews?sort=&rating=&withComment=` | —             | Reviews (newest first) with `meta.summary`                                    |
| `POST /v1/appointments/:id/review`                                | the customer  | Review a visit that happened (within 30 days, once)                           |
| `PATCH /v1/appointments/:id/review`                               | the customer  | Change it (7 days after posting)                                              |
| `DELETE /v1/appointments/:id/review`                              | the customer  | Delete it                                                                     |
| `GET /v1/appointments/reviews`                                    | ✔             | My reviews                                                                    |
| `PUT`/`DELETE /v1/businesses/:id/reviews/:reviewId/response`      | owner/manager | Reply (replaces an earlier reply) / remove the reply                          |
| `POST /v1/businesses/:id/reviews/:reviewId/report`                | owner/manager | `{ reason: offensive·fake·not_a_customer·personal_info·other, note? }`        |
| `GET /v1/admin/reviews`                                           | admin         | Reported reviews, oldest report first                                         |
| `POST /v1/admin/reviews/:reviewId/decision`                       | admin         | `{ action: "hide", reason }` · `{ action: "keep" }` · `{ action: "restore" }` |

```json
POST /v1/appointments/:id/review
{ "overall": 5, "waitTime": 4, "staff": 5, "cleanliness": 5, "value": 4, "comment": "Great fade" }

GET /v1/businesses/fade-masters/reviews
{ "data": [{ "id": "…", "rating": { "overall": 5, "waitTime": 4, "staff": 5, "cleanliness": 5, "value": 4 },
             "comment": "Great fade", "author": "Ayesha K.", "service": "Haircut", "staff": "Ali",
             "visitedIn": "2026-10", "createdAt": "…", "edited": false,
             "response": { "text": "Thanks Ayesha!", "at": "…" } }],
  "meta": { "page": 1, "limit": 20, "total": 128, "totalPages": 7,
            "summary": { "average": 4.7, "count": 128, "stars": { "5": 100, "4": 20, "3": 5, "2": 2, "1": 1 },
                         "details": { "waitTime": 4.4, "staff": 4.8, "cleanliness": 4.9, "value": 4.5 },
                         "reliability": { "keptPercent": 98, "basedOn": 240 } } } }
```

Only `overall` is required (1–5); comments up to 2,000 characters, replies up to 1,000; phone
numbers and emails in either are replaced with "[contact removed]". Errors: `REVIEW_NOT_ALLOWED`
(422: not your visit yet, a no-show, or over 30 days), `REVIEW_EXISTS` (409), `REVIEW_LOCKED`
(409: over 7 days to edit). The public business profile (`GET /v1/businesses/:idOrSlug`) now
includes `reliability` next to `rating`. Notifications: "How was your Haircut?" (customer, once,
30 min–3 days after the visit), "New 4★ review" (owner and managers), "<Business> replied to your
review" (reviewer, first reply only).

## Reliability and cancellation insights (2.8 part 2)

| Method & path                                             | Auth          | Purpose                                                  |
| --------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `GET /v1/appointments/reliability`                        | ✔             | My reliability, what it's made of, what businesses see   |
| `GET /v1/businesses/:id/insights/cancellations?from=&to=` | owner/manager | Cancellations and no-shows (default last 90 days, ≤ 366) |
| `PUT /v1/businesses/:id/booking-settings`                 | owner/manager | `approvalBelowShowUpPercent`: 50–99, or `null` (off)     |

```json
GET /v1/appointments/reliability
{ "data": { "showsUpPercent": 87, "basedOn": 12, "label": "Shows up 87%", "businessesSee": "Shows up 87%",
            "visits": 10, "noShows": 1, "lateCancellations": 1,
            "period": { "from": "…", "to": "…" },
            "tip": "If you can’t make it, cancel before the business’s cancellation window — ordinary cancellations never count against you." } }
```

Businesses see `customer.reliability: { label, showsUpPercent }` on every appointment (list and
detail) and on the queue board (`null` for walk-ins); `showsUpPercent` is `null` for new
customers (fewer than 3 visits, no-shows or late cancellations in 12 months).

```json
GET /v1/businesses/:id/insights/cancellations
{ "data": {
    "period": { "from": "2026-07-06", "to": "2026-10-03", "timezone": "Asia/Karachi" },
    "totals": { "booked": 140, "completed": 118, "upcoming": 6, "cancelledByCustomer": 9, "lateCancellations": 3,
                "cancelledByBusiness": 1, "declined": 2, "cancelledBySystem": 0, "noShows": 4, "moved": 5 },
    "rates": { "customerCancellation": 6.4, "lateCancellation": 2.1, "noShow": 3.3, "businessCancellation": 0.7 },
    "reasons": [{ "reason": "schedule_conflict", "count": 5 }, { "reason": "illness", "count": 3 }, { "reason": "not_given", "count": 1 }],
    "byWeekday": [{ "dayOfWeek": 0, "cancellations": 1, "noShows": 0 }, …],
    "byHour": [{ "hour": 10, "cancellations": 2, "noShows": 1 }, …],
    "byService": [{ "id": "…", "name": "Haircut", "booked": 90, "cancellations": 6, "noShows": 3, "cancellationRate": 6.7 }],
    "byStaff": [{ "id": "…", "name": "Ali", "booked": 70, "cancellations": 4, "noShows": 2, "cancellationRate": 5.7 }],
    "weekly": [{ "weekOf": "2026-09-28", "booked": 12, "cancellations": 1, "noShows": 0 }, …],
    "rebookLater": { "asked": 4, "bookedAgain": 3, "rate": 75 } } }
```

Visits are counted by when they were (or would have been). Rates have one decimal; the no-show
rate is of visits that happened or were missed.

## Two-step sign-in (D-081)

| Method & path                                 | Auth               | Purpose                                                                          |
| --------------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `GET /v1/auth/mfa`                            | ✔                  | `{ enabled, since, recoveryCodesLeft, required }`                                |
| `POST /v1/auth/mfa/setup`                     | ✔                  | `{ secret, otpauthUri }` — show `otpauthUri` as a QR code                        |
| `POST /v1/auth/mfa/confirm` `{ code }`        | ✔                  | Turns it on: `{ recoveryCodes[10], session: { accessToken } }`                   |
| `POST /v1/auth/mfa/verify`                    | — (the `mfaToken`) | Answer a sign-in challenge: `{ mfaToken, code }` or `{ mfaToken, recoveryCode }` |
| `POST /v1/auth/mfa/step-up` `{ code }`        | ✔                  | Mark the current session as having passed it (new access token)                  |
| `POST /v1/auth/mfa/recovery-codes` `{ code }` | ✔                  | Replace the recovery codes; `{ recoveryCode }` instead works too (used up)       |
| `DELETE /v1/auth/mfa` `{ code }`              | ✔ (not admins)     | Turn it off; `{ recoveryCode }` instead works too, for a lost phone              |

With it on, `POST /v1/auth/oauth/*` and `/business-login` answer
`{ mfaRequired: true, mfaToken, expiresAt }` (5 minutes) instead of a session; the app asks for
the code and calls `/mfa/verify`, which returns the usual `{ user, accessToken, refreshToken, … }`.
Errors: `MFA_INVALID_CODE` (401), `MFA_LOCKED` (429, after 5 wrong codes, 15 minutes),
`MFA_REQUIRED` (403: a platform admin route with a session that didn't pass it — set it up, or
`step-up`). Access tokens carry `mfa: true` when the session passed it.
