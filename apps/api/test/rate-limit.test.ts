import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitFromEnv, SlidingWindowLimiter } from "../src/rate-limit.js";

test("sliding window blocks and reports Retry-After", () => {
  let now = 1_000_000;
  const limiter = new SlidingWindowLimiter(() => now);
  const rule = { limit: 2, windowMs: 10_000 };
  assert.equal(limiter.take("auth", rule).allowed, true);
  assert.equal(limiter.take("auth", rule).allowed, true);
  const blocked = limiter.take("auth", rule);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 10);
  now += 10_001;
  assert.equal(limiter.take("auth", rule).allowed, true);
});

test("rate limit env overrides are bounded", () => {
  const limits = rateLimitFromEnv({ RATE_LIMIT_SIGNIN_IP: "4", RATE_LIMIT_SIGNIN_IP_WINDOW_MS: "15000" });
  assert.equal(limits.enabled, true);
  assert.equal(limits.signInIp.limit, 4);
  assert.equal(limits.signInIp.windowMs, 15_000);
  assert.equal(limits.signupIp.limit, 5);
  assert.equal(rateLimitFromEnv({ RATE_LIMIT_ENABLED: "0" }).enabled, false);
  assert.throws(() => rateLimitFromEnv({ RATE_LIMIT_SIGNIN_IP: "0" }), /RATE_LIMIT_SIGNIN_IP/);
  assert.throws(() => rateLimitFromEnv({ RATE_LIMIT_TICKET_IP_WINDOW_MS: "10" }), /WINDOW_MS/);
});
