import crypto from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sha256 } from "./crypto.js";
import { HttpError, asObject, contentDisposition } from "./http.js";
import { mapActivity, type Row } from "./mappers.js";
import type { Deps, GuestActor, MemberActor } from "./services/access.js";
import { membershipRole, requireProject } from "./services/access.js";
import {
  completeUpload,
  copyNodes,
  createDrawer,
  createFolder,
  createProject,
  deleteDrawer,
  deleteNodes,
  deleteProject,
  folderTree,
  listDrawers,
  listFolder,
  listProjects,
  moveNodes,
  openContent,
  patchNode,
  searchProject,
  startUpload,
  testDrawer,
  testUnsavedDrawer,
  updateDrawer,
  updateProject,
  writeUpload,
} from "./services/cabinet.js";
import {
  addMember,
  consumeMagicLink,
  createSession,
  createTenant,
  getMe,
  listMembers,
  removeMember,
  savePreferences,
  setTransferPlan,
  signIn,
  signOut,
  signOutAll,
  signUp,
  startMagicLink,
  switchTenant,
  updateProfile,
} from "./services/account.js";
import { createGrant, listGrants, openPortal, portalActivity, portalHome, revokeGrant } from "./services/sharing.js";
import { catalog, createTicket, publicMetadata, publishFile, readTicket, reportAbuse, streamTicket, unpublish, updateTransferSettings } from "./services/transfer.js";

type AppEnv = {
  Variables: {
    session: Row | null;
    portalSession: Row | null;
    user: Row | null;
    token: string | null;
  };
};

const SESSION = "sf_session";
const PORTAL = "sf_portal";
const VISITOR = "sf_visitor";

