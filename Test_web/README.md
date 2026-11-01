# FlagPilot standalone consumer acceptance app

This is a separate React/Vite customer-app fixture. It exercises the shipped JavaScript SDK independently of the FlagPilot dashboard, so test exposures/conversions do not originate from dashboard preview components.

## Local proxy

The Vite server exposes `/flagpilot-api` and forwards requests to `http://localhost:8000`. The proxy removes the browser `Origin` header on its local server-to-server request. This is for local testing only; production consumer apps must call the deployed HTTPS API and the backend must explicitly allow deployed origins.

## Setup on Windows PowerShell

1. Start the FlagPilot backend on port 8000.
2. From this folder:

   ```powershell
   Copy-Item .env.example .env
   npm ci
   npm run build
   npm run dev
   ```

3. Open `http://localhost:5180`.
4. Configure the local `.env` values with the project's Development and Production client keys. Never commit `.env` or share a screenshot containing a key.

## Manual flow

- Select Development and evaluate a flag that exists in the selected project/environment.
- Change the test user ID and JSON attributes; apply the context and refresh evaluation.
- Check explicit targeting, attribute rules, 0/25/50/100 rollout, and kill switch behavior.
- Record a conversion only after the simulated business action succeeds, then inspect the FlagPilot project's Event Logs and Analytics.
- Switch to Production only after a Production flag has been approved and the Production key is configured. Verify that Dev and Prod configurations do not cross over.

The app never processes real payments. Its conversion button only sends a test analytics event.
