import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientIp } from "../src/client-ip.js";

const proxy = "192.0.2.10";
const client = "198.51.100.20";
const spoofed = "203.0.113.9";

test("ignores forwarded headers unless the peer is a trusted proxy", () => {
  const ignored = resolveClientIp({
    peer: proxy,
    forwardedFor: `${spoofed}, ${client}`,
    realIp: client,
    trusted: [],
  });
  assert.equal(ignored, proxy);

  const trusted = resolveClientIp({
    peer: proxy,
    forwardedFor: `${spoofed}, ${client}`,
    realIp: spoofed,
    trusted: [proxy],
  });
  assert.equal(trusted, client);
});

test("walks a trusted proxy chain and falls back to X-Real-IP", () => {
  const chain = resolveClientIp({
    peer: proxy,
    forwardedFor: `${client}, ${proxy}`,
    realIp: null,
    trusted: ["192.0.2.0/24"],
  });
  assert.equal(chain, client);

  const real = resolveClientIp({
    peer: "192.0.2.11",
    forwardedFor: null,
    realIp: client,
    trusted: ["192.0.2.0/24"],
  });
  assert.equal(real, client);
});

test("drops invalid header values and mapped ipv4 peers", () => {
  assert.equal(
    resolveClientIp({
      peer: "::ffff:192.0.2.10",
      forwardedFor: "not-an-address, 198.51.100.21",
      realIp: null,
      trusted: ["192.0.2.10"],
    }),
    "198.51.100.21",
  );
  assert.equal(resolveClientIp({ peer: null, forwardedFor: client, realIp: client, trusted: [proxy] }), "unknown");
});
