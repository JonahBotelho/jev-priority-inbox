# Jev Priority Inbox

TypeScript classroom prototype based on `docs/prjM5_feasibility.pdf`. Express serves a React reader and runs a durable SQLite classification worker. Emergency and Urgent mail appears in the inbox. Originals stay with the mailbox provider.

The desktop inbox uses a compact left queue and a reading pane. Each email card shows up to two lines of opening message text beneath its title. Opening or reloading the inbox selects the first available email. Select another email in the queue to read without dismissing it. On mobile, selecting an email opens the reader with a Back to inbox action. New arrivals preserve the open message.

## Run locally

Requires Node.js 24. Run `npm install`, copy `.env.example` to `.env` if needed, then `npm run dev`. Open `http://localhost:8000`. Express serves both the frontend and API on port 8000; Vite rebuilds assets without opening another server. Reload the browser after frontend changes. The example environment uses demo mode with `MAILBOX_PASSWORD` (initial value `classroom-demo`); use connected mode below to sign in with an email account.

In another terminal, use `npm run demo:deliver -- outage`. Emergency examples are `outage`, `security`, and `database`. Urgent examples are `signoff`, `deployment`, and `certificate`. Routine examples are `recovery`, `sale`, and `digest`. An optional second argument supplies a stable delivery ID for duplicate tests. Demo classifications use fixed fixture probabilities through the same worker and database as live mode. Routine emails are processed and kept out of the priority queue.

Run `npm run demo:seed` with the server stopped to populate the configured demo database with all nine examples (three per priority), spaced five minutes apart. It uses the normal classification worker and needs no API keys. Repeat runs preserve existing samples, including handled messages and corrections.

`npm test` checks policy, persistence, recovery, failures and HTTP access. `npm run build` compiles both apps. `npm start` serves the production build at `http://localhost:8000`.

For browser checks, run `npx playwright install chromium`, `npm run build`, then `npm run test:browser`. The test uses a separate server on port 3101 with an isolated in-memory database.

## Live configuration

### Connected mailboxes

Set `APP_MODE=connected`, a random `SESSION_SECRET` (at least 32 characters), and `MAIL_ENCRYPTION_KEY` (64 hexadecimal characters). Generate each independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the encryption key outside SQLite and retain it across restarts. Use a fresh persistent `SQLITE_PATH` for this mode. Jev and Resend keys are optional. Run one server instance.

Set `PUBLIC_URL=http://localhost:8000` and `PORT=8000` for local development. After changing `.env`, restart `npm run dev` and open `http://localhost:8000` to see the email-account connection screen. Deploy with HTTPS behind one trusted proxy. Manual connections require public IMAP servers with implicit TLS (usually 993), plus SMTP on 587 with required STARTTLS or 465 with implicit TLS. Enter a password or provider-issued app password; providers requiring their own OAuth flow need an additional adapter.

For Gmail, enable the Gmail API in a Google Cloud project and create a Web application OAuth client. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register `<PUBLIC_URL>/v1/connect/google/callback` as the exact authorized redirect URI. Configure the consent screen with `openid`, `email`, `gmail.readonly`, and `gmail.send`, and add named pilot users while the app is in Testing. Google test refresh tokens may expire after seven days; use Reconnect account to authorize again. Public release needs Google's applicable verification.

Each user connects one mailbox. The app imports the latest 50 inbox messages, checks every 60 seconds while running, and offers Load older messages in All Messages. Mail starts Unclassified and can be assigned a priority manually. Priority is the default view. Compose and Reply support plain text and comma-separated To/Cc/Bcc addresses. A send confirmation means provider acceptance. Unknown send outcomes require checking the source mailbox before trying again. Sign out ends the session; Disconnect removes local account data and revokes Google access. Connected metadata persists until provider removal or disconnect; short previews are cached locally and full bodies are fetched on demand.

The connection screen offers Google sign-in, a separate manual server-settings screen, and View demo inbox. The demo at `/demo` opens the nine existing fictional samples without signing in. Both connected and demo inboxes place a Priority Only / All Messages selector directly above the message list. The demo is read-only and exposes only approved sample data.

Automated tests use offline provider adapters. Live pilot acceptance still requires configured Google and IMAP/SMTP accounts: send Gmail to the manual account, read and reply in this app, verify Gmail threading, then restart and check account isolation and duplicate prevention.

### Resend study mode

Set `APP_MODE=live`, a strong mailbox password and random session secret, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `JEV_API_KEY`. Configure the dedicated Resend recipient and signed `email.received` webhook at `https://your-host/v1/inbound`. Set `RECIPIENT_ROLE` and `RECIPIENT_TIME_ZONE`. Use one Node instance, HTTPS behind one trusted proxy, and a persistent disk for `SQLITE_PATH`. Choose a fresh database path when switching from demo to live to keep fictional deliveries separate. Live mode rejects the demo password and placeholder secret.

`npm run compare` requires `JEV_API_KEY` and `GEMINI_API_KEY`. It prints one JSON result per approved example with expected label, Jev leading class and display tier, Gemini label, failures, and timings. It makes one attempt per model/example and bypasses stored decisions.

## Prototype limits

The demo and Resend study modes use one shared mailbox session and fictional English messages. Only sanitized text matching the nine approved examples is sent to a model. Extend the approved fixtures before testing additional messages. Study provider calls time out after four seconds and transient job failures retry once. Failed processing remains visible. Full bodies are fetched on demand and study decision metadata is purged after seven days. Connected mode currently defers Jev classification. All modes use plain-text rendering and omit attachments; connected message retrieval is limited to 5 MB.

Sessions expire after eight hours. Changing `SESSION_SECRET` invalidates study-mode cookies; connected sessions are revocable records in SQLite. Marking handled and correcting a tier affect this inbox only. The comparison runs all nine approved examples. The 160-message study, live latency trial, and provider verification require credentials and later evaluation.
