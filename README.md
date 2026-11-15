# Jev Priority Inbox

TypeScript classroom prototype based on `docs/prjM5_feasibility.pdf`. Express serves a React inbox with account-scoped SQLite storage. Priority mail appears in the default view. Originals stay with the mailbox provider.

The desktop inbox uses a compact left queue and a reading pane. Each email card shows up to two lines of opening message text beneath its title. Opening or reloading the inbox selects the first available email. Select another email in the queue to read without dismissing it. On mobile, selecting an email opens the reader with a Back to inbox action. New arrivals preserve the open message. Demo and account mail share the same reader, controls, and styles. Priority badges use red for Emergency, blue for Urgent, and grey for Routine; Refresh sits beside the Inbox heading.

## Run locally

Requires Node.js 24. Run `npm install`, copy `.env.example` to `.env` if needed, and configure the encryption key below before running `npm run dev`. Open `http://localhost:8000`. Express serves both the frontend and API on port 8000; Vite rebuilds assets without opening another server. Reload the browser after frontend changes. The site always opens the account-connection interface. Legacy `APP_MODE` settings do not change the website.

`npm test` checks policy, persistence, recovery, failures and HTTP access. `npm run build` compiles both apps. `npm start` serves the production build at `http://localhost:8000`.

For browser checks, run `npx playwright install chromium`, `npm run build`, then `npm run test:browser`. The test uses a separate server on port 3101 with an isolated in-memory database.

## Live configuration

### Connected mailboxes

Set `MAIL_ENCRYPTION_KEY` (64 hexadecimal characters). Generate it with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the encryption key outside SQLite and retain it across restarts. Use a fresh persistent `SQLITE_PATH` (default `./data/mail.sqlite`), separate from any old classroom database. Jev keys are not required for mailbox connections. Run one server instance.

Set `PUBLIC_URL=http://localhost:8000` and `PORT=8000` for local development. After changing `.env`, restart `npm run dev` and open `http://localhost:8000` to see the email-account connection screen. Deploy with HTTPS behind one trusted proxy. Manual connections require public IMAP servers with implicit TLS (usually 993), plus SMTP on 587 with required STARTTLS or 465 with implicit TLS. Enter a password or provider-issued app password; providers requiring their own OAuth flow need an additional adapter.

For Gmail, enable the Gmail API in a Google Cloud project and create a Web application OAuth client. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register `<PUBLIC_URL>/v1/connect/google/callback` as the exact authorized redirect URI. Configure the consent screen with `openid`, `email`, `gmail.readonly`, and `gmail.send`, and add named pilot users while the app is in Testing. Google test refresh tokens may expire after seven days; use Reconnect account to authorize again. Public release needs Google's applicable verification.

Each user connects one mailbox. The app imports the latest 50 inbox messages, checks every 60 seconds while running, and offers Load older messages in All Messages. Mail starts Unclassified and can be assigned a priority manually. Priority is the default view. Compose and Reply support plain text and comma-separated To/Cc/Bcc addresses. A send confirmation means provider acceptance. Unknown send outcomes require checking the source mailbox before trying again. Sign out ends the session and returns to the account-connection screen. The inbox has no Disconnect button. Cached account data persists across sign-outs; short previews are cached locally and full bodies are fetched on demand.

The connection screen offers Google sign-in, a separate manual server-settings screen, and View demo inbox. The demo at `/demo` opens the nine existing fictional samples without signing in. Both connected and demo inboxes place a Priority Only / All Messages selector directly above the message list. The demo uses a mock mailbox adapter with the same compose, reply, priority, handled, refresh, and sign-out controls as account mail. Mock edits reset on reload and sends are simulated without contacting mail providers. Only approved sample data is exposed.

Automated tests use offline provider adapters. Live pilot acceptance still requires configured Google and IMAP/SMTP accounts: send Gmail to the manual account, read and reply in this app, verify Gmail threading, then restart and check account isolation and duplicate prevention.

### Offline comparison

`npm run compare` requires `JEV_API_KEY` and `GEMINI_API_KEY`. It prints one JSON result per approved example with expected label, Jev leading class and display tier, Gemini label, failures, and timings. It makes one attempt per model/example and bypasses stored decisions.

## Prototype limits

The website currently defers Jev classification. Mail uses plain-text rendering without attachments; message retrieval is limited to 5 MB. The optional demo contains fictional English samples. The offline study pipeline remains for regression tests and comparison. Its schema is initialized only by the study repository; account startup leaves existing study tables untouched.

Sessions expire after eight hours and are revocable records in SQLite; `SESSION_SECRET` is no longer used. Event-stream heartbeats keep connections open without reloading the message list. Marking handled and correcting a tier affect this inbox only. The comparison runs all nine approved examples. The 160-message study, live latency trial, and provider verification require credentials and later evaluation.
