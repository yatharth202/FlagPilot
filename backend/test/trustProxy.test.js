import test from "node:test";
import assert from "node:assert/strict";
import { parseTrustProxy } from "../src/utils/trustProxy.js";

test("proxy trust defaults to disabled and accepts an explicit hop count", () => {
  assert.equal(parseTrustProxy(undefined, { production: true }), false);
  assert.equal(parseTrustProxy("0", { production: true }), false);
  assert.equal(parseTrustProxy("1", { production: true }), 1);
  assert.equal(parseTrustProxy("3"), 3);
});

test("production rejects blanket trust of all forwarded proxy headers", () => {
  assert.throws(() => parseTrustProxy("true", { production: true }), /unsafe in production/);
  assert.equal(parseTrustProxy("true", { production: false }), true);
});

test("proxy trust accepts explicit IP ranges and named private groups", () => {
  assert.deepEqual(parseTrustProxy("10.0.0.0/8,192.168.1.5,loopback", { production: true }), ["10.0.0.0/8", "192.168.1.5", "loopback"]);
  assert.deepEqual(parseTrustProxy("2001:db8::/32", { production: true }), ["2001:db8::/32"]);
});

test("proxy trust rejects invalid ranges, hostnames, and excessive hop counts", () => {
  for (const value of ["11", "foo.example", "10.0.0.0/99", "192.168.1.1/abc", "loopback,,uniquelocal"]) {
    assert.throws(() => parseTrustProxy(value, { production: true }));
  }
});
