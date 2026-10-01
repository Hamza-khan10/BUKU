# API reference

Base URL: `http://localhost:8000` locally (Kong gateway); production URL decided with the domain.
All bodies are JSON. Unknown body fields are rejected with `400 VALIDATION_ERROR`.

Every response uses one envelope:

```json
{ "success": true, "data": { … }, "meta": { … } }
{ "success": false, "error": { "code": "SESSION_REVOKED", "message": "…", "details": { … }, "requestId": "…" } }
```

Clients branch on `error.code`, never on `message`. Send `X-Request-ID` to correlate with server logs.
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
notifications stop, and other services are told (`users.deleted`) to cancel upcoming bookings.
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
unique within the business (`409 USERNAME_TAKEN`). Up to 50 team accounts per business.

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
