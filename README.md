# Jev Priority Inbox

The [public inbox](https://jev-priority-inbox-client.onrender.com/) shows Emergency and Urgent emails reviewed by Jev. The same reader displays fictional samples by default and real deliveries to `priority@ionooambea.resend.app` when Resend is configured. The address panel identifies the active source. Expand a row to read its preview.

## Run locally

Use Node.js 24 or newer and run these commands from the repository root.

```sh
npm ci
cp -n .env.example .env
```

In the server's `.env`, set `JEV_FUNCTION_URL` to the deployed function URL and `JEV_FUNCTION_SECRET` to its shared bearer secret. Run `npm run dev`, then open `http://localhost:5173`. The API runs on port 8000.

In sample mode the API queues the nine approved fictional deliveries. In receiving mode it queues a Resend email ID after verifying its webhook. Jev reviews pending mail and SQLite saves the decisions. Refreshing the page reads those results. The UI reports pending or failed reviews.

## Connect the Resend inbox

1. Create a Resend API key with permission to retrieve received emails. Store it as `RESEND_API_KEY` on the Render **API web service**.
2. Once this version of the API is deployed, create a Resend webhook for `email.received` at `https://jev-priority-inbox-api.onrender.com/v1/inbound`. Copy its signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET` on that same Render service and save and deploy. Netlify uses the separate `JEV_FUNCTION_SECRET` for classification. [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
3. The client will show the real receiving address. Send one email with a distinctive subject to that address. Check the Receiving tab and the webhook delivery status in Resend, then the public inbox for a priority result. This integration processes webhook deliveries. Emails received before the webhook existed stay available in the Resend dashboard. [Manage received emails](https://resend.com/docs/dashboard/receiving/manage-emails)

The [Resend adapter](src/server/adapters/ResendMailbox.ts) checks the actual delivery recipients, retrieves plain text or converts HTML, and skips attachments. The [inbound integration tests](tests/resend-inbound.test.ts) use simulated providers. Both Resend secrets belong only on the API service.

## Deploy

- **Render API and client.** [render.yaml](render.yaml) configures the Node web service and the static site. Set `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` on the API. On the client, set `VITE_API_URL` to the API origin and redeploy after changing it. The static publish directory is `dist/client`.
- **Storage.** The API uses `SQLITE_PATH`, defaulting to `./data/mail.sqlite`. Render Free has ephemeral local storage. A storage reset clears saved decisions and delivery IDs. Use durable storage to retain live history and deduplication across such resets.
- **Netlify Function.** [netlify.toml](netlify.toml) deploys [jev-classify](netlify/functions/jev-classify.ts) from `main` to `isa-term-project`. Set the same `JEV_FUNCTION_SECRET` on the function. Netlify AI Gateway supplies `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL`. Enable AI features, complete a production deploy and allow public access to the production function so Render can reach it. [AI Gateway configuration](https://docs.netlify.com/build/ai-gateway/overview/)
- **Automatic Jev deployments.** The repository owner registers the Netlify SSH public key with read-only access and subscribes the Netlify GitHub webhook to push events with content type `application/json`. [Repository linking guide](https://answers.netlify.com/t/support-guide-linking-a-repository-via-api/121)
- **Verify.** Visit `/v1/health` on the API, then open the client in a fresh browser. The inbox loads without a session. `GET /v1/priority` reports the saved cards and any pending or failed reviews.

## Development

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The [public reader](src/client/PriorityInbox.tsx), its [styles](src/client/priority-inbox.css), and its [labels and placeholder address](src/locales/priorityInbox.ts) define the page. The [public API](src/server/http/PublicInboxApi.ts) reads the [public demo inbox](src/server/application/PublicPriorityInbox.ts). Its [regression tests](tests/public-priority-inbox.test.ts) cover admission, recovery, and isolation from private mail.

The optional `npm run compare` command also requires `GEMINI_API_KEY` for the model comparison. See the [API contract](docs/api.md) and [architecture](docs/architecture.md) for the public demo.
