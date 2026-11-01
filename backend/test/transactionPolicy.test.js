import test from "node:test";
import assert from "node:assert/strict";
import { getTransactionMode } from "../src/utils/transactionPolicy.js";

test("replica-set and sharded topologies always use transactions", () => {
  assert.equal(getTransactionMode({ topologyType: "ReplicaSetWithPrimary", nodeEnv: "development" }), "transaction");
  assert.equal(getTransactionMode({ topologyType: "Sharded", nodeEnv: "production" }), "transaction");
});

test("standalone MongoDB is rejected by default in every environment", () => {
  assert.equal(getTransactionMode({ topologyType: "Single", nodeEnv: "development", allowNonTransactionalDev: false }), "unavailable");
  assert.equal(getTransactionMode({ topologyType: "Single", nodeEnv: "production", allowNonTransactionalDev: true }), "unavailable");
});

test("non-atomic standalone fallback requires explicit development-only opt-in", () => {
  assert.equal(getTransactionMode({ topologyType: "Single", nodeEnv: "development", allowNonTransactionalDev: true }), "non_atomic_development");
  assert.equal(getTransactionMode({ topologyType: "Single", nodeEnv: "test", allowNonTransactionalDev: true }), "unavailable");
});
