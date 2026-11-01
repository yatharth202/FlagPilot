# FlagPilot testing guide

Run this guide against a dedicated staging database and test identities.
Do not test destructive flows on production data. Never share `.env`
files, client secrets, passwords, JWTs, refresh cookies, SDK client keys
unnecessarily, or invitation tokens.

## 1. Automated release checks

Use Node.js 22 recommended.

Backend:

``` powershell
cd backend
npm ci
npm test
```

SDK:

``` powershell
cd sdk
npm ci
npm test
```

Frontend:

``` powershell
cd frontend
npm ci
npm run build
npm run lint
```

Consumer acceptance app:

``` powershell
cd Test_web/consumer-test-app
npm ci
npm run build
```

A passing unit suite does not prove the live browser, database, email,
OAuth, GitHub, or multi-instance production paths work.

## 2. Local service smoke test

1.  Configure `backend/.env` from `backend/.env.example`.
2.  Confirm `MONGODB_URI` points to a transaction-capable replica
    set/sharded cluster.
3.  Start backend with `npm run dev`.
4.  Confirm `GET /health` returns HTTP 200 and `{"status":"ok"}`.
5.  Configure `frontend/.env` with `VITE_API_URL=http://localhost:8000`.
6.  Start frontend with `npm run dev`.
7.  Register a fresh test user and verify the dashboard loads.

## 3. Authentication and sessions

Test using dedicated accounts:

-   Register with email/password.
-   Log in with valid credentials.
-   Reject invalid credentials without leaking account details.
-   Reload the dashboard and verify session restoration.
-   Log out and verify a refresh does not restore the session.
-   Verify expired/revoked refresh sessions require login.
-   Test Google sign-in only after the Google callback and consent
    screen are configured.
-   Verify Google-only accounts cannot authenticate through the password
    endpoint.
-   Verify a verified matching Google email links only according to the
    documented account-linking policy.

## 4. Project isolation and membership

1.  Register a fresh account and verify it receives a private starter
    project and Owner role.
2.  Create a second project and verify flags, client keys, settings,
    members, approvals, analytics, and audit activity remain
    project-scoped.
3.  Add a second user to a project with Developer role.
4.  Add a third user as Viewer.
5.  Verify a user can have different roles in different projects.
6.  Attempt to access another project's resources by changing the
    project selector/header. The backend must reject access if the user
    is not a member.
7.  Test invitations for existing and new users, wrong invited email,
    expiry, one-time use, resend cooldown, revocation, and duplicate
    pending invitation.

## 5. Feature flag lifecycle and evaluation

1.  Create a Boolean Development flag named `new_checkout`.
2.  Confirm a newly created flag is disabled and returns the configured
    safe default.
3.  Enable the flag and evaluate it from the dashboard.
4.  Evaluate through the separate SDK consumer app using the Development
    client key.
5.  Test rollout percentages 0%, 25%, 50%, and 100% with multiple stable
    user IDs.
6.  Repeat the same user/flag/environment combination and verify the
    assignment is deterministic.
7.  Turn the master switch OFF and verify the flag returns its safe
    default even for explicitly targeted users.
8.  Verify Development and Production values/keys do not leak across
    environments.
9.  Verify malformed or unknown keys fail closed.

## 6. Targeting precedence

The implementation's intended precedence is:

1.  Disabled flag / safe default.
2.  Explicit user target.
3.  Explicit role target.
4.  Configured AND-based equality rules.
5.  Percentage rollout.

Test:

-   At 0% rollout, an explicitly targeted user receives the flag.
-   At 0% rollout, an explicitly targeted role receives the flag.
-   With no explicit targets and 100% rollout, a matching attribute rule
    is eligible.
-   A non-matching attribute rule returns `RULE_MISS`.
-   Multiple configured rules require all rules to match.
-   Nested attributes such as `plan.tier = pro` are supported.
-   A matching attribute rule by itself does not bypass a 0% rollout.
-   Client-supplied attributes never grant access to FlagPilot
    management APIs.

## 7. Role-based authorization

Test every role with a separate account and a fresh session. For each
denied action, test both the UI and a direct authenticated API request.
Hiding a button is not authorization.

  -------------------------------------------------------------------------------
  Capability                   Owner          Admin      Developer         Viewer
  ------------------- -------------- -------------- -------------- --------------
  Read project                   Yes            Yes            Yes            Yes
  flags/evaluations                                                

  Create/change                  Yes            Yes            Yes             No
  Development flags                                                

  Directly change                Yes            Yes   No; approval             No
  Production                                                  flow 
  configuration                                                    

  Submit Production              Yes            Yes            Yes             No
  changes for                                                      
  approval                                                         

  Approve Production             Yes            Yes             No             No
  requests                                                         

  Manage                         Yes            Yes             No             No
  Developer/Viewer                                                 
  membership                                                       

  Assign/remove Admin            Yes             No             No             No

  Owner-only                     Yes             No             No             No
  project/key actions                                              

  Read permitted                 Yes            Yes            Yes            Yes
  project                                                          
  analytics/audit                                                  
  -------------------------------------------------------------------------------

