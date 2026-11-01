import test from "node:test";
import assert from "node:assert/strict";
import { requireTrustedOrigin } from "../src/middlewares/trustedOrigin.middleware.js";

const withEnv = async (entries, run) => {
  const previous = Object.fromEntries(Object.keys(entries).map((key) => [key, process.env[key]]));
  Object.assign(process.env, entries);
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("trusted-origin middleware accepts configured browser origins and originless native clients", async () => {
  await withEnv({ NODE_ENV: "development", FRONTEND_ORIGIN: "http://localhost:5173" }, async () => {
    for (const origin of ["http://localhost:5173", undefined]) {
      let nextCalled = false;
      let error;
      requireTrustedOrigin({ get: (name) => name === "origin" ? origin : undefined }, {}, (value) => {
        error = value;
        if (!value) nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.equal(error, undefined);
    }
  });
});

test("trusted-origin middleware rejects hostile and opaque browser origins", async () => {
  await withEnv({ NODE_ENV: "development", FRONTEND_ORIGIN: "http://localhost:5173" }, async () => {
    for (const origin of ["https://attacker.example", "null"]) {
      let nextError;
      requireTrustedOrigin({ get: () => origin }, {}, (error) => { nextError = error; });
      assert.equal(nextError?.statusCode, 403);
    }
  });
});
