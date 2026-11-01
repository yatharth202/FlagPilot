import test from "node:test";
import assert from "node:assert/strict";
import { FlagPilotClient } from "../src/index.js";

const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test("normalizes the API URL and evaluates a flag", async () => {
  let request;
  const client = new FlagPilotClient({ apiBaseUrl: "http://localhost:8000", clientKey: "fp_dev_test", environment: "dev", user: { id: "u1" }, fetchImpl: async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: { enabled: true, value: true, variant: "A", reason: "ROLLOUT_MATCH" } });
  } });
  const result = await client.evaluate("new_checkout");
  assert.equal(request.url, "http://localhost:8000/api/v1/feature-flags/evaluate");
  assert.equal(JSON.parse(request.options.body).environment, "dev");
  assert.equal(JSON.parse(request.options.body).userId, "u1");
  assert.equal(request.options.headers["x-flagpilot-client-key"], "fp_dev_test");
  assert.equal(result.enabled, true);
});

test("caches evaluations but changes user-specific cache key", async () => {
  let calls = 0;
  const client = new FlagPilotClient({ clientKey: "fp_prod_test", user: { id: "one" }, fetchImpl: async () => {
    calls += 1;
    return jsonResponse({ data: { enabled: true, value: true, variant: "A", reason: "ROLLOUT_MATCH" } });
  } });
  await client.evaluate("new_checkout");
  await client.evaluate("new_checkout");
  assert.equal(calls, 1);
  client.setUser({ id: "two" });
  await client.evaluate("new_checkout");
  assert.equal(calls, 2);
});

test("fails closed on evaluation error and reports through onError", async () => {
  let reported = false;
  const client = new FlagPilotClient({ clientKey: "fp_prod_test", fetchImpl: async () => jsonResponse({ message: "down" }, 503), onError: () => { reported = true; } });
  const result = await client.evaluate("new_checkout");
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "SDK_ERROR");
  assert.equal(reported, true);
});

test("validates environment", () => {
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_test", environment: "stage" }), /environment must be/);
});

test("requires a project-scoped client key", () => {
  assert.throws(() => new FlagPilotClient(), /clientKey is required/);
});

test("sends the project-scoped client key when tracking events", async () => {
  let request;
  const client = new FlagPilotClient({ clientKey: "fp_dev_tracking", environment: "dev", user: { id: "u-event" }, fetchImpl: async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: { _id: "event-1" } }, 201);
  } });
  await client.trackEvent({ flagKey: "new_checkout", event: "exposure", variant: "rollout" });
  assert.equal(request.url, "http://localhost:8000/api/v1/analytics/track");
  assert.equal(request.options.headers["x-flagpilot-client-key"], "fp_dev_tracking");
  assert.equal(JSON.parse(request.options.body).environment, "dev");
});


test("tracking uses a stable user ID and preserves a caller event ID for retries", async () => {
  let body;
  const client = new FlagPilotClient({ clientKey: "fp_dev_tracking", environment: "dev", user: { id: "stable-user" }, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return jsonResponse({ data: { _id: "event-1" } }, 201); } });
  await client.trackEvent({ flagKey: "new_checkout", event: "conversion", eventId: "checkout-success-0001" });
  assert.equal(body.userId, "stable-user");
  assert.equal(body.eventId, "checkout-success-0001");
});

test("tracking refuses to merge users into a shared anonymous identity", async () => {
  const client = new FlagPilotClient({ clientKey: "fp_dev_tracking", environment: "dev", fetchImpl: async () => jsonResponse({ data: {} }, 201) });
  await assert.rejects(() => client.trackEvent({ flagKey: "new_checkout" }), /stable userId is required/);
  const anonymousClient = new FlagPilotClient({ clientKey: "fp_dev_tracking", environment: "dev", user: { id: "anonymous" }, fetchImpl: async () => jsonResponse({ data: {} }, 201) });
  await assert.rejects(() => anonymousClient.trackEvent({ flagKey: "new_checkout" }), /distinct stable userId/);
});

test("switching environments requires the matching project client key", () => {
  const client = new FlagPilotClient({ clientKey: "fp_dev_key", environment: "dev", fetchImpl: async () => jsonResponse({ data: { enabled: false, value: false } }) });
  assert.throws(() => client.setEnvironment("prod"), /No prod client key/);

  const multiEnvironmentClient = new FlagPilotClient({
    clientKeys: { dev: "fp_dev_key", prod: "fp_prod_key" },
    environment: "dev",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["x-flagpilot-client-key"], "fp_prod_key");
      assert.equal(JSON.parse(options.body).environment, "prod");
      return jsonResponse({ data: { enabled: false, value: false } });
    },
  });
  multiEnvironmentClient.setEnvironment("prod");
  return multiEnvironmentClient.evaluate("new_checkout");
});

