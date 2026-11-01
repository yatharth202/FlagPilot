import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontendOrigins, validateRefreshCookieSameSite, validateMetricsToken } from "../src/utils/deploymentPolicy.js";

test("development frontend origin defaults to localhost but production requires an explicit HTTPS origin", () => {
  assert.deepEqual(parseFrontendOrigins(undefined, { production: false }), ["http://localhost:5173"]);
  assert.deepEqual(parseFrontendOrigins("https://app.example.com", { production: true }), ["https://app.example.com"]);
  assert.throws(() => parseFrontendOrigins(undefined, { production: true }), /explicit browser origins/);
});

test("production CORS rejects wildcard, HTTP, localhost, path, and malformed origins", () => {
  for (const origin of ["*", "http://app.example.com", "https://localhost", "https://app.example.com/path", "not an origin"]) {
    assert.throws(() => parseFrontendOrigins(origin, { production: true }));
  }
});

test("frontend origin list rejects duplicates and accepts multiple exact HTTPS origins", () => {
  assert.deepEqual(
    parseFrontendOrigins("https://app.example.com,https://admin.example.com", { production: true }),
    ["https://app.example.com", "https://admin.example.com"],
  );
  assert.throws(() => parseFrontendOrigins("https://app.example.com,https://app.example.com", { production: true }), /duplicate/);
});

test("refresh-cookie SameSite policy requires HTTPS for None", () => {
  assert.equal(validateRefreshCookieSameSite(undefined, { production: false }), "lax");
  assert.equal(validateRefreshCookieSameSite(undefined, { production: true }), "lax");
  assert.equal(validateRefreshCookieSameSite("strict", { production: false }), "strict");
  assert.throws(() => validateRefreshCookieSameSite("none", { production: false }), /requires HTTPS/);
  assert.throws(() => validateRefreshCookieSameSite("invalid", { production: true }), /must be lax/);
});

import { getRefreshCookieOptions, readRefreshCookieValue, REFRESH_COOKIE_NAME } from "../src/utils/authCookiePolicy.js";

test("refresh token cookie is HttpOnly, path-scoped, and Secure in production", () => {
  const development = getRefreshCookieOptions({ NODE_ENV: "development" });
  const production = getRefreshCookieOptions({ NODE_ENV: "production" });
  assert.equal(development.httpOnly, true);
  assert.equal(development.secure, false);
  assert.equal(development.sameSite, "lax");
  assert.equal(production.httpOnly, true);
  assert.equal(production.secure, true);
  assert.equal(production.sameSite, "lax");
  assert.equal(production.path, "/api/v1/auth");
});

test("refresh cookie parser reads only the named bounded cookie value", () => {
  assert.equal(readRefreshCookieValue(`other=x; ${REFRESH_COOKIE_NAME}=abc.def.xyz; another=y`), "abc.def.xyz");
  assert.equal(readRefreshCookieValue("other=x"), null);
  assert.equal(readRefreshCookieValue(`${REFRESH_COOKIE_NAME}=${"x".repeat(4097)}`), null);
  assert.equal(readRefreshCookieValue(`${REFRESH_COOKIE_NAME}=first; ${REFRESH_COOKIE_NAME}=second`), null);
});

test("metrics endpoint remains disabled unless a strong bounded token is configured", () => {
  assert.equal(validateMetricsToken(undefined), false);
  assert.equal(validateMetricsToken("x".repeat(32)), true);
  assert.throws(() => validateMetricsToken("short"), /32 and 512/);
  assert.throws(() => validateMetricsToken("x".repeat(513)), /32 and 512/);
  assert.throws(() => validateMetricsToken("x".repeat(31) + " secret"), /32 and 512/);
  assert.throws(() => validateMetricsToken("replace-with-a-real-secret-value-123456"), /32 and 512/);
});
