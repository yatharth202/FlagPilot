# FlagPilot frontend

React 19 + Vite 8 + Tailwind CSS dashboard for the FlagPilot API.

## Local development

1. Start MongoDB and the backend first; see the repository-root `README.md`.
2. Copy `.env.example` to `.env` and set `VITE_API_URL` to the backend origin without `/api/v1` (the Axios client appends that path). Default: `http://localhost:8000`.
3. Run:

   ```powershell
   npm ci
   npm run dev
   ```

4. Release checks:

   ```powershell
   npm run build
   npm run lint
   ```

## Main screens

- `/login`, `/register`: authentication and onboarding.
- `/dashboard`: feature flag creation, environment selection, rollout, targeting, live decision inspection, and version history/rollback.
- `/analytics`: project/environment-scoped exposure and conversion aggregates.
- `/logs`: project/environment-scoped event logs.
- `/activity`: project-scoped audit history.
- `/developers`: SDK keys, package and installation guidance, team invitations, and Production approval queue.
- `/integrations`: GitHub App connections, repository selection, and verified deployment activity (requires a configured GitHub App on the backend).

The customer checkout simulation is intentionally not embedded in the dashboard. Use the separate `Test_web/consumer-test-app` to test the SDK as an independent consuming application. AI engineering agent and MCP features are not part of this release.
