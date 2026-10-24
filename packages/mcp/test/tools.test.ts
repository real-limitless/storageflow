import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../../apps/api/src/app.js";
import { createResolver } from "../../../apps/api/src/adapters.js";
import type { AppConfig } from "../../../apps/api/src/config.js";
import type { RateLimitConfig } from "../../../apps/api/src/rate-limit.js";
import { openDatabase } from "../../../apps/api/src/db.js";
import { createExtractiveAnswerer, createHashEmbedder } from "../../../apps/api/src/embed.js";
import { JobQueue } from "../../../apps/api/src/jobs.js";
import { migrate } from "../../../apps/api/src/migrate.js";
import type { Deps } from "../../../apps/api/src/services/access.js";
import { createRestClient, type RestClient } from "../src/client.js";
import { callTool } from "../src/tools.js";

const key = Buffer.from("ab".repeat(32), "hex");

function openLimits(): RateLimitConfig {
  const rule = { limit: 10_000, windowMs: 60_000 };
  return {
    enabled: true,
    signupIp: rule,
    signupAccount: rule,
    signInIp: rule,
    signInAccount: rule,
    magicIp: rule,
    magicAccount: rule,
    magicConsumeIp: rule,
    magicConsumeAccount: rule,
    mfaIp: rule,
    mfaAccount: rule,
    ticketIp: rule,
    ticketAccount: rule,
    abuseIp: rule,
    abuseAccount: rule,
    portalIp: rule,
    portalAccount: rule,
  };
}

function config(): AppConfig {
  return {
    encryptionKey: key,
    databaseUrl: "pglite:",
    hosted: {
      endpoint: "memory://hosted",
      region: "us-east-1",
      bucket: "acme-plain",
      accessKeyId: "acme-access",
      secretAccessKey: "acme-secret",
      forcePathStyle: true,
      configured: true,
    },
    hostedQuotaBytes: 5 * 1024 * 1024 * 1024,
    publicOrigin: "http://127.0.0.1:5173",
    secureCookie: false,
    scryptN: 4096,
    exposeMagicLink: true,
    allowPlanFlag: true,
    adminEmails: [],
    uploadTransport: "proxy",
    adapterMode: "memory",
    seedEmail: "",
    seedPassword: "",
    seedName: "Ada",
    tenantSlug: "acme",
    tenantName: "Acme",
    embeddingUrl: "",
    embeddingApiKey: "",
    embeddingModel: "",
    answerUrl: "",
    answerApiKey: "",
    answerModel: "",
    rateLimit: openLimits(),
    trustedProxies: [],
    environment: "test",
  };
}

function clientFor(app: ReturnType<typeof createApp>, auth: { session?: string; apiKey?: string }): RestClient {
  return createRestClient({
    baseUrl: "http://mcp.local",
    session: auth.session,
    apiKey: auth.apiKey,
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url);
      return app.request(`${parsed.pathname}${parsed.search}`, init);
    },
  });
}

async function boot() {
  const db = await openDatabase("pglite:");
  await migrate(db);
  const deps: Deps = {
    db,
    adapters: createResolver("memory"),
    config: config(),
    jobs: new JobQueue(),
    embedder: createHashEmbedder(),
    answerer: createExtractiveAnswerer(),
    now: () => new Date("2026-10-14T12:00:00Z"),
  };
  const app = createApp(deps);
  return { db, app };
}

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await app.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Ada", password: "correct-horse" }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith("sf_session="));
  assert.ok(cookie);
  return cookie.slice("sf_session=".length).split(";")[0] ?? "";
}

test("tool auth accepts a user session and rejects a missing credential", async () => {
  const { db, app } = await boot();
  const anonymous = clientFor(app, {});
  const missing = await callTool(anonymous, "get_team", {});
  assert.equal(missing.isError, true);
  assert.equal(missing.status, 401);
  assert.match(missing.text, /Sign in/);

  const badKey = await callTool(clientFor(app, { apiKey: "sfk_not-a-real-key" }), "list_cabinets", {});
  assert.equal(badKey.status, 401);
  assert.match(badKey.text, /not valid/);

  const session = await signUp(app, "ada@acme.test");
  const authed = clientFor(app, { session });
  const before = await callTool(authed, "get_team", {});
  assert.equal(before.isError, false);
  assert.equal(before.status, 200);
  const signedIn = before.body as { activeTenant: unknown; user: { email: string } };
  assert.equal(signedIn.user.email, "ada@acme.test");
  assert.equal(signedIn.activeTenant, null);

  const created = await callTool(authed, "create_team", { name: "Acme" });
  assert.equal(created.isError, false, created.text);
  const team = created.body as { activeTenant: { role: string; name: string }; memberships: { role: string }[] };
  assert.equal(team.activeTenant.role, "owner");
  assert.equal(team.activeTenant.name, "Acme");
  assert.equal(team.memberships[0]?.role, "owner");
  await db.close();
});

test("a list-only service-account key is denied file delete", async () => {
  const { db, app } = await boot();
  const session = await signUp(app, "ada@acme.test");
  const owner = clientFor(app, { session });
  const team = await callTool(owner, "create_team", { name: "Acme", slug: "acme" });
  assert.equal(team.isError, false, team.text);
  const cabinet = await callTool(owner, "create_cabinet", { name: "Work", kind: "work" });
  assert.equal(cabinet.isError, false, cabinet.text);
  const cabinetId = (cabinet.body as { id: string }).id;
  const drawer = await callTool(owner, "create_drawer", { cabinetId, name: "Client files", mode: "hosted" });
  assert.equal(drawer.isError, false, drawer.text);
  const drawerBody = drawer.body as { id: string; rootFolderId: string };
  const file = await callTool(owner, "create_file", {
    drawerId: drawerBody.id,
    folderId: drawerBody.rootFolderId,
    name: "notes.txt",
    text: "hello",
  });
  assert.equal(file.isError, false, file.text);
  const fileId = (file.body as { id: string }).id;
  const read = await callTool(owner, "read_file", { id: fileId });
  assert.equal(read.isError, false, read.text);
  assert.equal(read.body, "hello");

  const service = await app.request("/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `sf_session=${session}` },
    body: JSON.stringify({ email: "ci@acme.test", name: "CI", kind: "service", role: "owner" }),
  });
  assert.equal(service.status, 201, await service.clone().text());
  const serviceId = ((await service.json()) as { id: string }).id;
  const issued = await app.request(`/admin/users/${serviceId}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `sf_session=${session}` },
    body: JSON.stringify({ name: "reader", scopes: ["list"] }),
  });
  assert.equal(issued.status, 201, await issued.clone().text());
  const token = ((await issued.json()) as { token: string }).token;
  const keyClient = clientFor(app, { apiKey: token });

  const listed = await callTool(keyClient, "list_folder", { drawerId: drawerBody.id, folderId: drawerBody.rootFolderId });
  assert.equal(listed.isError, false, listed.text);
  const names = (listed.body as { files: { name: string }[] }).files.map((item) => item.name);
  assert.equal(names.includes("notes.txt"), true);

  const denied = await callTool(keyClient, "delete_file", { id: fileId });
  assert.equal(denied.isError, true);
  assert.equal(denied.status, 403);
  assert.match(denied.text, /does not allow/);

  const still = await callTool(owner, "read_file", { id: fileId });
  assert.equal(still.body, "hello");
  await db.close();
});
