# FlagPilot backend

The API is an Express 5/Mongoose service. Management routes require a user session and project membership. Public SDK evaluation and analytics ingestion require an environment-specific project client key.

## Local setup

Copy `.env.example` to `.env`, configure MongoDB and two different random JWT secrets, then run:

```powershell
npm ci
npm test
npm run dev
```

MongoDB must support transactions (replica set or sharded cluster) for atomic configuration/audit writes. Standalone MongoDB is rejected by default. `MONGODB_ALLOW_NON_TRANSACTIONAL_DEV=true` is a development-only escape hatch and must never be used with client or production data.

## Database migrations

Back up MongoDB and stop the API before applying migrations. Use the order matching the source database version. For an older database that predates tenant scoping/multi-project support, the migration sequence is:

```powershell
npm run migrate:tenant-scope
npm run migrate:multi-project
npm run migrate:analytics-idempotency
npm run migrate:audit-logs
npm run migrate:indexes
```

Do not run this sequence blindly on a database already migrated to the current schema. Review the tenant-scope migration's assignment report before client use. The `migrate:indexes` script creates/verifies indexes; it does not remove arbitrary obsolete custom indexes. Any legacy index cleanup must be a separate, inspected migration.

For databases that still have the exact obsolete global unique index `name_1` on `{ name: 1 }`, the repository includes `scripts/dropLegacyGlobalFlagNameIndex.js`. It is deliberately separate from the general index initializer: it first verifies the project-scoped `project_key_environment_unique` index and then drops only that exact legacy `name_1` definition. Back up MongoDB and inspect `listIndexes` before running it; do not use it against an unexpected index definition.

## Evaluation and rollout semantics

Evaluation precedence is: disabled kill switch/default; explicit user target; explicit role target; configured AND-based equality rules; percentage rollout. If attribute rules are configured and do not all match, the evaluator returns `RULE_MISS`; it does not fall through to percentage rollout. Attribute rules are an eligibility gate, not a 0%-rollout override. Explicit user/role targets take precedence over rollout and rules. Client-supplied attributes are untrusted and must never be used as authorization.

The evaluation cache keys include project, environment and normalized flag key. Production requires shared Redis; on cache failure evaluation bypasses the cache and reads MongoDB. The existing rollout hash formula is intentionally stable across versions and environments to preserve user assignments.

## Audit integrity

Configuration and audit writes use MongoDB transactions. Mongoose blocks update/delete operations against the AuditLog model, but application middleware is not a database security boundary. For production, use a dedicated runtime MongoDB role with `find` and `insert` (not `update` or `remove`) on `auditlogs`; use a separate migration credential with the permissions needed for upgrades. See `AUDIT_LOG_DB_ROLE.md`.

## Project roles

- Owner: full project control, including Admin assignment, project settings and client-key rotation.
- Admin: manage flags, team membership/invitations and approvals; cannot grant or remove Admins or perform Owner-only project/key actions.
- Developer: create and modify Development flags; submit Production changes for approval.
- Viewer: read-only access.

The backend computes the role from the selected project's membership; a JWT/user-level role or frontend control is not authoritative.

## Email invitations

Configure `RESEND_API_KEY`, `EMAIL_FROM`, and the deployed `FRONTEND_ORIGIN`. Production requires a verified Resend sender and an HTTPS frontend origin. Development without provider configuration returns a copyable local invitation link; this behavior is disabled in production. Invitation tokens are random, one-time, expire, are carried in the URL fragment, and are stored in MongoDB only as SHA-256 hashes. The invitation acceptance flow supports both existing accounts and users who register with the invited email.

## GitHub App integration

The integration is optional and remains disabled until these backend values are configured:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL` (exact HTTPS URL ending in `/api/v1/github/oauth/callback`)

Configure the GitHub App Setup URL as `/api/v1/github/installations/callback`, the OAuth callback as `/api/v1/github/oauth/callback`, and the webhook endpoint as `/api/v1/github/webhooks`. Subscribe to `deployment_status`, `installation`, and `installation_repositories` events and grant Repository Deployments: Read permission.

The installation flow uses one-time hashed state bound to a FlagPilot project/user; the subsequent OAuth step verifies that the GitHub user can access the installation ID returned by the Setup URL. Installation access tokens are short-lived and not persisted. Repository selection is checked against GitHub's installation API. The webhook route receives raw request bytes and validates `X-Hub-Signature-256` before parsing JSON, then deduplicates deliveries and writes project-scoped deployment/audit records transactionally.

The source-level GitHub policy tests pass, but a real GitHub App installation, OAuth callback, repository sync, webhook delivery/redelivery, suspension, removal and disconnect have not been certified without a configured App and deployed HTTPS endpoint. See the root `TESTING_GUIDE.md`.

## Production runtime requirements

When `NODE_ENV=production`, the server requires `REDIS_URL`, an explicit HTTPS `FRONTEND_ORIGIN`, explicit `TRUST_PROXY`, `RESEND_API_KEY`, and `EMAIL_FROM`. It also requires a MongoDB replica set or sharded cluster. Keep all credentials in a hosting secret manager, never in the repository or browser bundle.


### Google Sign-In

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_OAUTH_CALLBACK_URL` together to enable Google OpenID Connect sign-in. Leave all three unset to disable Google sign-in. Run `npm run migrate:indexes` after deploying this change to create the unique Google-subject and short-lived OAuth-state indexes. Google sign-in requests only `openid email profile`; it does not access Gmail inboxes. Invitation mail remains a separate Resend integration. See the repository root `GOOGLE_SIGN_IN_SETUP.md` for the complete Google Cloud Console setup.
