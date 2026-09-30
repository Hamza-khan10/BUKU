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

| Method & path                | Auth | Rate limit | Purpose                                                         |
| ---------------------------- | ---- | ---------- | --------------------------------------------------------------- |
| `POST /oauth/google`         | —    | 10/min/IP  | Sign in or sign up with a Google ID token                       |
| `POST /oauth/apple`          | —    | 10/min/IP  | Sign in with Apple — **locked**: `403 FEATURE_DISABLED`         |
| `POST /dev/login`            | —    | 10/min/IP  | **Development only** (404 elsewhere): sign in as any email/role |
| `POST /refresh`              | —    | 60/min/IP  | Rotate the refresh token, get a new access token                |
| `POST /logout`               | —    | 60/min/IP  | End this device's session → `204`                               |
| `POST /logout-all`           | ✔    | 30/min     | End every session on every device → `204`                       |
| `GET /sessions`              | ✔    | —          | My signed-in devices                                            |
| `DELETE /sessions/:id`       | ✔    | 30/min     | Sign out one of my devices → `204` (`404` if not mine)          |
| `GET /me`                    | ✔    | —          | My account                                                      |
| `PATCH /me`                  | ✔    | 30/min     | Update name / timezone / locale                                 |
| `PUT /me/phone`              | ✔    | 30/min     | Set my phone number + WhatsApp consent                          |
| `POST /push-tokens`          | ✔    | 30/min     | Register this device for push → `204`                           |
| `DELETE /push-tokens/:token` | ✔    | 30/min     | Unregister a device → `204` (`404` if not mine)                 |

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