Expected API behavior: 401 for unauthenticated/invalid sessions; 403 for
authenticated users without the required project permission. Verify that
a forged role value in a request header or local storage does not grant
privileges.

## 8. Production approval and rollout safeguards

1.  As Developer, submit a Development-to-Production change and verify
    it becomes pending rather than immediately changing Production.
2.  Approve as Owner/Admin and verify the submitted snapshot is applied.
3.  Attempt self-approval as the requester; it must be rejected.
4.  Change the Production flag after an approval request is created;
    verify stale approval cannot overwrite the newer configuration.
5.  Increase Production rollout and verify the configured step limit and
    cooldown.
6.  Decrease rollout and verify emergency decreases are permitted.
7.  Turn the Production kill switch OFF and verify the safe default is
    returned.

## 9. SDK consumer acceptance

The included SDK is `@flagpilot/client` version `0.2.0`; it is
distributed locally and is not published to npm in this release.

1.  Install the supplied tarball into `Test_web/consumer-test-app` as
    described in `Test_web/README.md`.
2.  Set the Development and Production public client keys from the
    project's **SDK & API** page.
3.  Configure the API URL and test flag key.
4.  Start the consumer app.
5.  Evaluate a flag with a stable user ID and attributes.
6.  Switch environments and verify the corresponding environment key is
    used.
7.  Verify a missing/wrong key fails closed.
8.  Track an exposure only when the feature is displayed; track
    conversion only after the business action succeeds.
9.  Retry the same event ID and verify idempotency.
10. Verify an event ID reused with different payload content is not
    silently counted as an identical retry.

Client keys are public environment-scoped credentials. Never put backend
secrets in the consumer app.

## 10. Analytics, logs, versions, and audit

-   Verify exposure/conversion analytics are project and environment
    scoped.
-   Verify event logs show expected records and pagination.
-   Verify audit entries are created for flag changes, targeting
    changes, approvals, membership changes, key rotation, and
    integration lifecycle changes.
-   Verify a rollback restores the intended prior version and creates an
    audit record.
-   Verify browser-submitted analytics are not treated as tamper-proof
    business, financial, or compliance evidence.

## 11. Google OAuth live acceptance

Use `GOOGLE_SIGN_IN_SETUP.md` and test on the deployed HTTPS host:

-   Google authorized JavaScript origin equals the deployed frontend
    origin.
-   Redirect URI equals `https://<api-host>/api/v1/auth/google/callback`
    exactly.
-   OAuth consent screen permits the test account.
-   Login and registration both complete.
-   Session survives reload.
-   Logout revokes the FlagPilot session.
-   Wrong/missing state, expired state, unverified email, and disallowed
    hosted domain fail closed.

Google sign-in requests identity scopes only; it does not access Gmail
inboxes.

## 12. GitHub App live acceptance

Use `GITHUB_INTEGRATION_AUDIT.md` and test only after the GitHub App and
deployed HTTPS API are configured:

-   Installation Setup URL and OAuth callback URL are exact.
-   Webhook URL is reachable.
-   Required webhook events and Repository Deployments: Read permission
    are configured.
-   Owner/Admin can connect the app and select only repositories
    available to that installation.
-   Deployment status webhook signature is validated against raw request
    bytes.
-   Duplicate delivery is idempotent.
-   Repository removal, installation suspension, uninstall, and
    disconnect update project state correctly.
-   Developer/Viewer cannot manage the integration.

Do not mark GitHub integration as operational until the complete live
flow passes.

## 13. Production smoke and monitoring

After deployment:

1.  Check `GET /health`.
2.  Register a staging account and log in.
3.  Reload to test refresh-cookie session restoration.
4.  Create/evaluate a Development flag.
5.  Evaluate through the deployed SDK consumer.
6.  Verify a Viewer cannot write through direct API calls.
7.  Send and accept a Resend invitation.
8.  Test Google OAuth if enabled.
9.  Test GitHub only if configured.
10. Inspect logs for CORS, cookie, Redis, MongoDB, rate-limit, and
    unhandled API errors.
11. Verify monitoring, alerts, database backup, and restore procedure.

## 14. Test evidence template

Record each test as:

  Field                   Value
  ----------------------- ------------------------------
  Date/time               
  Environment             Local / Staging / Production
  Commit SHA              
  Test case               
  Account role            
  Expected result         
  Actual result           
  Pass/fail               
  Evidence / request ID   
  Defect reference        

Do not store passwords, tokens, cookies, or secrets in test evidence.
