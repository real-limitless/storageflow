import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { buildTree } from "@storageflow/domain";
import { createApp } from "../src/app.js";
import { createResolver } from "../src/adapters.js";
import type { AppConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { JobQueue } from "../src/jobs.js";
import { migrate } from "../src/migrate.js";
import type { Deps } from "../src/services/access.js";

const key = Buffer.from("ab".repeat(32), "hex");

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
  };
}

class Jar {
  private cookies = new Map<string, string>();

  absorb(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  drop(name: string) {
    this.cookies.delete(name);
  }
}

async function bodyOf(response: Response) {
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  if (!text) return { status: response.status, json: null, response };
  if (type.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    return { status: response.status, json: JSON.parse(text), response };
  }
  return { status: response.status, json: text, response };
}

test("cabinet, portal, and public transfer", async () => {
  const db = await openDatabase("pglite:");
  await migrate(db);
  let current = Date.parse("2026-10-13T12:00:00Z");
  const jobs = new JobQueue();
  const deps: Deps = {
    db,
    adapters: createResolver("memory"),
    config: config(),
    jobs,
    now: () => new Date(current),
  };
  const app = createApp(deps);
  const jar = new Jar();

  async function call(method: string, path: string, options?: { json?: unknown; raw?: Uint8Array; jar?: Jar }) {
    const used = options?.jar ?? jar;
    const headers = new Headers();
    const cookie = used.header();
    if (cookie) headers.set("cookie", cookie);
    let body: Uint8Array | string | undefined;
    if (options?.raw) {
      body = options.raw;
      headers.set("content-length", String(options.raw.byteLength));
    } else if (options?.json !== undefined) {
      body = JSON.stringify(options.json);
      headers.set("content-type", "application/json");
    }
    const response = await app.request(path, { method, headers, body: body as BodyInit | undefined });
    used.absorb(response);
    return bodyOf(response);
  }

  async function step(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      throw new Error(`${name}\n${message}`);
    }
  }

  await step("sign in and open the acme workspace", async () => {
    const created = await call("POST", "/users", { json: { email: "ada@acme.test", name: "Ada", password: "correct-horse" } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const tenant = await call("POST", "/tenants", { json: { name: "Acme", slug: "acme" } });
    assert.equal(tenant.status, 201, JSON.stringify(tenant.json));
    assert.equal(tenant.json.activeTenant.slug, "acme");
    assert.equal(tenant.json.user.transferPlan, "free");
  });

  let workId = "";
  const projectIds: Record<string, string> = {};
  await step("create each project kind", async () => {
    for (const kind of ["work", "personal", "school", "sports", "custom"] as const) {
      const name = kind === "custom" ? "Studio" : kind[0].toUpperCase() + kind.slice(1);
      const response = await call("POST", "/projects", { json: { name, kind } });
      assert.equal(response.status, 201, JSON.stringify(response.json));
      assert.equal(response.json.kind, kind);
      projectIds[kind] = response.json.id;
    }
    workId = projectIds.work;
  });

  let hosted: { id: string; rootFolderId: string; projectId: string };
  let linked: { id: string; rootFolderId: string };
  let broken: { id: string };
  await step("hosted and linked drawers belong to the current project", async () => {
    const hostedResponse = await call("POST", `/projects/${workId}/drawers`, { json: { name: "Client files", mode: "hosted" } });
    assert.equal(hostedResponse.status, 201, JSON.stringify(hostedResponse.json));
    assert.equal(hostedResponse.json.projectId, workId);
    assert.equal(hostedResponse.json.secretSet, true);
    assert.equal(hostedResponse.json.secretCipher, undefined);
    assert.equal(hostedResponse.json.healthOk, true);
    hosted = hostedResponse.json;
    const other = await call("GET", `/projects/${projectIds.personal}/drawers`);
    assert.equal(other.json.length, 0);

    const linkedResponse = await call("POST", `/projects/${workId}/drawers`, {
      json: {
        name: "Scans",
        mode: "linked",
        endpoint: "memory://linked",
        region: "us-east-1",
        bucket: "scans",
        prefix: "inbox/",
        pathStyle: true,
        accessKey: "scan-key",
        secretKey: "scan-secret",
      },
    });
    assert.equal(linkedResponse.status, 201, JSON.stringify(linkedResponse.json));
    linked = linkedResponse.json;

    const brokenResponse = await call("POST", `/projects/${workId}/drawers`, {
      json: {
        name: "Bad key",
        mode: "linked",
        endpoint: "memory://broken",
        region: "us-east-1",
        bucket: "scans",
        prefix: "bad/",
        pathStyle: true,
        accessKey: "scan-key",
        secretKey: "bad-secret",
      },
    });
    assert.equal(brokenResponse.status, 201, JSON.stringify(brokenResponse.json));
    broken = brokenResponse.json;
    const tested = await call("POST", `/drawers/${broken.id}/test`);
    assert.equal(tested.json.ok, false);
    assert.match(tested.json.message, /access key/i);
    const drawers = await call("GET", `/projects/${workId}/drawers`);
    const found = drawers.json.find((drawer: { id: string }) => drawer.id === broken.id);
    assert.ok(found);
    assert.equal(found.healthOk, false);
    const refused = await call("POST", `/drawers/${broken.id}/folders`, { json: { parentId: found.rootFolderId, name: "Nope" } });
    assert.equal(refused.status, 409);
  });

  let rootFileId = "";
  let nestedFolderId = "";
  let childFolderId = "";
  await step("files live on the drawer root and nested folders appear once", async () => {
    const bytes = new TextEncoder().encode("cabinet file");
    const upload = await call("POST", `/drawers/${hosted.id}/uploads`, {
      json: { folderId: hosted.rootFolderId, name: "brief.txt", size: bytes.byteLength, contentType: "text/plain" },
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.json));
    assert.equal(upload.json.transport, "proxy");
    const put = await call("PUT", `/uploads/${upload.json.uploadId}/body`, { raw: bytes });
    assert.equal(put.status, 204, JSON.stringify(put.json));
    const done = await call("POST", `/uploads/${upload.json.uploadId}/complete`, { json: {} });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    rootFileId = done.json.id;

    const again = await call("GET", `/drawers/${hosted.id}/list?folderId=${hosted.rootFolderId}`);
    assert.equal(again.json.stale, false);
    assert.equal(again.json.files.length, 1);
    assert.equal(again.json.files[0].name, "brief.txt");
    assert.equal(again.json.folders.length, 0);

    const parent = await call("POST", `/drawers/${hosted.id}/folders`, { json: { parentId: hosted.rootFolderId, name: "Consulting" } });
    nestedFolderId = parent.json.id;
    const child = await call("POST", `/drawers/${hosted.id}/folders`, { json: { parentId: nestedFolderId, name: "Notes" } });
    childFolderId = child.json.id;
    const tree = await call("GET", `/drawers/${hosted.id}/tree`);
    const built = buildTree(
      tree.json.folders as { id: string; parentId: string | null; name: string }[],
      tree.json.root.id as string,
    );
    assert.deepEqual(built.map((node) => node.item.name), ["Consulting"]);
    assert.deepEqual(built[0].children.map((node) => node.item.name), ["Notes"]);
    const listing = await call("GET", `/drawers/${hosted.id}/list?folderId=${hosted.rootFolderId}`);
    assert.equal(listing.json.files.some((file: { name: string }) => file.name === "brief.txt"), true);
    const nestedList = await call("GET", `/drawers/${hosted.id}/list?folderId=${childFolderId}`);
    assert.equal(nestedList.json.files.length, 0);
  });

  await step("a second read sees a rename, star, and color", async () => {
    const renamed = await call("PATCH", `/nodes/${rootFileId}`, { json: { name: "brief-renamed.txt", starred: true, color: "blue" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    const otherTab = await call("GET", `/drawers/${hosted.id}/list?folderId=${hosted.rootFolderId}`);
    assert.equal(otherTab.json.files[0].name, "brief-renamed.txt");
    assert.equal(otherTab.json.files[0].starred, true);
    assert.equal(otherTab.json.files[0].color, "blue");
  });

  await step("move stays in the drawer and a failed copy leaves an incomplete file", async () => {
    const moved = await call("POST", "/nodes/move", { json: { nodeIds: [rootFileId], destinationFolderId: nestedFolderId } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const root = await call("GET", `/drawers/${hosted.id}/list?folderId=${hosted.rootFolderId}`);
    assert.equal(root.json.files.length, 0);
    const dest = await call("GET", `/drawers/${hosted.id}/list?folderId=${nestedFolderId}`);
    assert.equal(dest.json.files[0].name, "brief-renamed.txt");

    const flaky = await call("POST", `/projects/${workId}/drawers`, {
      json: {
        name: "Flaky",
        mode: "linked",
        endpoint: "memory://flaky",
        bucket: "elsewhere",
        prefix: "out/",
        accessKey: "k",
        secretKey: "good-secret",
      },
    });
    const copy = await call("POST", "/nodes/copy", {
      json: { nodeIds: [rootFileId], destinationDrawerId: flaky.json.id, destinationFolderId: flaky.json.rootFolderId },
    });
    assert.equal(copy.status, 202, JSON.stringify(copy.json));
    await jobs.whenIdle();
    const jobsResponse = await call("GET", `/projects/${workId}/drawers`);
    const flakyDrawer = jobsResponse.json.find((drawer: { id: string }) => drawer.id === flaky.json.id);
    assert.equal(flakyDrawer.jobs[0].status, "error");
    const copied = await call("GET", `/drawers/${flaky.json.id}/list?folderId=${flaky.json.rootFolderId}`);
    assert.equal(copied.json.files[0].incomplete, true);
  });

  await step("delete removes the nested folder from the backend cache", async () => {
    const deleted = await call("POST", "/nodes/delete", { json: { nodeIds: [nestedFolderId] } });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.ok(deleted.json.job);
    await jobs.whenIdle();
    const tree = await call("GET", `/drawers/${hosted.id}/tree`);
    assert.equal(tree.json.folders.some((folder: { id: string }) => folder.id === nestedFolderId || folder.id === childFolderId), false);
  });

  await step("a linked drawer root holds a file without a dummy folder", async () => {
    const bytes = new TextEncoder().encode("scan");
    const upload = await call("POST", `/drawers/${linked.id}/uploads`, {
      json: { folderId: linked.rootFolderId, name: "page.pdf", size: bytes.byteLength, contentType: "application/pdf" },
    });
    await call("PUT", `/uploads/${upload.json.uploadId}/body`, { raw: bytes });
    const done = await call("POST", `/uploads/${upload.json.uploadId}/complete`, { json: {} });
    const listing = await call("GET", `/drawers/${linked.id}/list?folderId=${linked.rootFolderId}`);
    assert.equal(listing.json.files[0].id, done.json.id);
    const download = await call("GET", `/nodes/${done.json.id}/content?download=1`);
    assert.equal(download.status, 200);
    assert.equal(download.json, "scan");
  });

  let portalSlug = "";
  let sharedFolderId = "";
  await step("a guest sees only the granted folder and loses it when the grant is revoked", async () => {
    const shared = await call("POST", `/drawers/${hosted.id}/folders`, { json: { parentId: hosted.rootFolderId, name: "Biology" } });
    const sibling = await call("POST", `/drawers/${hosted.id}/folders`, { json: { parentId: hosted.rootFolderId, name: "Chemistry" } });
    sharedFolderId = shared.json.id;
    const bytes = new TextEncoder().encode("lab notes");
    const upload = await call("POST", `/drawers/${hosted.id}/uploads`, {
      json: { folderId: sharedFolderId, name: "lab.txt", size: bytes.byteLength, contentType: "text/plain" },
    });
    await call("PUT", `/uploads/${upload.json.uploadId}/body`, { raw: bytes });
    await call("POST", `/uploads/${upload.json.uploadId}/complete`, { json: {} });
    const grant = await call("POST", `/nodes/${sharedFolderId}/grants`, {
      json: { email: "guest@school.test", verbs: ["list", "download", "upload"] },
    });
    assert.equal(grant.status, 201, JSON.stringify(grant.json));
    assert.ok(grant.json.link);
    portalSlug = grant.json.portalSlug;
    const token = new URL(grant.json.link).searchParams.get("token");
    const guestJar = new Jar();
    const session = await call("POST", `/portal/${portalSlug}/sessions`, { json: { token }, jar: guestJar });
    assert.equal(session.status, 200, JSON.stringify(session.json));
    const home = await call("GET", `/portal/${portalSlug}`, { jar: guestJar });
    assert.deepEqual(home.json.roots.map((root: { node: { name: string } }) => root.node.name), ["Biology"]);
    const siblingList = await call("GET", `/portal/${portalSlug}/list?drawerId=${hosted.id}&folderId=${sibling.json.id}`, { jar: guestJar });
    assert.equal(siblingList.status, 403);
    const allowed = await call("GET", `/portal/${portalSlug}/list?drawerId=${hosted.id}&folderId=${sharedFolderId}`, { jar: guestJar });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
    assert.equal(allowed.json.files[0].name, "lab.txt");
    const guestBytes = new TextEncoder().encode("from guest");
    const guestUpload = await call("POST", `/portal/${portalSlug}/uploads`, {
      json: { drawerId: hosted.id, folderId: sharedFolderId, name: "guest.txt", size: guestBytes.byteLength, contentType: "text/plain" },
      jar: guestJar,
    });
    assert.equal(guestUpload.status, 201, JSON.stringify(guestUpload.json));
    await call("PUT", `/uploads/${guestUpload.json.uploadId}/body`, { raw: guestBytes, jar: guestJar });
    await call("POST", `/uploads/${guestUpload.json.uploadId}/complete`, { json: {}, jar: guestJar });
    const activity = await call("GET", `/portal/${portalSlug}/activity`, { jar: guestJar });
    assert.equal(activity.json.some((event: { kind: string }) => event.kind === "upload"), true);
    assert.equal(activity.json.some((event: { kind: string }) => event.kind === "sign-in"), true);

    const drop = await call("POST", `/nodes/${sibling.json.id}/grants`, { json: { email: "guest@school.test", verbs: ["upload"] } });
    const dropHome = await call("GET", `/portal/${portalSlug}`, { jar: guestJar });
    const chemistry = dropHome.json.roots.find((root: { node: { name: string } }) => root.node.name === "Chemistry");
    assert.equal(chemistry.dropFolder, true);
    const hidden = await call("GET", `/portal/${portalSlug}/list?drawerId=${hosted.id}&folderId=${sibling.json.id}`, { jar: guestJar });
    assert.equal(hidden.status, 403);
    void drop;

    await call("DELETE", `/grants/${grant.json.id}`);
    const after = await call("GET", `/portal/${portalSlug}/list?drawerId=${hosted.id}&folderId=${sharedFolderId}`, { jar: guestJar });
    assert.equal(after.status, 403);
  });

  await step("public transfer distinguishes a free ticket from a paid one", async () => {
    const bytes = new TextEncoder().encode("public-bytes");
    const folder = await call("POST", `/drawers/${hosted.id}/folders`, { json: { parentId: hosted.rootFolderId, name: "Published" } });
    const upload = await call("POST", `/drawers/${hosted.id}/uploads`, {
      json: { folderId: folder.json.id, name: "story.txt", size: bytes.byteLength, contentType: "text/plain" },
    });
    await call("PUT", `/uploads/${upload.json.uploadId}/body`, { raw: bytes });
    const file = await call("POST", `/uploads/${upload.json.uploadId}/complete`, { json: {} });
    const publication = await call("POST", `/files/${file.json.id}/publication`, { json: { visibility: "unlisted", title: "Story" } });
    assert.equal(publication.status, 201, JSON.stringify(publication.json));
    const anon = new Jar();
    const metadata = await call("GET", `/publications/${publication.json.publicId}`, { jar: anon });
    assert.equal(metadata.json.fileName, "story.txt");
    assert.equal(metadata.json.size, bytes.byteLength);
    const ticket = await call("POST", `/publications/${publication.json.publicId}/tickets`, { json: {}, jar: anon });
    assert.equal(ticket.status, 201, JSON.stringify(ticket.json));
    assert.equal(ticket.json.plan, "free");
    assert.ok(Date.parse(ticket.json.readyAt) > current);
    const early = await call("GET", `/tickets/${ticket.json.id}/stream`, { jar: anon });
    assert.equal(early.status, 425);
    current += 30_000;
    const first = await app.request(`/tickets/${ticket.json.id}/stream`, { headers: { cookie: anon.header() } });
    assert.equal(first.status, 200);
    const second = await call("GET", `/tickets/${ticket.json.id}/stream`, { jar: anon });
    assert.equal(second.status, 409);
    await first.body?.cancel();
    const cooled = await call("POST", `/publications/${publication.json.publicId}/tickets`, { json: {}, jar: anon });
    assert.equal(cooled.status, 429);

    const paidJar = new Jar();
    await call("POST", "/users", { json: { email: "paid@example.test", name: "Pax", password: "correct-horse" }, jar: paidJar });
    const plan = await call("POST", "/me/transfer-plan", { json: { plan: "paid" }, jar: paidJar });
    assert.equal(plan.json.user.transferPlan, "paid");
    const paidTicket = await call("POST", `/publications/${publication.json.publicId}/tickets`, { json: {}, jar: paidJar });
    assert.equal(paidTicket.json.plan, "paid");
    assert.equal(Date.parse(paidTicket.json.readyAt), current);
    const paidStream = await call("GET", `/tickets/${paidTicket.json.id}/stream`, { jar: paidJar });
    assert.equal(paidStream.status, 200);
    assert.equal(paidStream.json, "public-bytes");

    await call("DELETE", `/publications/${publication.json.id}`);
    const dead = await call("GET", `/tickets/${paidTicket.json.id}/stream`, { jar: paidJar });
    assert.equal(dead.status, 410);
    const next = await call("POST", `/publications/${publication.json.publicId}/tickets`, { json: {}, jar: anon });
    assert.equal(next.status, 404);
    const missingShop = await call("GET", "/marketplace");
    assert.equal(missingShop.status, 404);
    const abuse = await call("POST", `/publications/${publication.json.publicId}/abuse`, { json: { note: "not the file I expected" }, jar: anon });
    assert.equal(abuse.status, 204);
  });

  await db.close();
});

test("migration 002 upgrades a database that already has 001", async () => {
  const db = await openDatabase("pglite:");
  const legacy = fs.readFileSync(new URL("../src/migrations/001.sql", import.meta.url), "utf8");
  await db.exec(legacy);
  await db.exec("CREATE TABLE schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL)");
  await db.query("INSERT INTO schema_migrations (id, applied_at) VALUES ('001', CURRENT_TIMESTAMP)");
  const userId = crypto.randomUUID();
  await db.query(`INSERT INTO users (id, email, name, transfer_plan, created_at) VALUES ($1,$2,$3,'free',$4)`, [
    userId,
    "old@acme.test",
    "Old",
    "2026-10-13T12:00:00.000Z",
  ]);
  await migrate(db);
  const user = await db.query<{ kind: string; disabled_at: string | null }>("SELECT kind, disabled_at FROM users WHERE id = $1", [userId]);
  assert.equal(user[0]?.kind, "user");
  assert.equal(user[0]?.disabled_at, null);
  await db.query("SELECT version_retention FROM tenants");
  await db.query("SELECT sort_order FROM nodes");
  await db.query("SELECT storage_key, version FROM file_versions");
  await db.query("SELECT action FROM audit_log");
  await db.query("SELECT key_hash, scopes FROM api_keys");
  const applied = await db.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
  assert.deepEqual(applied.map((row) => row.id), ["001", "002"]);
  await migrate(db);
  const again = await db.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
  assert.deepEqual(again.map((row) => row.id), ["001", "002"]);
  await db.close();
});

test("users, scoped keys, versions, reorder, and audit", async () => {
  const db = await openDatabase("pglite:");
  await migrate(db);
  const jobs = new JobQueue();
  const deps: Deps = {
    db,
    adapters: createResolver("memory"),
    config: config(),
    jobs,
    now: () => new Date("2026-10-14T12:00:00Z"),
  };
  const app = createApp(deps);
  const jar = new Jar();

  async function call(method: string, path: string, options?: { json?: unknown; raw?: Uint8Array; jar?: Jar; authorization?: string }) {
    const used = options?.jar ?? jar;
    const headers = new Headers();
    const cookie = used.header();
    if (cookie) headers.set("cookie", cookie);
    if (options?.authorization) headers.set("authorization", options.authorization);
    let body: Uint8Array | string | undefined;
    if (options?.raw) {
      body = options.raw;
      headers.set("content-length", String(options.raw.byteLength));
    } else if (options?.json !== undefined) {
      body = JSON.stringify(options.json);
      headers.set("content-type", "application/json");
    }
    const response = await app.request(path, { method, headers, body: body as BodyInit | undefined });
    if (!options?.authorization) used.absorb(response);
    return bodyOf(response);
  }

  async function upload(drawerId: string, folderId: string, name: string, text: string) {
    const bytes = new TextEncoder().encode(text);
    const started = await call("POST", `/drawers/${drawerId}/uploads`, {
      json: { folderId, name, size: bytes.byteLength, contentType: "text/plain" },
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const put = await call("PUT", `/uploads/${started.json.uploadId}/body`, { raw: bytes });
    assert.equal(put.status, 204, JSON.stringify(put.json));
    const done = await call("POST", `/uploads/${started.json.uploadId}/complete`, { json: {} });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    return done.json as { id: string };
  }

  const created = await call("POST", "/users", { json: { email: "ada@acme.test", name: "Ada", password: "correct-horse" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const tenant = await call("POST", "/tenants", { json: { name: "Acme", slug: "acme" } });
  assert.equal(tenant.status, 201, JSON.stringify(tenant.json));
  const project = await call("POST", "/projects", { json: { name: "Work", kind: "work" } });
  const drawer = await call("POST", `/projects/${project.json.id}/drawers`, { json: { name: "Client files", mode: "hosted" } });
  assert.equal(drawer.status, 201, JSON.stringify(drawer.json));

  const bob = await call("POST", "/admin/users", {
    json: { email: "bob@acme.test", name: "Bob", password: "correct-horse", kind: "user" },
  });
  assert.equal(bob.status, 201, JSON.stringify(bob.json));
  assert.equal(bob.json.kind, "user");
  assert.equal(bob.json.role, "member");
  const bobJar = new Jar();
  const bobSession = await call("POST", "/sessions", { json: { email: "bob@acme.test", password: "correct-horse" }, jar: bobJar });
  assert.equal(bobSession.status, 200, JSON.stringify(bobSession.json));
  const disabled = await call("POST", `/admin/users/${bob.json.id}/disable`);
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
  assert.ok(disabled.json.disabledAt);
  const bobAgain = await call("POST", "/sessions", { json: { email: "bob@acme.test", password: "correct-horse" }, jar: new Jar() });
  assert.equal(bobAgain.status, 403, JSON.stringify(bobAgain.json));
  const bobStill = await call("GET", "/me", { jar: bobJar });
  assert.equal(bobStill.status, 401, JSON.stringify(bobStill.json));

  const service = await call("POST", "/admin/users", { json: { email: "ci@acme.test", name: "CI", kind: "service" } });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  assert.equal(service.json.kind, "service");
  const servicePassword = await call("POST", "/sessions", {
    json: { email: "ci@acme.test", password: "correct-horse" },
    jar: new Jar(),
  });
  assert.equal(servicePassword.status, 401, JSON.stringify(servicePassword.json));
  assert.match(servicePassword.json.error.message, /API key/);
  const withPassword = await call("POST", "/admin/users", {
    json: { email: "bot@acme.test", name: "Bot", kind: "service", password: "correct-horse" },
  });
  assert.equal(withPassword.status, 400, JSON.stringify(withPassword.json));

  await call("POST", `/projects/${project.json.id}/members`, { json: { email: "ci@acme.test", role: "member" } });
  const issued = await call("POST", `/admin/users/${service.json.id}/keys`, { json: { name: "reader", scopes: ["list"] } });
  assert.equal(issued.status, 201, JSON.stringify(issued.json));
  assert.equal(issued.json.token.startsWith("sfk_"), true);
  assert.deepEqual(issued.json.scopes, ["list"]);
  const seeded = await upload(drawer.json.id, drawer.json.rootFolderId, "seed.txt", "seed");
  const listed = await call("GET", `/drawers/${drawer.json.id}/list?folderId=${drawer.json.rootFolderId}`, {
    authorization: `Bearer ${issued.json.token}`,
    jar: new Jar(),
  });
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.equal(listed.json.files.some((file: { name: string }) => file.name === "seed.txt"), true);
  const denied = await call("GET", `/nodes/${seeded.id}/content?download=1`, {
    authorization: `Bearer ${issued.json.token}`,
    jar: new Jar(),
  });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  const uploadDenied = await call("POST", `/drawers/${drawer.json.id}/uploads`, {
    authorization: `Bearer ${issued.json.token}`,
    jar: new Jar(),
    json: { folderId: drawer.json.rootFolderId, name: "nope.txt", size: 1, contentType: "text/plain" },
  });
  assert.equal(uploadDenied.status, 403, JSON.stringify(uploadDenied.json));

  const retention = await call("PATCH", "/admin/retention", { json: { count: 2 } });
  assert.equal(retention.json.count, 2);
  const versioned = await upload(drawer.json.id, drawer.json.rootFolderId, "notes.txt", "one");
  await upload(drawer.json.id, drawer.json.rootFolderId, "notes.txt", "two");
  await upload(drawer.json.id, drawer.json.rootFolderId, "notes.txt", "three");
  const versions = await call("GET", `/nodes/${versioned.id}/versions`);
  assert.equal(versions.status, 200, JSON.stringify(versions.json));
  assert.deepEqual(
    versions.json.map((item: { version: number }) => item.version),
    [2, 3],
  );
  assert.notEqual(versions.json[0].storageKey, versions.json[1].storageKey);
  const older = await call("GET", `/nodes/${versioned.id}/versions/2/content`);
  assert.equal(older.json, "two");
  const missing = await call("GET", `/nodes/${versioned.id}/versions/1/content`);
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
  const current = await call("GET", `/nodes/${versioned.id}/content?download=1`);
  assert.equal(current.json, "three");
  const restored = await call("POST", `/nodes/${versioned.id}/versions/2/restore`);
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  const afterRestore = await call("GET", `/nodes/${versioned.id}/content?download=1`);
  assert.equal(afterRestore.json, "two");

  const north = await call("POST", `/drawers/${drawer.json.id}/folders`, { json: { parentId: drawer.json.rootFolderId, name: "North" } });
  const south = await call("POST", `/drawers/${drawer.json.id}/folders`, { json: { parentId: drawer.json.rootFolderId, name: "South" } });
  const alpha = await upload(drawer.json.id, drawer.json.rootFolderId, "a.txt", "a");
  const beta = await upload(drawer.json.id, drawer.json.rootFolderId, "b.txt", "b");
  const folders = await call("POST", "/nodes/reorder", { json: { parentId: drawer.json.rootFolderId, ids: [south.json.id, north.json.id] } });
  assert.deepEqual(
    folders.json.map((node: { name: string }) => node.name),
    ["South", "North"],
  );
  const files = await call("POST", "/nodes/reorder", { json: { parentId: drawer.json.rootFolderId, ids: [beta.id, alpha.id] } });
  assert.deepEqual(
    files.json.map((node: { name: string }) => node.name),
    ["b.txt", "a.txt"],
  );
  const ordered = await call("GET", `/drawers/${drawer.json.id}/list?folderId=${drawer.json.rootFolderId}&sort=order`);
  assert.deepEqual(
    ordered.json.folders.map((node: { name: string }) => node.name),
    ["South", "North"],
  );
  assert.deepEqual(
    ordered.json.files.filter((node: { name: string }) => node.name === "a.txt" || node.name === "b.txt").map((node: { name: string }) => node.name),
    ["b.txt", "a.txt"],
  );

  const carol = await call("POST", "/admin/users", {
    json: { email: "carol@acme.test", name: "Carol", password: "correct-horse" },
  });
  const removed = await call("DELETE", `/admin/users/${carol.json.id}`);
  assert.equal(removed.status, 204, JSON.stringify(removed.json));
  const carolSignIn = await call("POST", "/sessions", { json: { email: "carol@acme.test", password: "correct-horse" }, jar: new Jar() });
  assert.equal(carolSignIn.status, 401, JSON.stringify(carolSignIn.json));

  const audit = await call("GET", "/audit");
  assert.equal(audit.status, 200, JSON.stringify(audit.json));
  const actions = audit.json.map((row: { action: string }) => row.action);
  assert.equal(actions.includes("user.disable"), true);
  assert.equal(actions.includes("api_key.issue"), true);
  assert.equal(actions.includes("version.restore"), true);
  const memberAudit = await call("GET", "/audit", { authorization: `Bearer ${issued.json.token}`, jar: new Jar() });
  assert.equal(memberAudit.status, 403, JSON.stringify(memberAudit.json));

  await db.close();
});

test("sign-up plus create-tenant yields an owner membership", async () => {
  const db = await openDatabase("pglite:");
  await migrate(db);
  const deps: Deps = {
    db,
    adapters: createResolver("memory"),
    config: config(),
    jobs: new JobQueue(),
    now: () => new Date("2026-10-14T12:00:00Z"),
  };
  const app = createApp(deps);
  const jar = new Jar();

  async function call(method: string, path: string, json?: unknown) {
    const headers = new Headers({ "content-type": "application/json" });
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
    const response = await app.request(path, {
      method,
      headers,
      body: JSON.stringify(json ?? {}),
    });
    jar.absorb(response);
    return bodyOf(response);
  }

  const created = await call("POST", "/users", { email: "ada@north.test", name: "Ada", password: "correct-horse" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.activeTenant, null);
  const tenant = await call("POST", "/tenants", { name: "North Lab" });
  assert.equal(tenant.status, 201, JSON.stringify(tenant.json));
  assert.equal(tenant.json.activeTenant.role, "owner");
  assert.equal(tenant.json.activeTenant.name, "North Lab");
  assert.equal(tenant.json.memberships.length, 1);
  assert.equal(tenant.json.memberships[0].role, "owner");
  assert.equal(tenant.json.memberships[0].tenantId, tenant.json.activeTenant.id);
  const rows = await db.query<{ role: string }>("SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2", [
    created.json.user.id,
    tenant.json.activeTenant.id,
  ]);
  assert.equal(rows[0]?.role, "owner");
  await db.close();
});