test("SDK retries transient evaluation failures but does not retry permanent client errors", async () => {
  let calls = 0;
  const client = new FlagPilotClient({ clientKey: "fp_prod_key", retryDelayMs: 0, fetchImpl: async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ message: "temporarily unavailable" }, 503)
      : jsonResponse({ data: { enabled: true, value: true, reason: "ROLLOUT_MATCH" } });
  } });
  assert.equal((await client.evaluate("new_checkout")).enabled, true);
  assert.equal(calls, 2);

  let badRequestCalls = 0;
  const badRequestClient = new FlagPilotClient({ clientKey: "fp_prod_key", retryDelayMs: 0, fetchImpl: async () => {
    badRequestCalls += 1;
    return jsonResponse({ message: "bad request" }, 400);
  } });
  assert.equal((await badRequestClient.evaluate("new_checkout")).reason, "SDK_ERROR");
  assert.equal(badRequestCalls, 1);
});

test("analytics retry reuses the same idempotency event ID", async () => {
  const requestBodies = [];
  let calls = 0;
  const client = new FlagPilotClient({
    clientKey: "fp_prod_key",
    environment: "prod",
    user: { id: "user-123" },
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      calls += 1;
      return calls === 1
        ? jsonResponse({ message: "retry" }, 503)
        : jsonResponse({ data: { accepted: true } }, 201);
    },
  });
  await client.trackEvent({ flagKey: "checkout", event: "conversion" });
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].eventId, requestBodies[1].eventId);
  assert.equal(requestBodies[0].userId, "user-123");
});

test("SDK error observer exceptions cannot break fail-closed evaluation", async () => {
  const client = new FlagPilotClient({
    clientKey: "fp_prod_key",
    fetchImpl: async () => { throw new Error("network down"); },
    onError: () => { throw new Error("observer bug"); },
    maxRetries: 0,
  });
  const result = await client.evaluate("checkout");
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "SDK_ERROR");
});

test("evaluation cache is bounded and environment/client-key scoped", async () => {
  let calls = 0;
  const client = new FlagPilotClient({
    clientKeys: { dev: "fp_dev_key", prod: "fp_prod_key" },
    environment: "dev",
    cacheMaxEntries: 2,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ data: { enabled: true, value: true, reason: "ROLLOUT_MATCH" } });
    },
  });
  await client.evaluate("flag-one");
  await client.evaluate("flag-two");
  await client.evaluate("flag-three");
  assert.equal(client.cache.size, 2);
  await client.evaluate("flag-one");
  assert.equal(calls, 4);
  client.setEnvironment("prod");
  assert.equal(client.cache.size, 0);
});

test("SDK validates retry, timeout, URL and JSON attribute configuration", () => {
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_key", maxRetries: 4 }), /maxRetries/);
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_key", timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_key", apiBaseUrl: "http://api.example.com" }), /HTTPS/);
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_key", user: { attributes: { bad: Number.POSITIVE_INFINITY } } }), /non-finite/);
});

test("per-flag cache invalidation removes only the selected environment and flag", async () => {
  let calls = 0;
  const client = new FlagPilotClient({
    clientKeys: { dev: "fp_dev_key", prod: "fp_prod_key" },
    environment: "dev",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ data: { enabled: true, value: true, reason: "ROLLOUT_MATCH" } });
    },
  });
  await client.evaluate("one");
  await client.evaluate("two");
  client.invalidate("one");
  await client.evaluate("one");
  await client.evaluate("two");
  assert.equal(calls, 3);
});

test("timeout aborts evaluation and returns the SDK fallback", async () => {
  const client = new FlagPilotClient({
    clientKey: "fp_dev_key",
    timeoutMs: 10,
    maxRetries: 0,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const decision = await client.evaluate("checkout");
  assert.equal(decision.enabled, false);
  assert.equal(decision.reason, "SDK_ERROR");
});

test("empty event IDs and unsupported variants are rejected instead of silently changing event identity", async () => {
  const client = new FlagPilotClient({ clientKey: "fp_dev_key", user: { id: "u-123" }, fetchImpl: async () => jsonResponse({ data: {} }, 201) });
  await assert.rejects(() => client.trackEvent({ flagKey: "checkout", event: "conversion", eventId: "" }), /eventId/);
  await assert.rejects(() => client.trackEvent({ flagKey: "checkout", variant: "unknown" }), /variant must be/);
});

test("SDK rejects conflicting client-key configuration and malformed user attributes", () => {
  assert.throws(() => new FlagPilotClient({
    environment: "dev",
    clientKey: "fp_dev_one",
    clientKeys: { dev: "fp_dev_two" },
  }), /conflicts/);
  assert.throws(() => new FlagPilotClient({ clientKey: "fp_dev_key", user: { attributes: null } }), /user.attributes must be a plain object/);
});
