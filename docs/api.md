# Inbox and account portal API

The public inbox reads JSON under `/v1` without cookies. Resend submits signed delivery events to a separate POST endpoint. The private portal uses session cookies and a separate set of routes.

## GET /v1/health

Returns `200` with `{"status":"ok","storage":"postgresql"}` after the API opens PostgreSQL and initializes its schema. This liveness check does not query the database on every Render probe.

## GET /v1/priority

Returns an inbox snapshot. Each card has a stable ID, a confirmed tier, a subject, a message preview, and its arrival time in UTC. The client displays local time. The following is an abbreviated example.

```json
{
  "cards": [{
    "id": "example-id",
    "tier": "Emergency",
    "subject": "Checkout is down",
    "preview": "Payments are failing for every customer right now.",
    "receivedAt": "2026-11-20T18:10:00.000Z"
  }],
  "routineCount": 2,
  "processing": { "pending": 0, "failed": 0 },
  "reviewAvailable": true
}
```

Emergency comes first, then Urgent. Within a tier the API orders by descending priority score, then newer arrival time and stable ID. Both priority cards and the Routine count cover unhandled, completed decisions with stored Jev probabilities for the active public mailbox.

Opening **Lower-priority emails** requests `GET /v1/priority?include=routine`. This adds `routineMessages` to the same snapshot. Each entry contains only `id`, `subject` and `receivedAt`, ordered by newest arrival then stable ID. A `null` subject identifies an older decision whose title was never saved. The default response includes only the count for this group.

`pending` includes in-flight reviews. When Resend is active, the snapshot includes `receivingAddress` and only that mailbox's decisions. An open, visible live inbox refreshes every 30 seconds when idle and every 1.5 seconds during review. Returning to the tab refreshes it immediately. Failed deliveries become eligible for a new review when the configured API restarts. Reads incur no inference calls.

## POST /v1/inbound

Resend sends an `email.received` event as raw JSON with the `svix-id`, `svix-timestamp`, and `svix-signature` headers. Render verifies the signature and timestamp, checks the SMTP envelope's `received_for` list, and commits the provider email ID and arrival time to PostgreSQL before responding. A duplicate ID is acknowledged without adding another job.

The route returns `200` for an accepted delivery, a duplicate, or an unrelated signed event. It returns `401` for failed verification, `400` for invalid delivery metadata, `415` for an unsupported body type, and `503` if Resend is unconfigured or the database write fails. A `200` acknowledges receipt. Jev classification completes asynchronously.

## Account portal

Browser requests to these routes use `credentials: 'include'` and the configured frontend origin. Registration and login issue an eight-hour signed HttpOnly cookie. HTTPS deployments set Secure, SameSite=None and Partitioned. The API checks the session and current user role in Neon for every protected request. Missing or expired sessions return `401`. A normal user's request to the administrator directory returns `403`.

| Route | Access and behavior |
| --- | --- |
| `POST /v1/auth/register` | Send JSON with `email` and `password`. Creates a regular user and a session, returning `201` with ID, email and role. Duplicate and reserved addresses return `409`. |
| `POST /v1/auth/login` | Send the same fields. Returns the signed-in account. |
| `GET /v1/auth/me` · `POST /v1/auth/logout` | Read the signed-in account or revoke the session and clear its cookie. |
| `POST /v1/classify` | Signed-in users submit `subject` and `text`. JSON includes `id`, `tier`, `score`, `model`, `provider` and `durationMs`. Invalid input returns `400`. A provider failure returns `502` and a missing classifier returns `503`. |
| `GET /v1/usage/me` · `GET /v1/classifications` | Return the caller's request count, success count and last request time, or their latest 50 successful decisions. Valid failed submissions count toward usage. Reads and invalid submissions do not. |
| `GET /v1/admin/dashboard` | Administrators can read registered accounts, their roles, registration dates and request counts. |

`GET /v1/usage/me` also includes `netlifyCreditBalance`, shared across signed-in accounts. It contains the last observed balance as an exact decimal string (`remaining`) and its timestamp with time zone (`checkedAt`), or is `null` until the first manual check. Submitting a classification updates the caller’s request statistics. The team balance changes when a maintainer records a new reading from Netlify.
