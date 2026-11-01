import test from "node:test";
import assert from "node:assert/strict";
import { isValidProjectMemberEmail, normalizeProjectMemberEmail } from "../src/utils/projectMemberPolicy.js";

test("project-member email normalization trims and lowercases", () => {
  assert.equal(normalizeProjectMemberEmail("  Alice@Example.com  "), "alice@example.com");
  assert.equal(normalizeProjectMemberEmail(null), "");
});

test("project-member email validation accepts normal email addresses", () => {
  assert.equal(isValidProjectMemberEmail("alice@example.com"), true);
  assert.equal(isValidProjectMemberEmail("dev+flagpilot@company.co.in"), true);
});

test("project-member email validation rejects malformed addresses", () => {
  for (const value of ["", "alice", "alice@", "@example.com", "alice@example", "alice\\xcom@example.com", "alice@example.com\\x"]) {
    assert.equal(isValidProjectMemberEmail(value), false, `expected ${value} to be rejected`);
  }
  assert.equal(isValidProjectMemberEmail(`a@${"x".repeat(245)}.com`), false);
});
