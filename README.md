# Jev Priority Inbox

Jev Priority Inbox classifies email text by urgency through a protected REST API, records each inference request, and provides a user page and administrator usage dashboard. The API sends the message to the Jev AI service using a server-side key, receives urgency probabilities, and maps them to Emergency, Urgent, or Routine with the project’s priority policy. The web client never receives the provider key.

## Requirements and local setup

- Node.js 24 or newer
- An instructor-approved Jev API key for live classification
- A stable 64-character hexadecimal encryption key and a separate 64-character hexadecimal JWT secret
- An initial administrator email and a unique password of at least 12 characters

On this Apple Silicon Mac, if `node -v` still returns Node 22 after installing Node 24 with Homebrew, run this in the same terminal before npm commands:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
hash -r
node -v
```

Confirm it prints `v24` or newer.

```sh
npm install
cp -n .env.example .env
```

In `.env`, set `MAIL_ENCRYPTION_KEY` and `APP_JWT_SECRET` to different values generated with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Also set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, and `JEV_API_KEY`. Keep the two secrets and provider key private. Local defaults use `CLIENT_ORIGIN=http://localhost:5173`, `VITE_API_URL=http://localhost:8000`, and `PUBLIC_URL=http://localhost:8000`.

Start both local services:

```sh
npm run dev
```

Open `http://localhost:5173`. Register a regular account, or sign in with the administrator credentials from `.env`. The user page has the AI classifier and personal request total. The admin account sees the user and usage dashboard. Use fictional text while demonstrating. The legacy fictional inbox is at `/demo`; the optional connected mailbox prototype is at `/inbox`.

## Build and test

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run dev` starts Vite on port 5173 and Express on port 8000. `npm run build` builds the independent static client and compiles the API. `npm start` starts only the API; deploy the static client separately. API endpoint contracts are documented in [docs/api.md](docs/api.md), and the component/deployment diagram is in [docs/architecture.md](docs/architecture.md).

## Deploy as two origins

The repository includes a Render blueprint for the API and Vercel configuration for the client. Deploy the API first, attach its persistent disk, and configure `PUBLIC_URL` to the API HTTPS URL, `CLIENT_ORIGIN` to the client HTTPS URL, `APP_JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, and `JEV_API_KEY` as private environment values. Set Vercel’s `VITE_API_URL` to the API HTTPS URL and deploy the client. Redeploy the client after changing `VITE_API_URL`; it is embedded at build time. For reliable browser cookie behavior, use two HTTPS subdomains under the same registered domain (for example, `app.example.com` and `api.example.com`) while keeping them as separate origins.

Keep one API instance for SQLite. Do not put credentials in source control. Create a dedicated regular demo account through registration and share isolated demo credentials with the instructor outside the repository. Set the initial admin credentials privately and share the admin demo login through the course submission channel. Confirm with the instructor/TA that Jev is an approved third-party AI provider before presenting the live endpoint.

## What Jev means here

Jev is the third-party AI classifier used by this project, not a model hosted in this repository. The backend’s `JevClassifier` sends an email subject, message text, recipient role, and time zone to the Jev API. The configured model is `jev-1.14.0`; it returns probabilities for Emergency, Urgent, and Routine. `PriorityPolicy` validates the probabilities and applies the feasibility-study thresholds to select the displayed tier. `POST /v1/classify` exposes that function to signed-in API consumers, while the API keeps `JEV_API_KEY` server-side. This is the assignment’s third-party API option, not the self-hosted-model bonus.

## Prototype boundaries

Mailbox reading/sending is still a separate optional feature with Google OAuth or manual IMAP/SMTP connections. Those mailbox connection methods do not authenticate assignment portal users. The demo inbox uses fictional samples and simulated sending. Jev classification is currently text-only; it does not fetch or classify a connected mailbox automatically and does not handle attachments.
