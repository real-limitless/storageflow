import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const policy = fs.readFileSync(path.resolve(import.meta.dirname, "../../../SECURITY.md"), "utf8");

test("security policy names a private report path and the kill switch", () => {
  assert.match(policy, /privately to the owner/);
  assert.match(policy, /Owner: Chen/);
  assert.match(policy, /First responder: DevOps/);
  assert.match(policy, /POST \/admin\/users\/:id\/disable/);
  assert.match(policy, /APP_ENCRYPTION_KEY/);
  assert.match(policy, /docker compose stop/);
  assert.match(policy, /docker compose down -v/);
  assert.doesNotMatch(policy, /z\.srl/i);
  assert.doesNotMatch(policy, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
});
