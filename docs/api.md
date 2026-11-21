# Jev Priority API

Local API base: `http://localhost:8000/v1`. The client is a separate origin at `http://localhost:5173`.
JSON endpoints that require authentication use the `app_session` HttpOnly cookie. The API allows the configured `CLIENT_ORIGIN` only and requires credentialed CORS for browser clients.

## Authentication

### `POST /auth/register`

Create a standard user and sign in. Passwords must be 3–256 characters.

```json
{ "email": "student@example.test", "password": "a unique test password" }
```

Returns `201` and sets an eight-hour JWT cookie. The first administrator is created from `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` at startup; public registration cannot select a role.

### `POST /auth/login`

Accepts the same email/password JSON and returns `200` with the account id, email, and role. Repeated failures are rate-limited.

### `GET /auth/me`, `POST /auth/logout`

Return the signed-in account or revoke its server-side session record and clear the cookie. Unauthenticated requests receive `401`.

## AI service

### `POST /classify`

Requires a signed-in user. Render reads `JEV_FUNCTION_URL` and `JEV_FUNCTION_SECRET` from its server environment to invoke the Netlify Function. The browser calls the Render API with its existing session cookie.

```json
{ "subject": "Production database is unavailable", "text": "Customer requests are failing. Restore database access now." }
```

Returns a JSON object with `id`, `tier` (`Emergency`, `Urgent`, or `Routine`), `score`, `provider`, `model`, and `durationMs`. Subject is limited to 500 characters; message text is limited to 10,000. The API does not return provider credentials or raw model probabilities. Successful results are stored without the submitted subject or message text. Each inference attempt, including upstream failures, is recorded in `api_usage`.

Render returns `503` if its function URL or secret is missing or invalid. A failed function call, a gateway error, or invalid probabilities produce `502` and a failed usage record. A secret mismatch between Render and Netlify also results in `502` at the portal.

## Usage and administration

- `GET /usage/me` — authenticated user’s request and success totals.
- `GET /classifications` — the signed-in user’s latest 50 tier/score/model results; source message text is not retained.
- `GET /admin/dashboard` — administrator-only totals, registered users, and the latest 100 usage events.
- `PATCH /admin/users/{id}` — administrator-only role update; JSON body is `{ "role": "user" }` or `{ "role": "admin" }`.
- `DELETE /admin/users/{id}` — administrator-only user deletion, which also removes usage history. The current administrator and last remaining administrator are protected.
- `GET /health` — deployment health check.

Administrator routes check the role in the database on every request; hiding the dashboard in the client is not the security boundary.
