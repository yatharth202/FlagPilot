# FlagPilot

FlagPilot is a multi-project feature-flag management platform built with
React, Express, MongoDB, and a JavaScript SDK.

It provides project-scoped feature flags, Development and Production
environments, deterministic percentage rollouts, user/role targeting,
attribute rules, project membership and roles, Production approval
workflows, version history, analytics, event logs, audit activity, and
optional Google Sign-In and GitHub App integrations.

> **Release status:** Initial deployment / staging candidate. The
> automated backend and SDK unit tests passed against the reviewed
> source snapshot. This does not certify production readiness. Complete
> the live deployment, browser authentication, database, role
> authorization, email, SDK consumer, and provider integration checks in
> `TESTING_GUIDE.md` before onboarding external users.

## Repository layout

``` text
FlagPilot/
├── backend/                 # Express 5 API and MongoDB models
├── frontend/                # React 19 + Vite dashboard
├── sdk/                     # @flagpilot/client JavaScript SDK
├── Test_web/
│   └── consumer-test-app/    # Separate SDK consumer acceptance app
├── README.md
├── DEPLOYMENT_GUIDE.md
├── TESTING_GUIDE.md
└── RELEASE_CHECKLIST.md
```

## Technology

-   Frontend: React 19, Vite 8, React Router, Tailwind CSS, Axios.
-   Backend: Node.js (Node 22 recommended), Express 5, Mongoose.
-   Database: MongoDB replica set or sharded cluster. MongoDB
    transactions are required for audited configuration writes.
-   Shared production services: Redis for shared rate limiting/cache
    behavior; Resend for project invitation email.
-   SDK: `@flagpilot/client` version `0.2.0`, distributed as a local
    tarball in this repository (not published to npm in this release).

## Local development

Requirements: Node.js 22 recommended and npm. Use a MongoDB Atlas
deployment or local MongoDB replica set that supports transactions.
Redis is recommended locally; production requires it.

### 1. Backend

``` powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` and set at minimum:

``` env
PORT=8000
NODE_ENV=development
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_random_secret_at_least_32_characters
JWT_REFRESH_SECRET=a_different_random_secret_at_least_32_characters
FRONTEND_ORIGIN=http://localhost:5173
TRUST_PROXY=0
```

The JWT secrets must be different, random, and at least 32 characters.
Do not commit `.env`.

Install, test, and start:

``` powershell
npm ci
npm test
npm run dev
```

The API is normally available at `http://localhost:8000`. Health check:
`http://localhost:8000/health`.

### 2. Frontend

Open a second terminal:

``` powershell
cd frontend
Copy-Item .env.example .env
```

Set:

``` env
VITE_API_URL=http://localhost:8000
```

Then:

``` powershell
npm ci
npm run build
npm run lint
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

### 3. First account and project

Register a new FlagPilot account. New registrations create an isolated
starter project and the user is Owner of that project. Use the project
selector to create or switch projects. Project roles are resolved by the
backend from membership in the selected project; frontend labels are not
authorization controls.

## Automated tests

From `backend/`:

``` powershell
npm test
```

From `sdk/`:

``` powershell
npm test
```

Frontend release checks from `frontend/`:

``` powershell
npm run build
npm run lint
```

The backend and SDK test suites are unit/policy tests. They do not
replace live MongoDB integration tests, multi-user browser tests, or
provider acceptance tests. Follow `TESTING_GUIDE.md`.

## SDK usage

The SDK package is version `0.2.0` and is not currently published to
npm. Build/package it locally:

``` powershell
cd sdk
npm ci
npm test
npm pack
```

Install the generated `.tgz` into a separate JavaScript consumer
application. The supplied `Test_web/consumer-test-app` is a QA fixture,
not the FlagPilot dashboard.

Use the public project/environment client keys from **SDK & API**.
Client keys are designed to be used by client applications; they can
evaluate flags and submit analytics, but cannot manage flags. Never
place backend secrets in browser code.

See `sdk/README.md` and `Test_web/README.md` for SDK and consumer-app
details.

## Deployment

Follow `DEPLOYMENT_GUIDE.md` in order. The recommended deployment split
is:

-   Frontend: Vercel (project root directory `frontend`).
-   Backend: Render (service root directory `backend`).
-   Database: MongoDB Atlas replica set / sharded cluster.
-   Redis: managed Redis provider.
-   Invitation email: Resend with a verified sender domain.

The backend production startup intentionally requires `REDIS_URL`,
explicit HTTPS `FRONTEND_ORIGIN`, explicit `TRUST_PROXY`,
`RESEND_API_KEY`, and `EMAIL_FROM`. It also checks that MongoDB is a
replica set or sharded cluster.

## Environment variables

See:

-   `backend/.env.example`
-   `frontend/.env.example`
-   `Test_web/consumer-test-app/.env.example`

Important backend variables:

  -----------------------------------------------------------------------
  Variable                            Purpose
  ----------------------------------- -----------------------------------
  `MONGODB_URI`                       MongoDB connection string

  `JWT_SECRET`                        Access-token signing secret

  `JWT_REFRESH_SECRET`                Separate refresh-token signing
                                      secret

  `FRONTEND_ORIGIN`                   Exact allowed frontend origin(s),
                                      comma-separated

  `NODE_ENV`                          Set to `production` in the deployed
                                      API

  `REDIS_URL`                         Required in production

  `TRUST_PROXY`                       Explicit trusted proxy hop count/IP
                                      configuration

  `RESEND_API_KEY`                    Required by production startup for
                                      invitation email

  `EMAIL_FROM`                        Verified Resend sender

  `GOOGLE_CLIENT_ID`                  Optional Google OAuth client ID

  `GOOGLE_CLIENT_SECRET`              Optional Google OAuth client
                                      secret; backend only

  `GOOGLE_OAUTH_CALLBACK_URL`         Exact Google callback URL

  `GITHUB_APP_ID` etc.                Optional GitHub App integration
                                      configuration
  -----------------------------------------------------------------------

For Google and GitHub configuration, retain the dedicated setup/audit
documents. Never use `VITE_` prefixes for secrets.

## Feature flag behavior and security notes

-   A disabled flag returns its safe default, even if the user is
    explicitly targeted.
-   Explicit user targeting and role targeting take precedence over
    percentage rollout.
-   Configured attribute equality rules are an AND gate for percentage
    rollout; they do not override a 0% rollout.
-   Percentage rollout is deterministic for a stable user ID and flag
    key.
-   Production Developer changes are staged for Owner/Admin approval.
    Production rollout increases are step/cooldown limited; decreases
    and the kill switch are immediate.
-   Client-provided attributes and analytics events are untrusted input.
    Do not use feature flags as authorization controls for your own
    application APIs.

## Documentation

-   `DEPLOYMENT_GUIDE.md` --- production hosting and environment setup.
-   `TESTING_GUIDE.md` --- local, staging, role, SDK, OAuth, and GitHub
    acceptance tests.
-   `RELEASE_CHECKLIST.md` --- go/no-go checklist.
-   `backend/README.md` --- backend-specific setup, migrations,
    evaluation and audit details.
-   `GOOGLE_SIGN_IN_SETUP.md` --- Google OAuth setup.
-   `GITHUB_INTEGRATION_AUDIT.md` --- GitHub integration source review
    and live verification gaps.
-   `sdk/README.md` --- SDK API and installation.
-   `Test_web/README.md` --- consumer test app.
