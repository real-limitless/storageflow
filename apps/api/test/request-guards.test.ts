import assert from "node:assert/strict";
import test from "node:test";
import { createResolver } from "../src/adapters.js";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db.js";
import { createExtractiveAnswerer, createHashEmbedder } from "../src/embed.js";
import { JobQueue } from "../src/jobs.js";
import type { RateLimitConfig, RateRule } from "../src/rate-limit.js";
import type { Deps } from "../src/services/access.js";

const proxy = "192.0.2.10";
const client = "198.51.100.20";
const other = "198.51.100.21";

function rule(limit: number): RateRule {
  return { limit, windowMs: 60_000 };
}

function limits(partial: Partial<RateLimitConfig>): RateLimitConfig {
  const open = rule(100);
  return {
    enabled: true,
    signupIp: open,
    signupAccount: open,
    signInIp: open,
    signInAccount: open,
    magicIp: open,
    magicAccount: open,
    magicConsumeIp: open,
    magicConsumeAccount: open,
    mfaIp: open,
    mfaAccount: open,
    ticketIp: open,
    ticketAccount: open,
    abuseIp: open,
    abuseAccount: open,
    portalIp: open,
    portalAccount: open,
    ...partial,
  };
}

function config(partial: Partial<AppConfig> = {}): AppConfig {
  const loaded = loadConfig({
    APP_ENCRYPTION_KEY: "ab".repeat(32),
    STORAGEFLOW_ENV: "test",
    SECRETS_DIR: "/tmp/storageflow-no-secrets",
  });
  return {
    ...loaded,
    adapterMode: "memory",
    rateLimit: limits({}),
    trustedProxies: [],
    ...partial,
  };
}

function build(partial: Partial<AppConfig> = {}, peer: string | null = proxy) {
  const db: Db = {
    async query() {
      return [];
    },
    async exec() {},
    async transaction(fn) {
      return fn(db);
    },
    async close() {},
  };
  const deps: Deps = {
    db,
    adapters: createResolver("memory"),
    config: config(partial),
    jobs: new JobQueue(),
    embedder: createHashEmbedder(),
    answerer: createExtractiveAnswerer(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    peerAddress: () => peer,
  };
  return createApp(deps);
}

async function post(app: ReturnType<typeof createApp>, path: string, json: unknown, headers?: Record<string, string>) {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof json === "string" ? json : JSON.stringify(json),
  });
  const text = await response.text();
  return { status: response.status, text, retryAfter: response.headers.get("retry-after"), json: text ? JSON.parse(text) : null };
}

test("rejects mistyped bodies without echoing the submitted secret", async () => {
  const app = build();
  const password = "do-not-echo-this-password";
  const response = await post(app, "/sessions", { email: 1, password });
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, "invalid");
  assert.equal(response.json.error.message, "Invalid request");
  assert.deepEqual(response.json.error.fields, ["email"]);
  assert.equal(response.text.includes(password), false);

  const broken = await post(app, "/users", "not-json");
  assert.equal(broken.status, 400);
  assert.equal(broken.json.error.message, "Expected JSON");
  const arrayBody = await app.request("/sessions/magic", { method: "POST", body: "[]", headers: { "content-type": "application/json" } });
  const arrayText = await arrayBody.text();
  assert.equal(arrayBody.status, 400);
  assert.match(arrayText, /Expected an object/);
});

test("auth routes return 429 with Retry-After for ip and account limits", async () => {
  const app = build({ rateLimit: limits({ signInIp: rule(2), signInAccount: rule(1) }) });
  const first = await post(app, "/sessions", { email: "ada@example.com", password: "correct-horse" });
  assert.equal(first.status, 401);
  const second = await post(app, "/sessions", { email: "bea@example.com", password: "correct-horse" });
  assert.equal(second.status, 401);
  const third = await post(app, "/sessions", { email: "cara@example.com", password: "correct-horse" });
  assert.equal(third.status, 429);
  assert.ok(Number(third.retryAfter) >= 1);
  assert.equal(third.json.error.code, "rate_limited");

  const accounts = build({ rateLimit: limits({ signInIp: rule(10), signInAccount: rule(1) }) });
  assert.equal((await post(accounts, "/sessions", { email: "ada@example.com", password: "correct-horse" })).status, 401);
  const again = await post(accounts, "/sessions", { email: "ada@example.com", password: "correct-horse" });
  assert.equal(again.status, 429);
  const otherAccount = await post(accounts, "/sessions", { email: "bea@example.com", password: "correct-horse" });
  assert.equal(otherAccount.status, 401);
});

test("rate limits follow the forwarded client only from a trusted proxy", async () => {
  const trusted = build({ rateLimit: limits({ signInIp: rule(1) }), trustedProxies: [proxy] });
  const headers = { "x-forwarded-for": `203.0.113.9, ${client}`, "x-real-ip": client };
  assert.equal((await post(trusted, "/sessions", { email: "ada@example.com", password: "correct-horse" }, headers)).status, 401);
  const blocked = await post(trusted, "/sessions", { email: "bea@example.com", password: "correct-horse" }, headers);
  assert.equal(blocked.status, 429);
  const separate = await post(trusted, "/sessions", { email: "cara@example.com", password: "correct-horse" }, {
    "x-forwarded-for": other,
  });
  assert.equal(separate.status, 401);

  const untrusted = build({ rateLimit: limits({ signInIp: rule(1) }), trustedProxies: [] });
  assert.equal(
    (await post(untrusted, "/sessions", { email: "ada@example.com", password: "correct-horse" }, { "x-forwarded-for": client })).status,
    401,
  );
  const shared = await post(untrusted, "/sessions", { email: "bea@example.com", password: "correct-horse" }, { "x-forwarded-for": other });
  assert.equal(shared.status, 429);
});
