// OpenAPI contract and the hosted Swagger UI page for the public API.
import type { Express } from "express";

const json = (example: unknown, description = "JSON response") => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
      example,
    },
  },
});

const error = (status: number, message: string) =>
  json({ error: message }, `HTTP ${status}`);

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Jev Priority Inbox API",
    version: "1.0.0",
    description:
      "Version 1 API for the public priority inbox, account portal, and authenticated email classification demo. The API version is expressed by the `/v1` URL prefix. The classifier model currently reports `jev-1.14.0` in result payloads.",
  },
  servers: [{ url: "/", description: "This API server" }],
  tags: [
    { name: "Inbox", description: "Public inbox snapshot and liveness." },
    { name: "Inbound mail", description: "Signed Resend webhook delivery." },
    {
      name: "Authentication",
      description: "Account registration and cookie sessions.",
    },
    {
      name: "Classification",
      description: "Authenticated classifier and saved results.",
    },
    {
      name: "Demo relay",
      description: "Authenticated Jev inference relay and signed receipts.",
    },
    { name: "Usage", description: "Caller usage and free-call quota." },
    {
      name: "Administration",
      description: "Administrator-only account and endpoint statistics.",
    },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "app_session",
        description:
          "Set by registration or login. HttpOnly, signed, and valid for eight hours. In production it is Secure, SameSite=None, and Partitioned.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
        example: { error: "Invalid request." },
      },
      Account: {
        type: "object",
        required: ["id", "email", "role"],
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["user", "admin"] },
        },
        example: {
          id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
          email: "user@example.com",
          role: "user",
        },
      },
      ClassificationInput: {
        type: "object",
        required: ["subject", "text"],
        properties: {
          subject: { type: "string", minLength: 1, maxLength: 500 },
          text: { type: "string", minLength: 1, maxLength: 10000 },
          role: {
            type: "string",
            maxLength: 120,
            default: "On-call service owner",
          },
          timeZone: { type: "string", default: "America/Vancouver" },
        },
        example: {
          subject: "Checkout is down",
          text: "Payments are failing for every customer right now.",
        },
      },
      TierUpdate: {
        type: "object",
        required: ["tier"],
        properties: {
          tier: { type: "string", enum: ["Emergency", "Urgent", "Routine"] },
        },
        example: { tier: "Urgent" },
      },
    },
  },
  paths: {
    "/v1/health": {
      get: {
        tags: ["Inbox"],
        summary: "Check API liveness",
        responses: {
          "200": json({ status: "ok", storage: "postgresql" }),
          "503": error(503, "Service unavailable."),
        },
      },
    },
    "/v1/priority": {
      get: {
        tags: ["Inbox"],
        summary: "Read the public priority inbox",
        description:
          "No authentication. Emergency and Urgent cards are returned, plus the Routine count. Set `include=routine` to include Routine message IDs, subjects, and arrival times. `reviewAvailable` indicates whether automatic review is configured.",
        parameters: [
          {
            in: "query",
            name: "include",
            required: false,
            schema: { type: "string", enum: ["routine"] },
            description: "Include the Routine message list.",
          },
        ],
        responses: {
          "200": json(
            {
              cards: [
                {
                  id: "example-id",
                  tier: "Emergency",
                  subject: "Checkout is down",
                  preview: "Payments are failing for every customer right now.",
                  receivedAt: "2026-11-20T18:10:00.000Z",
                },
              ],
              routineCount: 2,
              processing: { pending: 0, failed: 0 },
              reviewAvailable: true,
            },
            "Inbox snapshot. When live receiving is configured, `receivingAddress` is also present; with include=routine, `routineMessages` is also present.",
          ),
          "503": error(503, "Inbox snapshot unavailable."),
        },
      },
    },
    "/v1/inbound": {
      post: {
        tags: ["Inbound mail"],
        summary: "Accept a Resend webhook",
        description:
          "Resend must send the raw `email.received` JSON body and Svix signature headers. The signature and timestamp are verified before an email is accepted. A valid unrelated event is acknowledged with 200. Delivery processing continues asynchronously after the durable receipt is stored.",
        parameters: [
          ...["svix-id", "svix-timestamp", "svix-signature"].map((name) => ({
            in: "header",
            name,
            required: true,
            schema: { type: "string" },
          })),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description:
                  "Raw Resend webhook event; must be signed with the configured webhook secret.",
              },
              example: {
                type: "email.received",
                created_at: "2026-11-20T18:10:00.000Z",
                data: {
                  email_id: "8b7d3f5e-0a57-4ef1-9170-d36f79c26300",
                  created_at: "2026-11-20T18:10:00.000Z",
                  to: ["priority@ionooambea.resend.app"],
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Accepted delivery, duplicate delivery, or valid unrelated event.",
          },
          "400": error(400, "Invalid delivery metadata."),
          "401": error(401, "Webhook signature verification failed."),
          "415": error(415, "Expected application/json."),
          "503": error(
            503,
            "Receiving is not configured or durable storage failed.",
          ),
        },
      },
    },
    "/v1/auth/register": {
      post: {
        tags: ["Authentication"],
        summary: "Create a regular account",
        description:
          "Passwords must be 3–256 characters. Registration always grants the user role. On success sets the app_session cookie.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email", maxLength: 254 },
                  password: { type: "string", minLength: 3, maxLength: 256 },
                },
              },
              example: {
                email: "user@example.com",
                password: "example-password",
              },
            },
          },
        },
        responses: {
          "201": json(
            {
              id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
              email: "user@example.com",
              role: "user",
            },
            "Account created; sets the session cookie.",
          ),
          "400": error(400, "Invalid email or password."),
          "409": error(409, "Email already registered or reserved."),
          "503": error(503, "Service unavailable."),
        },
      },
    },
    "/v1/auth/login": {
      post: {
        tags: ["Authentication"],
        summary: "Start an account session",
        description:
          "Sets the app_session cookie on success. Login is limited to 10 attempts per client IP per minute.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 3, maxLength: 256 },
                },
              },
              example: {
                email: "user@example.com",
                password: "example-password",
              },
            },
          },
        },
        responses: {
          "200": json(
            {
              id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
              email: "user@example.com",
              role: "user",
            },
            "Signed in; sets the session cookie.",
          ),
          "401": error(401, "Invalid credentials."),
          "429": error(429, "Too many login attempts. Try again later."),
          "503": error(503, "Service unavailable."),
        },
      },
    },
    "/v1/auth/me": {
      get: {
        tags: ["Authentication"],
        summary: "Get the current account",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json({
            id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
            email: "user@example.com",
            role: "user",
          }),
          "401": error(401, "Missing, invalid, or expired session."),
        },
      },
    },
    "/v1/auth/logout": {
      post: {
        tags: ["Authentication"],
        summary: "End the current session",
        description:
          "Revokes a valid session and clears the cookie. This endpoint also succeeds when already signed out.",
        responses: {
          "204": { description: "Session ended and cookie cleared." },
          "503": error(503, "Service unavailable."),
        },
      },
    },
    "/v1/classify": {
      post: {
        tags: ["Classification"],
        summary: "Classify an email",
        description:
          "Requires a session. Subject is limited to 500 characters and text to 10,000. `role` and `timeZone` are optional classifier context fields. The API sets the received time itself, classifies with Jev, and returns its decision.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClassificationInput" },
              example: {
                subject: "Checkout is down",
                text: "Payments are failing for every customer right now.",
              },
            },
          },
        },
        responses: {
          "200": json({
            id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
            tier: "Emergency",
            score: 97,
            model: "jev-1.14.0",
            provider: "Jev",
            durationMs: 812,
          }),
          "400": error(400, "Invalid classification input."),
          "401": error(401, "Missing, invalid, or expired session."),
          "502": error(502, "Classification provider failed."),
          "503": error(503, "Classifier is not configured."),
        },
      },
    },
    "/v1/demo/inference": {
      post: {
        tags: ["Demo relay"],
        summary: "Request a Jev inference",
        description:
          "Requires a session. Input fields and limits match /v1/classify. The inference is signed by the API for durable receipt recording.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClassificationInput" },
              example: {
                subject: "Checkout is down",
                text: "Payments are failing for every customer right now.",
              },
            },
          },
        },
        responses: {
          "200": json({
            inference: {
              id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
              userId: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
              createdAt: "2026-11-20T18:10:00.000Z",
              durationMs: 812,
              model: "jev-1.14.0",
              probabilities: { Emergency: 0.97, Urgent: 0.02, Routine: 0.01 },
              inputTokens: 120,
              outputTokens: 20,
            },
            signature: "base64url-signature",
          }),
          "400": error(400, "Invalid classification input."),
          "401": error(401, "Missing, invalid, or expired session."),
          "502": error(502, "Inference provider failed."),
          "503": error(503, "Classifier is not configured."),
        },
      },
    },
    "/v1/demo/receipts": {
      post: {
        tags: ["Demo relay"],
        summary: "Record a signed inference receipt",
        description:
          "Requires a session. The inference must belong to the current account and carry its original API signature. Replaying the same valid receipt is safe.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["inference", "signature"],
                properties: {
                  inference: { type: "object" },
                  signature: { type: "string" },
                },
              },
              example: {
                inference: {
                  id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
                  userId: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
                  createdAt: "2026-11-20T18:10:00.000Z",
                  durationMs: 812,
                  model: "jev-1.14.0",
                  probabilities: {
                    Emergency: 0.97,
                    Urgent: 0.02,
                    Routine: 0.01,
                  },
                  inputTokens: 120,
                  outputTokens: 20,
                },
                signature: "base64url-signature",
              },
            },
          },
        },
        responses: {
          "204": { description: "Receipt durably recorded." },
          "400": error(
            400,
            "Receipt is invalid, has an invalid signature, or belongs to another account.",
          ),
          "401": error(401, "Missing, invalid, or expired session."),
        },
      },
    },
    "/v1/classifications": {
      get: {
        tags: ["Classification"],
        summary: "List saved classifications",
        description:
          "Returns up to 50 latest non-deleted successful classifications for the signed-in account.",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json({
            results: [
              {
                id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
                tier: "Emergency",
                score: 97,
                model: "jev-1.14.0",
                createdAt: "2026-11-20T18:10:00.000Z",
              },
            ],
          }),
          "401": error(401, "Missing, invalid, or expired session."),
        },
      },
    },
    "/v1/classifications/{id}": {
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
          description: "Classification UUID.",
        },
      ],
      put: {
        tags: ["Classification"],
        summary: "Update a saved classification tier",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TierUpdate" },
            },
          },
        },
        responses: {
          "200": json({
            id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
            tier: "Urgent",
            score: 72,
            model: "jev-1.14.0",
            createdAt: "2026-11-20T18:10:00.000Z",
          }),
          "400": error(400, "Invalid UUID or tier."),
          "401": error(401, "Missing, invalid, or expired session."),
          "403": error(403, "Classification belongs to another account."),
          "404": error(404, "Classification not found or deleted."),
        },
      },
      delete: {
        tags: ["Classification"],
        summary: "Delete a saved classification",
        description:
          "Soft-deletes the caller’s own result; usage audit records are preserved.",
        security: [{ sessionCookie: [] }],
        responses: {
          "204": { description: "Classification deleted." },
          "400": error(400, "Invalid UUID."),
          "401": error(401, "Missing, invalid, or expired session."),
          "403": error(403, "Classification belongs to another account."),
          "404": error(404, "Classification not found or already deleted."),
        },
      },
    },
    "/v1/usage/me": {
      get: {
        tags: ["Usage"],
        summary: "Read own API usage and quota",
        description:
          "This read does not count toward API usage. Authenticated responses include X-API-Usage-Count, X-API-Free-Limit, and X-API-Limit-Exceeded headers. Reaching the 20-call free limit does not block service.",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json({
            requests: 4,
            freeLimit: 20,
            remainingFreeCalls: 16,
            limitExceeded: false,
            warning: null,
            successful: 3,
            lastRequest: "2026-11-20T18:10:00.000Z",
            netlifyCreditBalance: null,
          }),
          "401": error(401, "Missing, invalid, or expired session."),
        },
      },
    },
    "/v1/admin/dashboard": {
      get: {
        tags: ["Administration"],
        summary: "Read account and endpoint statistics",
        description:
          "Administrator session required. Includes registered accounts and tracked authenticated endpoint counts; health, auth/session routes, documentation, preflight requests, and 401/403 rejections are excluded.",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json({
            users: [
              {
                id: "d9428888-122b-4a7e-a5e5-448a7e44e7a1",
                email: "user@example.com",
                role: "user",
                createdAt: "2026-11-20T18:10:00.000Z",
                requests: 4,
              },
            ],
            endpoints: [
              { method: "POST", endpoint: "/v1/classify", requests: 4 },
            ],
          }),
          "401": error(401, "Missing, invalid, or expired session."),
          "403": error(403, "Administrator role required."),
        },
      },
    },
  },
};

const documentationPage = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Jev Priority Inbox API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true,withCredentials:true});</script>
</body></html>`;

export function mountApiDocumentation(app: Express): void {
  app.get(["/doc", "/doc/"], (_request, response) =>
    response.type("html").send(documentationPage),
  );
  app.get("/openapi.json", (_request, response) =>
    response.json(openApiDocument),
  );
}
