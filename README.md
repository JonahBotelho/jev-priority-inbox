# Jev Priority Inbox

TypeScript classroom prototype based on `docs/prjM5_feasibility.pdf`. Express serves a React reader and runs a durable SQLite classification worker. Emergency and Urgent mail appears in the inbox. Originals stay with the mailbox provider.

The desktop inbox uses a compact left queue and a reading pane with a top action toolbar. Select an email or use Next email to read without dismissing it. On mobile, selecting an email opens the reader with a Back to inbox action. New arrivals preserve the open message.

## Run locally

Requires Node.js 24. Run `npm install`, copy `.env.example` to `.env` if needed, then `npm run dev`. Open the Vite URL and sign in with `MAILBOX_PASSWORD` (initial demo value `classroom-demo`). The API defaults to port 8000. Set `PORT=8000` during Vite development because its API proxy uses that port. The proxy preserves the browser host for the API's same-origin checks.

In another terminal, use `npm run demo:deliver -- outage`. Emergency examples are `outage`, `security`, and `database`. Urgent examples are `signoff`, `deployment`, and `certificate`. Routine examples are `recovery`, `sale`, and `digest`. An optional second argument supplies a stable delivery ID for duplicate tests. Demo classifications use fixed fixture probabilities through the same worker and database as live mode. Routine emails are processed and kept out of the priority queue.

`npm test` checks policy, persistence, recovery, failures and HTTP access. `npm run build` compiles both apps. `npm start` serves the production build at `http://localhost:8000`.

For browser checks, run `npx playwright install chromium`, `npm run build`, then `npm run test:browser`. The test uses a separate server on port 3101 with an isolated in-memory database.

## Live configuration

Set `APP_MODE=live`, a strong mailbox password and random session secret, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `JEV_API_KEY`. Configure the dedicated Resend recipient and signed `email.received` webhook at `https://your-host/v1/inbound`. Set `RECIPIENT_ROLE` and `RECIPIENT_TIME_ZONE`. Use one Node instance, HTTPS behind one trusted proxy, and a persistent disk for `SQLITE_PATH`. Choose a fresh database path when switching from demo to live to keep fictional deliveries separate. Live mode rejects the demo password and placeholder secret.

`npm run compare` requires `JEV_API_KEY` and `GEMINI_API_KEY`. It prints one JSON result per approved example with expected label, Jev leading class and display tier, Gemini label, failures, and timings. It makes one attempt per model/example and bypasses stored decisions.

## Prototype limits

One shared mailbox session, fictional English messages, plain-text rendering, and no attachments. Only sanitized text matching the nine approved examples is sent to a model. Extend the approved fixtures before testing additional messages. Provider calls time out after four seconds and transient job failures retry once. Failed processing remains visible. Full bodies are fetched on demand and decision metadata is purged after seven days.

Sessions expire after eight hours. Changing `SESSION_SECRET` invalidates existing cookies. Marking handled and correcting a tier affect this inbox only. The comparison runs all nine approved examples. The 160-message study, live latency trial, and provider verification require credentials and later evaluation.
