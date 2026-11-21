# Jev Priority Inbox

The [public demo](https://jev-priority-inbox-client.onrender.com/) opens straight to the inbox. The address at the top is a placeholder for future inbound delivery. The list contains fictional sample emails that Jev classified as Emergency or Urgent. Expand a row to read its message preview. The home page, `/inbox`, and `/demo` share the same reader.

## Run locally

Use Node.js 24 or newer and run these commands from the repository root.

```sh
npm ci
cp -n .env.example .env
```

In the server's `.env`, set `JEV_FUNCTION_URL` to the deployed function URL and `JEV_FUNCTION_SECRET` to its shared bearer secret. Run `npm run dev`, then open `http://localhost:5173`. The API runs on port 8000.

At startup the API queues the nine approved sample deliveries. It submits pending samples to `jev-1.14.0` and saves each decision in SQLite. Readers see confirmed messages as reviews finish. Refreshing the page reads saved results. A missing relay configuration or failed review is visible in the UI. Routine messages stay out of the priority list.

## Deploy

- **Render API and client.** [render.yaml](render.yaml) configures the Node web service and the static site. Set `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` on the API. On the client, set `VITE_API_URL` to the API origin and redeploy after changing it. The static publish directory is `dist/client`.
- **Storage.** The API uses `SQLITE_PATH`, defaulting to `./data/mail.sqlite`. Render Free has ephemeral local storage. If that file resets, the API reviews the sample deliveries again.
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