async function readBody(c: { req: { text: () => Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text) return {};
  try {
    return asObject(JSON.parse(text));
  } catch {
    throw new HttpError(400, "invalid", "Expected JSON");
  }
}

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  app.use("*", async (c, next) => {
    c.set("session", null);
    c.set("portalSession", null);
    c.set("user", null);
    c.set("token", null);
    const token = getCookie(c, SESSION);
    const portalToken = getCookie(c, PORTAL);
    if (token) {
      const rows = await deps.db.query<Row>("SELECT * FROM sessions WHERE token_hash = $1 AND kind = 'member'", [sha256(token)]);
      const session = rows[0];
      if (session && new Date(String(session.expires_at)).getTime() > deps.now().getTime()) {
        c.set("session", session);
        c.set("token", token);
        if (session.user_id) {
          const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [String(session.user_id)]);
          if (users[0]) c.set("user", users[0]);
        }
      }
    }
    if (portalToken) {
      const rows = await deps.db.query<Row>("SELECT * FROM sessions WHERE token_hash = $1 AND kind = 'guest'", [sha256(portalToken)]);
      const session = rows[0];
      if (session && new Date(String(session.expires_at)).getTime() > deps.now().getTime()) c.set("portalSession", session);
    }
    await next();
  });

  function cookieOptions(maxAge: number) {
    return { httpOnly: true, sameSite: "Lax" as const, path: "/", secure: deps.config.secureCookie, maxAge };
  }

  async function signedIn(c: { get: (key: "session" | "user") => Row | null }): Promise<{ user: Row; session: Row }> {
    const session = c.get("session");
    const user = c.get("user");
    if (!session || !user) throw new HttpError(401, "unauthorized", "Sign in");
    return { user, session };
  }

  async function member(c: { get: (key: "session" | "user") => Row | null }): Promise<MemberActor> {
    const { user, session } = await signedIn(c);
    if (!session.active_tenant_id) throw new HttpError(409, "tenant_required", "Choose a workspace");
    const role = await membershipRole(deps.db, String(session.active_tenant_id), String(user.id));
    if (!role) throw new HttpError(403, "forbidden", "You are not in this workspace");
    return {
      kind: "member",
      userId: String(user.id),
      email: String(user.email),
      name: String(user.name),
      tenantId: String(session.active_tenant_id),
      tenantRole: role,
      transferPlan: String(user.transfer_plan) === "paid" ? "paid" : "free",
    };
  }

  function guest(c: { get: (key: "portalSession") => Row | null }, slug?: string): GuestActor {
    const session = c.get("portalSession");
    if (!session?.portal_id || !session.active_tenant_id) throw new HttpError(401, "unauthorized", "Sign in to the portal");
    if (slug) {
      // slug checked by the caller against the portal row
    }
    return {
      kind: "guest",
      userId: session.user_id ? String(session.user_id) : null,
      email: session.guest_email ? String(session.guest_email) : null,
      portalId: String(session.portal_id),
      linkGrantId: session.link_grant_id ? String(session.link_grant_id) : null,
      tenantId: String(session.active_tenant_id),
    };
  }

  async function actorForUpload(c: Parameters<typeof member>[0] & { get: (key: "portalSession") => Row | null }, tenantId: string) {
    const session = c.get("session");
    if (session?.active_tenant_id && String(session.active_tenant_id) === tenantId && c.get("user")) return member(c);
    const portal = c.get("portalSession");
    if (portal && String(portal.active_tenant_id) === tenantId) return guest(c);
    throw new HttpError(401, "unauthorized", "Sign in");
  }

  const ensureVisitor = (c: { req: { header: (name: string) => string | undefined } } & { header: (name: string, value: string) => void }) => {
    let token = getCookie(c as never, VISITOR);
    if (!token) {
      token = crypto.randomUUID() + crypto.randomUUID();
      setCookie(c as never, VISITOR, token, cookieOptions(60 * 60 * 24 * 400));
    }
    return sha256(token);
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/users", async (c) => {
    const user = await signUp(deps, await readBody(c));
    const token = await createSession(deps, {
      userId: String(user.id),
      tenantId: null,
      kind: "member",
    });
    setCookie(c, SESSION, token, cookieOptions(60 * 60 * 24 * 30));
    return c.json(await getMe(deps, user, null), 201);
  });

  app.post("/sessions", async (c) => {
    const body = await readBody(c);
    const result = await signIn(deps, String(body.email ?? ""), String(body.password ?? ""));
    setCookie(c, SESSION, result.token, cookieOptions(60 * 60 * 24 * 30));
    return c.json(await getMe(deps, result.user, result.tenantId));
  });

  app.post("/sessions/magic", async (c) => {
    const body = await readBody(c);
    return c.json(await startMagicLink(deps, String(body.email ?? "")));
  });

  app.post("/sessions/magic/consume", async (c) => {
    const body = await readBody(c);
    const result = await consumeMagicLink(deps, String(body.token ?? ""));
    setCookie(c, SESSION, result.token, cookieOptions(60 * 60 * 24 * 30));
    return c.json(await getMe(deps, result.user, result.tenantId));
  });

  app.delete("/sessions/current", async (c) => {
    await signOut(deps, getCookie(c, SESSION) ?? null);
    deleteCookie(c, SESSION, { path: "/" });
    return c.body(null, 204);
  });

  app.delete("/sessions", async (c) => {
    const actor = await member(c);
    await signOutAll(deps, actor.userId);
    deleteCookie(c, SESSION, { path: "/" });
    return c.body(null, 204);
  });

  app.post("/sessions/tenant", async (c) => {
    const actor = await member(c);
    const token = getCookie(c, SESSION);
    if (!token) throw new HttpError(401, "unauthorized", "Sign in");
    const body = await readBody(c);
    await switchTenant(deps, token, actor.userId, String(body.tenantId ?? ""));
    const user = c.get("user");
    if (!user) throw new HttpError(401, "unauthorized", "Sign in");
    return c.json(await getMe(deps, user, String(body.tenantId)));
  });

  app.post("/tenants", async (c) => {
    const { user } = await signedIn(c);
    const token = getCookie(c, SESSION);
    if (!token) throw new HttpError(401, "unauthorized", "Sign in");
    await createTenant(deps, String(user.id), await readBody(c), token);
    const sessions = await deps.db.query<Row>("SELECT active_tenant_id FROM sessions WHERE token_hash = $1", [sha256(token)]);
    return c.json(await getMe(deps, user, sessions[0] ? String(sessions[0].active_tenant_id) : null), 201);
  });

  app.get("/me", async (c) => {
    const { user, session } = await signedIn(c);
    return c.json(await getMe(deps, user, session.active_tenant_id ? String(session.active_tenant_id) : null));
  });

  app.patch("/me", async (c) => {
    const actor = await member(c);
    await updateProfile(deps, actor.userId, await readBody(c));
    const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [actor.userId]);
    return c.json(await getMe(deps, users[0], actor.tenantId));
  });

  app.patch("/me/preferences", async (c) => {
    const actor = await member(c);
    return c.json(await savePreferences(deps, actor.userId, actor.tenantId, await readBody(c)));
  });

  app.post("/me/transfer-plan", async (c) => {
    const current = c.get("user");
    if (!current) throw new HttpError(401, "unauthorized", "Sign in");
    const body = await readBody(c);
    await setTransferPlan(deps, current, body.plan === "paid" ? "paid" : "free");
    const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [String(current.id)]);
    const session = c.get("session");
    return c.json(await getMe(deps, users[0], session?.active_tenant_id ? String(session.active_tenant_id) : null));
  });

  app.patch("/transfer-settings", async (c) => {
    const actor = await member(c);
    return c.json(await updateTransferSettings(deps, actor, await readBody(c)));
  });

  app.get("/projects", async (c) => c.json(await listProjects(deps, await member(c))));

  app.post("/projects", async (c) => c.json(await createProject(deps, await member(c), await readBody(c)), 201));

  app.patch("/projects/:id", async (c) => c.json(await updateProject(deps, await member(c), c.req.param("id"), await readBody(c))));

  app.delete("/projects/:id", async (c) => {
    await deleteProject(deps, await member(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/projects/:id/members", async (c) => c.json(await listMembers(deps, await member(c), c.req.param("id"))));

  app.post("/projects/:id/members", async (c) => c.json(await addMember(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.delete("/projects/:id/members/:userId", async (c) => {
    await removeMember(deps, await member(c), c.req.param("id"), c.req.param("userId"));
    return c.body(null, 204);
  });

  app.get("/projects/:id/drawers", async (c) => c.json(await listDrawers(deps, await member(c), c.req.param("id"))));

  app.post("/projects/:id/drawers/test", async (c) => c.json(await testUnsavedDrawer(deps, await member(c), c.req.param("id"), await readBody(c))));

  app.post("/projects/:id/drawers", async (c) => c.json(await createDrawer(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.get("/projects/:id/search", async (c) => c.json(await searchProject(deps, await member(c), c.req.param("id"), c.req.query("q") ?? "")));

  app.post("/drawers/:id/test", async (c) => c.json(await testDrawer(deps, await member(c), c.req.param("id"))));

  app.patch("/drawers/:id", async (c) => c.json(await updateDrawer(deps, await member(c), c.req.param("id"), await readBody(c))));

  app.delete("/drawers/:id", async (c) => {
    await deleteDrawer(deps, await member(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/drawers/:id/list", async (c) => {
    const actor = await member(c);
    return c.json(
      await listFolder(deps, actor, c.req.param("id"), c.req.query("folderId") ?? "", {
        q: c.req.query("q") ?? "",
        color: c.req.query("color") ?? "",
        sort: c.req.query("sort") ?? "name",
        dir: c.req.query("dir") ?? "asc",
        cursor: c.req.query("cursor") ?? "",
        limit: Number(c.req.query("limit") ?? 200),
      }),
    );
  });

  app.get("/drawers/:id/tree", async (c) => c.json(await folderTree(deps, await member(c), c.req.param("id"))));

  app.post("/drawers/:id/folders", async (c) => c.json(await createFolder(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.post("/drawers/:id/uploads", async (c) => c.json(await startUpload(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.put("/uploads/:id/body", async (c) => {
    const rows = await deps.db.query<Row>("SELECT * FROM upload_sessions WHERE id = $1", [c.req.param("id")]);
    if (!rows[0]) throw new HttpError(404, "not_found", "Upload not found");
    const actor = await actorForUpload(c, String(rows[0].tenant_id));
    const length = Number(c.req.header("content-length") ?? "");
    if (!c.req.raw.body || !Number.isFinite(length)) throw new HttpError(400, "invalid", "Upload body is required");
    await writeUpload(deps, actor, c.req.param("id"), c.req.raw.body, length);
    return c.body(null, 204);
  });

  app.post("/uploads/:id/complete", async (c) => {
    const rows = await deps.db.query<Row>("SELECT * FROM upload_sessions WHERE id = $1", [c.req.param("id")]);
    if (!rows[0]) throw new HttpError(404, "not_found", "Upload not found");
    const actor = await actorForUpload(c, String(rows[0].tenant_id));
    return c.json(await completeUpload(deps, actor, c.req.param("id"), await readBody(c)));
  });

  app.post("/nodes/move", async (c) => c.json(await moveNodes(deps, await member(c), await readBody(c))));

  app.post("/nodes/copy", async (c) => c.json(await copyNodes(deps, await member(c), await readBody(c)), 202));

  app.post("/nodes/delete", async (c) => c.json(await deleteNodes(deps, await member(c), await readBody(c))));

  app.patch("/nodes/:id", async (c) => c.json(await patchNode(deps, await member(c), c.req.param("id"), await readBody(c))));

  app.get("/nodes/:id/content", async (c) => sendContent(c, await member(c), c.req.param("id")));

  app.get("/nodes/:id/grants", async (c) => c.json(await listGrants(deps, await member(c), c.req.param("id"))));

  app.post("/nodes/:id/grants", async (c) => c.json(await createGrant(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.delete("/grants/:id", async (c) => {
    await revokeGrant(deps, await member(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/activity", async (c) => {
    const actor = await member(c);
    const projectId = c.req.query("projectId") ?? "";
    if (projectId) await requireProject(deps, actor, projectId);
    const kind = c.req.query("kind") ?? "";
    const rows = await deps.db.query<Row>(
      `SELECT * FROM activity WHERE tenant_id = $1 AND ($2 = '' OR project_id::text = $2) AND ($3 = '' OR kind = $3)
       ORDER BY created_at DESC LIMIT 200`,
      [actor.tenantId, projectId, kind],
    );
    return c.json(rows.map(mapActivity));
  });

  app.post("/files/:id/publication", async (c) => c.json(await publishFile(deps, await member(c), c.req.param("id"), await readBody(c)), 201));

  app.get("/files/:id/publication", async (c) => {
    const actor = await member(c);
    const rows = await deps.db.query<Row>(
      `SELECT * FROM publications WHERE node_id = $1 AND tenant_id = $2 AND unpublished_at IS NULL`,
      [c.req.param("id"), actor.tenantId],
    );
    return c.json(rows[0] ? { publicId: String(rows[0].public_id), id: String(rows[0].id), title: String(rows[0].title), visibility: String(rows[0].visibility), note: String(rows[0].note ?? "") } : null);
  });

  app.delete("/publications/:id", async (c) => {
    await unpublish(deps, await member(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/publications/:publicId", async (c) => c.json(await publicMetadata(deps, c.req.param("publicId"))));

  app.post("/publications/:publicId/tickets", async (c) => {
    const user = c.get("user");
    const plan = user && String(user.transfer_plan) === "paid" ? "paid" : "free";
    return c.json(await createTicket(deps, c.req.param("publicId"), ensureVisitor(c), plan, user ? String(user.id) : null), 201);
  });

  app.post("/publications/:publicId/abuse", async (c) => {
    const body = await readBody(c);
    const note = String(body.note ?? "").trim();
    if (!note) throw new HttpError(400, "invalid", "note is required");
    await reportAbuse(deps, c.req.param("publicId"), note);
    return c.body(null, 204);
  });

  app.get("/tickets/:id", async (c) => c.json(await readTicket(deps, c.req.param("id"), ensureVisitor(c))));

  app.get("/tickets/:id/stream", async (c) => {
    const opened = await streamTicket(deps, c.req.param("id"), ensureVisitor(c));
    return c.body(opened.stream, 200, {
      "content-type": opened.contentType,
      "content-disposition": contentDisposition("attachment", opened.fileName),
      "content-length": String(opened.size),
      "cache-control": "no-store",
    });
  });

  app.get("/catalog/:tenantSlug", async (c) => c.json(await catalog(deps, c.req.param("tenantSlug"))));

  app.post("/portal/:slug/sessions", async (c) => {
    const opened = await openPortal(deps, c.req.param("slug"), await readBody(c));
    setCookie(c, PORTAL, opened.token, cookieOptions(60 * 60 * 24 * 14));
    return c.json({ email: opened.email });
  });

  app.delete("/portal/:slug/sessions", async (c) => {
    const token = getCookie(c, PORTAL);
    await signOut(deps, token ?? null);
    deleteCookie(c, PORTAL, { path: "/" });
    return c.body(null, 204);
  });

  app.get("/portal/:slug", async (c) => c.json(await portalHome(deps, guest(c), c.req.param("slug"))));

  app.get("/portal/:slug/list", async (c) => {
    const actor = guest(c);
    return c.json(
      await listFolder(deps, actor, c.req.query("drawerId") ?? "", c.req.query("folderId") ?? "", {
        q: c.req.query("q") ?? "",
        color: "",
        sort: c.req.query("sort") ?? "name",
        dir: c.req.query("dir") ?? "asc",
        cursor: c.req.query("cursor") ?? "",
        limit: Number(c.req.query("limit") ?? 200),
      }),
    );
  });

  app.get("/portal/:slug/tree", async (c) => c.json(await folderTree(deps, guest(c), c.req.query("drawerId") ?? "")));

  app.post("/portal/:slug/folders", async (c) => {
    const body = await readBody(c);
    return c.json(await createFolder(deps, guest(c), String(body.drawerId ?? ""), body), 201);
  });

  app.post("/portal/:slug/uploads", async (c) => {
    const body = await readBody(c);
    return c.json(await startUpload(deps, guest(c), String(body.drawerId ?? ""), body), 201);
  });

  app.post("/portal/:slug/nodes/move", async (c) => c.json(await moveNodes(deps, guest(c), await readBody(c))));

  app.post("/portal/:slug/nodes/delete", async (c) => c.json(await deleteNodes(deps, guest(c), await readBody(c))));

  app.patch("/portal/:slug/nodes/:id", async (c) => c.json(await patchNode(deps, guest(c), c.req.param("id"), await readBody(c))));

  app.get("/portal/:slug/nodes/:id/content", async (c) => sendContent(c, guest(c), c.req.param("id")));

  app.get("/portal/:slug/activity", async (c) => c.json(await portalActivity(deps, guest(c), c.req.param("slug"))));

  async function sendContent(c: { req: { query: (name: string) => string | undefined; header: (name: string) => string | undefined } }, actor: MemberActor | GuestActor, nodeId: string) {
    const download = c.req.query("download") === "1";
    const header = c.req.header("range");
    const match = header ? /bytes=(\d+)-(\d*)/.exec(header) : null;
    const range = match ? { start: Number(match[1]), end: match[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER } : undefined;
    const opened = await openContent(deps, actor, nodeId, "download", range);
    const headers: Record<string, string> = {
      "content-type": opened.node.contentType ?? "application/octet-stream",
      "content-disposition": contentDisposition(download ? "attachment" : "inline", opened.node.name),
      "accept-ranges": "bytes",
      "cache-control": "private",
    };
    if (range) {
      const end = Math.min(range.end, Math.max(opened.size - 1, 0));
      headers["content-range"] = `bytes ${range.start}-${end}/${opened.size}`;
      headers["content-length"] = String(end - range.start + 1);
      return new Response(opened.stream, { status: 206, headers });
    }
    headers["content-length"] = String(opened.size);
    return new Response(opened.stream, { status: 200, headers });
  }

  return app;
}
