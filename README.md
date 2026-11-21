# Jev Priority Inbox

Jev Priority Inbox classifies email text by urgency through a protected REST API, records each inference request, and provides a user page and administrator usage dashboard. The Render API sends classification requests to an authenticated Netlify Function. The function calls Jev through Netlify AI Gateway and returns three probabilities. Render applies the project’s priority policy and saves the result.

## Requirements and local setup

- Node.js 24 or newer
- A Netlify Function URL and shared secret for live classification (see [Jev setup](#set-up-jev-on-netlify-free))
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

Also set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`. For live classification, copy `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` from the Jev setup below into the server's `.env`. Local defaults use `CLIENT_ORIGIN=http://localhost:5173`, `VITE_API_URL=http://localhost:8000`, and `PUBLIC_URL=http://localhost:8000`.

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

The repository includes a Render blueprint for the API and Vercel configuration for the client. Deploy the API first, attach its persistent disk, and configure `PUBLIC_URL` to the API HTTPS URL, `CLIENT_ORIGIN` to the client HTTPS URL, plus `APP_JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_PASSWORD`. Set Vercel’s `VITE_API_URL` to the Render API HTTPS URL and deploy the client. Redeploy the client after changing `VITE_API_URL`, which is embedded at build time. For reliable browser cookie behavior, use two HTTPS subdomains under the same registered domain (for example, `app.example.com` and `api.example.com`).

Keep one API instance for SQLite. Do not put credentials in source control. Create a dedicated regular demo account through registration and share isolated demo credentials with the instructor outside the repository. Set the initial admin credentials privately and share the admin demo login through the course submission channel. Confirm with the instructor/TA that Jev is an approved third-party AI provider before presenting the live endpoint.

### Set up Jev on Netlify Free

1. Use the existing Netlify project `isa-term-project` on the credit-based Free plan. Its production source is `JonahBotelho/jev-priority-inbox` on `main`. Merge the function and [netlify.toml](netlify.toml) together. The repository root is the base, `dist/netlify-public` is the static publish directory, and `netlify/functions` contains the Jev function. The Free plan includes 300 shared credits per month. [Netlify Free plan](https://www.netlify.com/pricing/personal-vs-free/)
2. Generate one new server-to-server secret locally with `openssl rand -hex 32`. In the Netlify project's **Environment variables**, add it as `JEV_FUNCTION_SECRET` for **Production**, with the Free plan's default scope. Save the same value for Render. Netlify supplies `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` at function runtime. Leave those two variables unset in user-managed settings. [AI Gateway configuration](https://docs.netlify.com/build/ai-gateway/overview/)
3. Confirm **Team settings → AI enablement** is on and run a production deploy after saving the secret. Netlify activates AI Gateway after the first production deploy. Under **Project configuration → General → Visitor access → Project visibility**, set this project's production deploy to **Public** so Render can reach the function. The function authenticates every classification request. [Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
4. On the existing Render API service, open **Environment**. Set `JEV_FUNCTION_URL` to `https://YOUR-SITE.netlify.app/.netlify/functions/jev-classify`, using the production hostname, and `JEV_FUNCTION_SECRET` to the value from step 2. Save the variables and deploy this revision. Local Express can use the same two values in `.env`. [Render environment settings](https://render.com/docs/configure-environment-variables)
5. Sign in to the existing web client and classify a fictional message. A successful `POST /v1/classify` returns `provider: "Jev"` and `model: "jev-1.14.0"` and adds a history entry. To check reachability first, send a `POST` to the function URL without a token. A configured function returns `401` before calling Jev.

For a manual deployment from another checkout, use Node 24, run `npm ci` and `npx netlify-cli login`, then run `npx netlify-cli link` and select `isa-term-project`. From a linked checkout, `npx netlify-cli deploy --prod` publishes the function using the project's existing settings. [Netlify CLI setup](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)

## What Jev means here

Jev supplies the assignment’s third-party AI service. The [function](netlify/functions/jev-classify.ts) submits the email subject, text, arrival time, recipient role and time zone using the [shared classification contract](src/shared/jev.ts). Render’s `PriorityPolicy` applies the feasibility-study thresholds to the Emergency, Urgent and Routine probabilities. The [function tests](tests/jev-function.test.ts) cover its access and response checks. The [portal integration test](tests/portal-api.test.ts) covers the full request path using a simulated gateway response.

## Prototype boundaries

Mailbox reading/sending is still a separate optional feature with Google OAuth or manual IMAP/SMTP connections. Those mailbox connection methods do not authenticate assignment portal users. The demo inbox uses fictional samples and simulated sending. Jev classification is currently text-only; it does not fetch or classify a connected mailbox automatically and does not handle attachments.
