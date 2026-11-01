# FlagPilot acceptance-test app — verification note

This separate React/Vite app is a QA fixture for validating the JavaScript SDK as an independent consumer. It is not embedded in or served by the FlagPilot dashboard.

## Included behavior

- Installs the same local SDK 0.2.0 tarball shipped in `sdk/`.
- Uses a Vite development proxy (`/flagpilot-api`) to forward local requests to the backend without relying on browser CORS. This proxy is for local acceptance testing only.
- Supports separate Development and Production keys, environment switching, stable test user IDs, JSON attributes, evaluation refresh, event tracking, and diagnostics.

## Current checks

- SDK unit tests: 18/18 pass from `sdk/`.
- Frontend build/lint for this app: not verified in this review because npm dependency installation timed out.
- Live API evaluation/event tracking: previously exercised by the user against their local backend; this archive alone cannot reproduce their MongoDB state or client-key configuration.

Do not include `.env` in source control or in a shared ZIP. Use `.env.example` and your own local keys. The Vite proxy must not be used as a production deployment architecture; deployed consumer apps should call the HTTPS API directly and the API must allow explicit deployed frontend origins.
