# Jev Priority Inbox

The [public inbox](https://jev-priority-inbox-client.onrender.com/) shows Emergency and Urgent emails reviewed by Jev. Expand a priority email to read its preview. Below them, **Lower-priority emails** shows the Routine count. Expand the group to see subjects and arrival times, newest first. At startup, the API [recovers missing subjects](src/server/application/RoutineSubjectRecovery.ts) from verified Resend deliveries. Older emails show **Subject unavailable** while their titles are missing.

The same reader displays fictional samples by default and real deliveries to `priority@ionooambea.resend.app` when Resend is configured. The address panel identifies the active source.

## Email classifier demo

Regular users land on the public inbox at `/` after [signing in](https://jev-priority-inbox-client.onrender.com/login) or [creating an account](https://jev-priority-inbox-client.onrender.com/register). Select [**Try the email demo**](https://jev-priority-inbox-client.onrender.com/app) to open the classifier. Administrators land on the read-only [Admin dashboard](https://jev-priority-inbox-client.onrender.com/admin) after sign-in—displaying server-side API endpoint statistics and registered users—and see **Admin dashboard** beside the demo link on the public inbox.

Enter a subject and message on the left. The browser requests Jev through an authenticated TypeSafe relay, calculates the priority and immediately adds the result to **Jev’s decision** and **Recent classifications**. **Total response time** measures from submit until the browser has the decision. **Jev response time** measures the relay’s call to TypeSafe. **Open live email inbox** opens the reader for incoming mail. From **Recent classifications**, you can edit a saved entry's priority (`PUT /v1/classifications/:id`) or delete it (`DELETE /v1/classifications/:id`).

A visible demo checks for new history every five minutes. These account reads keep the API available while the demo is on screen. Hidden tabs pause the timer. After a long absence, returning to the demo starts a history read and can wake the free Render API. [History refresh](src/client/DemoHistoryRefresh.ts) · [Visibility tests](tests/demo-history-refresh.test.ts)

The API records each user's counted functional API requests in Neon (`api_user_endpoint_stats`) alongside classification receipts in `api_usage`. Every registered account includes 20 free API calls; once exhausted, the API signals the limit via `GET /v1/usage/me` and `X-API-*` headers while continuing service, and the client displays the user's call count and warning banner. The browser retries unconfirmed receipts in the background and when you reconnect or reopen the demo. Receipts contain only result metadata.

Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` together on the API service to create the initial administrator. Use an unused address. Restarts preserve existing accounts and passwords. Public registrations always receive the user role. For another frontend host, set `CLIENT_ORIGIN` to its exact origin. An existing `APP_JWT_SECRET` of at least 32 bytes is supported. Otherwise the API creates a private random signing key in Neon so sessions survive redeploys. Keep credentials and signing keys out of submissions.

## Run locally

Use Node.js 24 or newer and run these commands from the repository root.

```sh
npm ci
cp -n .env.example .env
```

In the server's `.env`, set `DATABASE_URL` to a development PostgreSQL connection string. A local example after running `createdb jev_inbox` is `postgresql://localhost/jev_inbox`. Set `TYPESAFE_API_KEY` for the browser demo and `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` for inbox reviews. Run `npm run dev`, then open `http://localhost:5173`. The API runs on port 8000.

In sample mode the API queues nine fictional deliveries. In receiving mode it queues each verified Resend email ID once. PostgreSQL stores the queue and Jev's decisions. Refreshing the page reads the saved results.

## Connect Neon

1. In the Neon project, choose **Connect**, select the production branch and database, enable **Connection pooling**, and copy the full connection string with its SSL parameters. [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app)
2. In Render, open **jev-priority-inbox-api → Environment** and set `DATABASE_URL` to that string. Choose **Save only** to prepare it for the next deploy.
3. To retain existing mail, take a consistent SQLite backup **before redeploying** the old Render service. Run `npm run import:sqlite -- /path/to/backup.sqlite` with the target `DATABASE_URL` set. The [importer](src/server/infrastructure/SqliteInboxImport.ts) copies public inbox IDs, stored decisions, previews and unfinished jobs. Rerunning skips existing deliveries. Coordinate the final backup with incoming webhooks so deliveries after the backup can be replayed from Resend.
4. Deploy the updated backend. The API applies the [inbox schema](db/priority-inbox.sql) before accepting requests. Verify `/v1/health` reports `storage: postgresql` and `/v1/priority` returns the inbox. Both checks work without sending a test email.

## Connect the Resend inbox

1. Create a Resend API key with permission to retrieve received emails. Store it as `RESEND_API_KEY` on the Render **API web service**.
2. Once this version of the API is deployed, create a Resend webhook for `email.received` at `https://jev-priority-inbox-api.onrender.com/v1/inbound`. Copy its signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET` on that same Render service and save and deploy. Netlify uses the separate `JEV_FUNCTION_SECRET` for classification. [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
3. The client will show the real receiving address. Send one email with a distinctive subject to that address. Check the Receiving tab and the webhook delivery status in Resend, then the public inbox for a priority result. This integration processes webhook deliveries. Emails received before the webhook existed stay available in the Resend dashboard. [Manage received emails](https://resend.com/docs/dashboard/receiving/manage-emails)

The [Resend adapter](src/server/adapters/ResendMailbox.ts) checks the actual delivery recipients, retrieves plain text or converts HTML, and skips attachments. The [inbound integration tests](tests/resend-inbound.test.ts) use simulated providers. Both Resend secrets belong only on the API service.

## Deploy

- **Render API and client.** [render.yaml](render.yaml) configures both services. Set a native `TYPESAFE_API_KEY` on **jev-priority-inbox-api** for the demo. The relay calls `https://api.typesafe.ai/v1/systemone` by default. Keep `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` on the API for incoming mail. The static client uses `VITE_API_URL` and publishes `dist/client`. [TypeSafe API reference](https://docs.typesafe.ai/api/system-one)
- **Storage.** The API uses the server-only `DATABASE_URL` for public inbox receipts and private portal accounts. The [portal schema](db/portal.sql) is applied at startup. The archived connected-mailbox and offline study modules use their own SQLite files.
- **Netlify Function.** [netlify.toml](netlify.toml) deploys [jev-classify](netlify/functions/jev-classify.ts) from `main` to `isa-term-project`. Set the same `JEV_FUNCTION_SECRET` on the function. Netlify AI Gateway supplies `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL`. Enable AI features, complete a production deploy and allow public access to the production function so Render can reach it. [AI Gateway configuration](https://docs.netlify.com/build/ai-gateway/overview/)
- **Automatic Jev deployments.** The repository owner registers the Netlify SSH public key with read-only access and subscribes the Netlify GitHub webhook to push events with content type `application/json`. [Repository linking guide](https://answers.netlify.com/t/support-guide-linking-a-repository-via-api/121)
- **Verify.** Visit `/v1/health` on the API, then open the client in a fresh browser. The inbox loads without a session. `GET /v1/priority` reports the saved cards and any pending or failed reviews.

## Development

Install PostgreSQL server utilities (`pg_config`, `initdb`, `pg_ctl`) and run the tests under a regular OS user. The [test runner](tests/with-postgres.mjs) starts a disposable local PostgreSQL cluster for each suite. It supplies isolated database and provider settings. [PostgreSQL tests](tests/postgres-inbox.test.ts) cover concurrent workers, restart recovery and importing existing SQLite decisions.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The [public reader](src/client/PriorityInbox.tsx), its [styles](src/client/priority-inbox.css), and its [labels](src/locales/priorityInbox.ts) define the page. The [public API](src/server/http/PublicInboxApi.ts) reads the [priority inbox](src/server/application/PublicPriorityInbox.ts). Its [regression tests](tests/public-priority-inbox.test.ts) cover admission, recovery, and isolation from private mail.

The [portal UI](src/client/Portal.tsx) uses [localized copy](src/locales/portal.ts) and a [shared response contract](src/shared/portal.ts). [Navigation tests](tests/portal-navigation.test.ts) cover the [sign-in and role redirects](src/client/PortalNavigation.ts). [PortalApi](src/server/application/PortalApi.ts) uses [PortalAuth](src/server/application/PortalAuth.ts) and [PostgresPortal](src/server/infrastructure/PostgresPortal.ts). [Browser tests](tests/browser/portal.spec.ts) use a [loopback Jev stand-in](tests/browser-jev.ts).

The [browser demo](src/client/ClassifierDemo.tsx) applies the [shared priority policy](src/shared/PriorityPolicy.ts) and [retries receipts](src/client/DemoReceipts.ts). The [relay](src/server/application/BrowserDemoApi.ts) uses the [TypeSafe adapter](src/server/adapters/TypeSafeJev.ts). [Integration tests](tests/browser-demo.test.ts) cover delayed writes, usage and replay.

The optional `npm run compare` command also requires `GEMINI_API_KEY` for the model comparison. See the [API contract](docs/api.md) and [architecture](docs/architecture.md) for the public demo.
