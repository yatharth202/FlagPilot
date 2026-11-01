# FlagPilot JavaScript SDK 0.2.0

This package evaluates feature flags and records exposure/conversion events against the FlagPilot API. It uses a bounded in-memory LRU cache (5-second default TTL), short timeouts, and bounded retries for transient network and server failures. It does not automatically emit analytics events; call `trackEvent` only when a feature is actually shown or a conversion action succeeds.

## Local installation

From the repository root, in a consuming app:

```bash
npm install ../sdk
```

Or pack the SDK with `cd sdk && npm pack` and install the generated tarball.

## Usage

```js
import { FlagPilotClient } from "@flagpilot/client";

const flags = new FlagPilotClient({
  apiBaseUrl: "http://localhost:8000", // deployed APIs must use HTTPS
  clientKey: "fp_dev_REPLACE_WITH_YOUR_DEVELOPMENT_CLIENT_KEY",
  environment: "dev",
  user: {
    id: "customer-123", // stable pseudonymous ID; never send email/phone/access tokens
    attributes: { plan: "pro", country: "IN" },
  },
  onError: (error, context) => {
    console.error("FlagPilot SDK error", context, error);
  },
});

const decision = await flags.evaluate("new_checkout");
if (decision.reason !== "SDK_ERROR" && decision.reason !== "FLAG_NOT_FOUND") {
  // Render either the selected experience or the control/default experience.
  await flags.trackEvent({ flagKey: "new_checkout", event: "exposure", variant: decision.variant });
}
```

### Switching environments

Development and Production client keys are different. A client must never change the `environment` field while continuing to send the other environment's key. To switch one SDK instance between environments, configure both keys:

```js
const flags = new FlagPilotClient({
  apiBaseUrl: "https://api.example.com",
  clientKeys: {
    dev: "fp_dev_YOUR_DEVELOPMENT_KEY",
    prod: "fp_prod_YOUR_PRODUCTION_KEY",
  },
  environment: "dev",
  user: { id: "customer-123" },
});

flags.setEnvironment("prod"); // switches both environment and client key
```

A client created with only one `clientKey` cannot switch to the other environment. `setClientKey(key, environment)` supports key rotation without constructing a new client.

### Evaluation and targeting precedence

1. A disabled flag always returns its configured `defaultValue`.
2. Exact user targeting is evaluated first.
3. Explicit role targeting is evaluated second.
4. If rules are configured, every `equals` rule must match (AND semantics). A non-match returns the control/default experience and does not fall through to percentage rollout.
5. Eligible users are assigned deterministically using the existing user-ID + flag-key bucket algorithm. The algorithm is intentionally backward-compatible and does not change when a user moves between Development and Production.

User attributes are untrusted client input. They may control display/experiment targeting but must never be used as an authorization boundary. Attribute objects are limited to 16 KB, 8 nested levels and 500 values; unsafe property names and non-finite numbers are rejected. Analytics metadata is limited to 4 KB and uses the same safe-JSON checks.

### Reliability options

| Option | Default | Limit |
|---|---:|---:|
| `cacheTtlMs` | 5,000 ms | 0–60,000 ms |
| `cacheMaxEntries` | 500 | 1–10,000 |
| `timeoutMs` | 2,000 ms | 0–30,000 ms (0 disables timeout) |
| `maxRetries` | 1 | 0–3 retries |
| `retryDelayMs` | 100 ms | 0–2,000 ms |

The SDK retries network errors and transient HTTP statuses (408, 425, 429, 500, 502, 503, 504). Permanent 4xx errors are not retried. `trackEvent` creates one event ID before retrying and reuses it for every attempt, relying on the backend's idempotency contract. For business conversions, pass your own stable `eventId` (for example, an order/payment ID) and reuse it when retrying the same conversion later.

Evaluation failures return an `SDK_ERROR` control decision and notify `onError`. A throwing `onError` callback is isolated and cannot break fail-safe evaluation. `getBooleanValue` and `getValue` return the caller-provided fallback on `SDK_ERROR`.

## Analytics events

`trackEvent` generates an `eventId` when one is not supplied. For reliable conversion retry behavior, generate and persist one ID for a logical conversion, then reuse that same ID on every retry; use a new ID for a genuinely new conversion. Exposures are deduplicated per project/flag/environment/stable user, while distinct conversion IDs are counted as distinct conversions. A stable user ID is required for analytics and percentage rollouts. Record exposure for the experience actually shown, including the default/control experience; tracking only enabled users biases the conversion denominator.

The API accepts a conversion only after a matching exposure exists and attributes it to the stored exposure variant; client-provided conversion variant labels are not trusted. An identical retry with the same `eventId` is acknowledged without creating another row. Reusing an `eventId` for different event data returns HTTP 409. Shared pseudo-identities such as `anonymous` and `anon` are rejected because they merge unrelated users and corrupt unique-user metrics.

## Client key security

`clientKey` is a public project/environment-scoped key used only for flag evaluation and event ingestion. It is intentionally okay to include in browser apps, but it is not an authorization credential for management APIs. Treat user attributes sent from a browser (including role/plan claims) as untrusted input: feature flags are not an authorization boundary, and your own API must independently enforce access permissions. Management operations require a user JWT and are scoped to that user's project. Rotate a key from the SDK & API settings if it is abused; the old key is revoked immediately. Never place a JWT, database credential, or other server secret in browser code.

## Release limits

The SDK is not a substitute for an application-side fallback policy, and browser-submitted analytics are not tamper-proof financial or compliance evidence. Before a production launch, verify the package against the deployed API, test Redis/MongoDB outages, run a separate consumer-app integration test, and exercise real browser/network conditions.
