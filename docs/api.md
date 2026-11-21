# Public inbox API

The demo serves read-only JSON under `/v1`. The client sends ordinary cross-origin GET requests without cookies. The public server mounts the following two routes.

## GET /v1/health

Returns `200` with `{"status":"ok"}` when the API is running.

## GET /v1/priority

Returns an inbox snapshot. Each card has a stable ID, a confirmed tier, a subject, a message preview, and its fictional arrival time in UTC. The client displays local time. The following is an abbreviated example.

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

`pending` includes in-flight reviews. The browser refreshes while work is pending and `reviewAvailable` is true. Previously saved decisions can be read even when the relay is unconfigured. Failed samples become eligible for a new review when the configured API restarts. Reading the list incurs no inference calls.
