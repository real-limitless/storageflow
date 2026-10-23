import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatLog, redact, type LogEvent } from "../src/log.js";

const secret = "do-not-keep-this-password";
const fullKey = `sfk_${"a".repeat(40)}`;

test("redacts secrets, tokens, cookies, and authorization material", () => {
  const cleaned = redact({
    password: secret,
    authorization: `Bearer ${fullKey}`,
    cookie: "sf_session=abc",
    note: "cabinet renamed",
    detail: "Bearer abcdef",
    trace: "cookie=session-value",
    nested: { token: "raw-token", name: "Ada" },
    message: `password=${secret} ${fullKey}`,
  }) as Record<string, unknown>;

  const text = JSON.stringify(cleaned);
  assert.equal(cleaned.password, "[redacted]");
  assert.equal(cleaned.authorization, "[redacted]");
  assert.equal(cleaned.cookie, "[redacted]");
  assert.equal(cleaned.note, "cabinet renamed");
  assert.equal((cleaned.nested as { token: string; name: string }).token, "[redacted]");
  assert.equal((cleaned.nested as { name: string }).name, "Ada");
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(fullKey), false);
  assert.equal(cleaned.detail, "Bearer [redacted]");
  assert.equal(cleaned.trace, "cookie=[redacted]");
  assert.match(String(cleaned.message), /password=\[redacted\]/);
  assert.match(String(cleaned.message), /sfk_aaaaaaa/);
  assert.equal(String(cleaned.message).includes(fullKey), false);
});

test("log lines keep the standard fields and a key prefix", () => {
  const event: LogEvent = {
    timestamp: "2026-01-01T00:00:00.000Z",
    service: "storageflow-api",
    environment: "test",
    request_id: "req-1",
    actor: "key:sfk_abcd1234",
    source_ip: "198.51.100.20",
    action: "auth.api_key",
    outcome: "failure",
    category: "auth",
    message: `token=${secret}`,
  };
  const line = formatLog(event);
  const parsed = JSON.parse(line) as LogEvent;
  assert.equal(parsed.timestamp, event.timestamp);
  assert.equal(parsed.service, "storageflow-api");
  assert.equal(parsed.environment, "test");
  assert.equal(parsed.request_id, "req-1");
  assert.equal(parsed.actor, "key:sfk_abcd1234");
  assert.equal(parsed.source_ip, "198.51.100.20");
  assert.equal(parsed.action, "auth.api_key");
  assert.equal(parsed.outcome, "failure");
  assert.equal(parsed.category, "auth");
  assert.equal(line.includes(secret), false);
  assert.match(parsed.timestamp, /Z$/);
});

test("API source does not write with console", () => {
  const root = path.resolve(import.meta.dirname, "../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(root);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /console\.(log|error|warn|info|debug)/, file);
  }
});
