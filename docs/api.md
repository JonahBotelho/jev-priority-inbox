# Public inbox API

The browser reads JSON under `/v1` without cookies. Resend submits signed delivery events to a separate POST endpoint.

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
  "processing": { "pending": 0, "failed": 0 },
  "reviewAvailable": true
}
```

Emergency comes first, then Urgent. Within a tier the API orders by descending priority score, then newer arrival time and stable ID. Only completed decisions with stored Jev probabilities for this demo mailbox qualify. Pending, failed, and Routine messages have no priority card.

`pending` includes in-flight reviews. When Resend is active, the snapshot includes `receivingAddress` and only that mailbox's decisions. An open, visible live inbox refreshes every 30 seconds when idle and every 1.5 seconds during review. Returning to the tab refreshes it immediately. Failed deliveries become eligible for a new review when the configured API restarts. Reads incur no inference calls.

## POST /v1/inbound

Resend sends an `email.received` event as raw JSON with the `svix-id`, `svix-timestamp`, and `svix-signature` headers. Render verifies the signature and timestamp, checks the SMTP envelope's `received_for` list, and commits the provider email ID and arrival time to PostgreSQL before responding. A duplicate ID is acknowledged without adding another job.

The route returns `200` for an accepted delivery, a duplicate, or an unrelated signed event. It returns `401` for failed verification, `400` for invalid delivery metadata, `415` for an unsupported body type, and `503` if Resend is unconfigured or the database write fails. A `200` acknowledges receipt. Jev classification completes asynchronously.
