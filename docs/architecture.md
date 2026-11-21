# Architecture

```mermaid
flowchart LR
  Browser[React client\nVercel static site\nseparate origin] -->|HTTPS, JSON, HttpOnly JWT cookie| API[Express REST API\nRender web service]
  API --> Auth[Registration, password hashing, JWT sessions, role checks]
  Auth --> DB[(SQLite on persistent disk)]
  API --> Usage[Usage tracking and admin endpoints]
  Usage --> DB
  API -->|HTTPS POST with shared bearer secret| Fn[Netlify Function\njev-classify]
  Fn -->|Netlify runtime credentials| Gateway[Netlify AI Gateway]
  Gateway -->|pinned model and urgency question| Jev[Jev AI API\nmodel jev-1.14.0]
  Jev -->|urgency probabilities| Gateway
  Gateway -->|model response| Fn
  Fn -->|three validated probabilities| API
  API -->|tier, score, provider, timing| Browser
```

The browser and API are deployed independently. Express handles account authentication, role checks, priority policy, classification history, usage recording, and optional mailbox integration. SQLite persists users, session revocation records, and usage events. Netlify hosts the classification function, which submits the fixed urgency question using its managed gateway credentials. The API forwards the five classification fields and authenticates separately from the user's session.

## Data model

```mermaid
erDiagram
  APP_USERS ||--o{ APP_SESSIONS : has
  APP_USERS ||--o{ API_USAGE : generates
  APP_USERS ||--o{ CLASSIFICATION_RESULTS : receives
  MAIL_ACCOUNTS ||--o{ MAIL_MESSAGES : contains
  MAIL_ACCOUNTS ||--o{ MAIL_SENDS : records
  APP_USERS {
    string id PK
    string email UK
    string password_hash
    string role
    datetime created_at
  }
  APP_SESSIONS {
    string id PK
    string user_id FK
    integer expires_at
  }
  API_USAGE {
    string id PK
    string user_id FK
    string endpoint
    integer status
    integer duration_ms
    datetime created_at
  }
  CLASSIFICATION_RESULTS {
    string id PK
    string user_id FK
    string tier
    number score
    string model
    datetime created_at
  }
```

Classification history intentionally stores the result metadata, not the email text entered by the user.

For local development, Vite runs at `http://localhost:5173` and Express runs at `http://localhost:8000`; the browser calls the API directly with credentialed CORS. Production requires HTTPS on both origins, exact `CLIENT_ORIGIN` and `PUBLIC_URL` values, a persistent disk, and one API instance while using SQLite.
