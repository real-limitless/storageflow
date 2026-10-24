import crypto from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { GrantVerb } from "@storageflow/domain";
import { normalizeScopes } from "@storageflow/domain";
import { resolveClientIp } from "./client-ip.js";
import { sha256 } from "./crypto.js";
import { HttpError, contentDisposition } from "./http.js";
import type { LogCategory, LogOutcome } from "./log.js";
import { SlidingWindowLimiter, type RateRule } from "./rate-limit.js";
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
  reorderNodes,
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
import { createTeamUser, deleteTeamUser, disableTeamUser, issueApiKey, listAudit, listTeamUsers, readRetention, updateRetention } from "./services/admin.js";
import { beginMfaEnrollment, confirmMfaEnrollment, verifyMfaChallenge } from "./services/mfa.js";
import { listFileVersions, openFileVersion, restoreFileVersion } from "./services/versions.js";
import { answerQuestion, semanticSearch } from "./services/semantic.js";
import { createGrant, listGrants, openPortal, portalActivity, portalHome, revokeGrant } from "./services/sharing.js";
import { catalog, createTicket, publicMetadata, publishFile, readTicket, reportAbuse, streamTicket, unpublish, updateTransferSettings } from "./services/transfer.js";
import {
  abuseSchema,
  apiKeySchema,
  asBody,
  askSchema,
  completeUploadSchema,
  copySchema,
  deleteSchema,
  drawerSchema,
  emptySchema,
  folderSchema,
  grantSchema,
  magicConsumeSchema,
  magicSchema,
  memberSchema,
  mfaConfirmSchema,
  mfaSchema,
  moveSchema,
  patchNodeSchema,
  planSchema,
  portalSessionSchema,
  preferencesSchema,
  profileSchema,
  projectSchema,
  publishSchema,
  readJson,
  reorderSchema,
  retentionSchema,
  signInSchema,
  signUpSchema,
  teamUserSchema,
  tenantSchema,
  tenantSwitchSchema,
  transferSettingsSchema,
  uploadSchema,
} from "./validate.js";

type AppEnv = {
  Variables: {
    session: Row | null;
    portalSession: Row | null;
    user: Row | null;
    token: string | null;
    apiScopes: GrantVerb[] | null;
    requestId: string;
    clientIp: string;
    keyPrefix: string | null;
  };
};

const SESSION = "sf_session";
const PORTAL = "sf_portal";
const VISITOR = "sf_visitor";

function readKeyScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const limits = new SlidingWindowLimiter(() => deps.now().getTime());

  function socketPeer(c: Context<AppEnv>): string | null {
    if (deps.peerAddress) return deps.peerAddress(c.req.raw);
    try {
      const address = getConnInfo(c).remote.address;
      return typeof address === "string" ? address : null;
    } catch {
      return null;
    }
  }

  function clientAddress(c: Context<AppEnv>): string {
    return resolveClientIp({
      peer: socketPeer(c),
      forwardedFor: c.req.header("x-forwarded-for") ?? null,
      realIp: c.req.header("x-real-ip") ?? null,
      trusted: deps.config.trustedProxies,
    });
  }

  function actorLabel(c: Context<AppEnv>, override?: string | null): string | null {
    if (override !== undefined) return override;
    const prefix = c.get("keyPrefix");
    if (prefix) return `key:${prefix}`;
    const user = c.get("user");
    if (user?.id) return `user:${String(user.id)}`;
    return null;
  }

  function audit(
    c: Context<AppEnv>,
    event: { category: LogCategory; action: string; outcome: LogOutcome; actor?: string | null; message?: string },
  ) {
    deps.logger?.write({
      timestamp: deps.now().toISOString(),
      service: "storageflow-api",
      environment: deps.config.environment,
      request_id: c.get("requestId") ?? null,
      actor: actorLabel(c, event.actor),
      source_ip: c.get("clientIp") ?? null,
      action: event.action,
      outcome: event.outcome,
      category: event.category,
      message: event.message,
    });
  }

  function enforce(c: Context<AppEnv>, action: string, rule: RateRule, bucket: string): Response | null {
    if (!deps.config.rateLimit.enabled) return null;
    const decision = limits.take(`${action}:${bucket}`, rule);
    if (decision.allowed) return null;
    audit(c, { category: "rate_limit", action, outcome: "failure", actor: null });
    c.header("Retry-After", String(decision.retryAfterSeconds));
    return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
  }

  function accountBucket(value: string): string {
    return sha256(value).slice(0, 32);
  }

  function authFailureAction(c: Context<AppEnv>): string {
    const authorization = c.req.header("authorization") ?? "";
    if (/^Bearer\s+sfk_/i.test(authorization)) return "auth.api_key";
    const path = c.req.path;
    if (c.req.method === "POST" && path === "/users") return "auth.sign_up";
    if (c.req.method === "POST" && path === "/sessions") return "auth.sign_in";
    if (c.req.method === "POST" && path === "/sessions/magic") return "auth.magic.start";
    if (c.req.method === "POST" && path === "/sessions/magic/consume") return "auth.magic.consume";
    if (c.req.method === "POST" && path === "/sessions/mfa") return "auth.mfa";
    if (c.req.method === "POST" && /^\/portal\/[^/]+\/sessions$/.test(path)) return "auth.portal";
    return "auth.rejected";
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      if (error.status === 401) audit(c, { category: "auth", action: authFailureAction(c), outcome: "failure", actor: null });
      else if (error.status === 403) audit(c, { category: "access", action: "access.denied", outcome: "denied" });
      return c.json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : "internal error";
    audit(c, { category: "runtime", action: "request.fail", outcome: "failure", message });
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id") ?? "";
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    c.set("clientIp", clientAddress(c));
    c.set("keyPrefix", null);
    c.header("X-Request-Id", requestId);
    await next();
  });

  app.use("*", async (c, next) => {
    c.set("session", null);
    c.set("portalSession", null);
    c.set("user", null);
    c.set("token", null);
    c.set("apiScopes", null);
    const bearer = /^Bearer\s+(\S+)/i.exec(c.req.header("authorization") ?? "");
    if (bearer?.[1]?.startsWith("sfk_")) {
      const presented = bearer[1];
      const keys = await deps.db.query<Row>("SELECT * FROM api_keys WHERE key_hash = $1", [sha256(presented)]);
      const key = keys[0];
      if (!key) throw new HttpError(401, "unauthorized", "API key is not valid");
      if (key.expires_at && new Date(String(key.expires_at)).getTime() <= deps.now().getTime()) {
        throw new HttpError(401, "unauthorized", "API key expired");
      }
      const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [String(key.user_id)]);
      const user = users[0];
      if (!user || String(user.kind) !== "service") throw new HttpError(401, "unauthorized", "API key is not valid");
      if (user.disabled_at) throw new HttpError(403, "disabled", "This account is disabled");
      const rawScopes = readKeyScopes(key.scopes);
      const scopes = normalizeScopes(rawScopes);
      if (!scopes) throw new HttpError(401, "unauthorized", "API key is not valid");
      const keyPrefix = presented.slice(0, 12);
      c.set("user", user);
      c.set("apiScopes", scopes);
      c.set("keyPrefix", keyPrefix);
      audit(c, { category: "auth", action: "auth.api_key", outcome: "success", actor: `key:${keyPrefix}` });
      c.set("session", {
        user_id: user.id,
        active_tenant_id: key.tenant_id,
        kind: "member",
        expires_at: new Date(deps.now().getTime() + 60_000).toISOString(),
      });
      await next();
      return;
    }
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
          const user = users[0];
          if (user && !user.disabled_at && String(user.kind) !== "service") c.set("user", user);
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

  async function member(c: { get: (key: "session" | "user" | "apiScopes") => unknown }): Promise<MemberActor> {
    const session = c.get("session") as Row | null;
    const user = c.get("user") as Row | null;
    if (!session || !user) throw new HttpError(401, "unauthorized", "Sign in");
    if (!session.active_tenant_id) throw new HttpError(409, "tenant_required", "Choose a workspace");
    const role = await membershipRole(deps.db, String(session.active_tenant_id), String(user.id));
    if (!role) throw new HttpError(403, "forbidden", "You are not in this workspace");
    const scopes = c.get("apiScopes") as GrantVerb[] | null;
    return {
      kind: "member",
      userId: String(user.id),
      email: String(user.email),
      name: String(user.name),
      tenantId: String(session.active_tenant_id),
      tenantRole: role,
      transferPlan: String(user.transfer_plan) === "paid" ? "paid" : "free",
      scopes: scopes ?? undefined,
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
    const session = c.get("session") as Row | null;
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
    const limited = enforce(c, "auth.sign_up", deps.config.rateLimit.signupIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const body = await readJson(c, signUpSchema);
    const account = enforce(c, "auth.sign_up", deps.config.rateLimit.signupAccount, `acct:${accountBucket(body.email.trim().toLowerCase())}`);
    if (account) return account;
    const user = await signUp(deps, asBody(body));
    const token = await createSession(deps, {
      userId: String(user.id),
      tenantId: null,
      kind: "member",
    });
    setCookie(c, SESSION, token, cookieOptions(60 * 60 * 24 * 30));
    audit(c, { category: "auth", action: "auth.sign_up", outcome: "success", actor: `user:${String(user.id)}` });
    return c.json(await getMe(deps, user, null), 201);
  });

  app.post("/sessions", async (c) => {
    const limited = enforce(c, "auth.sign_in", deps.config.rateLimit.signInIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const body = await readJson(c, signInSchema);
    const account = enforce(c, "auth.sign_in", deps.config.rateLimit.signInAccount, `acct:${accountBucket(body.email.trim().toLowerCase())}`);
    if (account) return account;
    const result = await signIn(deps, body.email, body.password);
    if (result.mfaRequired) {
      audit(c, { category: "auth", action: "auth.sign_in", outcome: "success", message: "mfa_required" });
      return c.json({ mfaRequired: true, challenge: result.challenge });
    }
    setCookie(c, SESSION, result.token, cookieOptions(60 * 60 * 24 * 30));
    audit(c, { category: "auth", action: "auth.sign_in", outcome: "success", actor: `user:${String(result.user.id)}` });
    return c.json(await getMe(deps, result.user, result.tenantId));
  });

  app.post("/sessions/magic", async (c) => {
    const limited = enforce(c, "auth.magic.start", deps.config.rateLimit.magicIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const body = await readJson(c, magicSchema);
    const account = enforce(c, "auth.magic.start", deps.config.rateLimit.magicAccount, `acct:${accountBucket(body.email.trim().toLowerCase())}`);
    if (account) return account;
    const started = await startMagicLink(deps, body.email);
    audit(c, { category: "auth", action: "auth.magic.start", outcome: "success", actor: null });
    return c.json(started);
  });

  app.post("/sessions/magic/consume", async (c) => {
    const limited = enforce(c, "auth.magic.consume", deps.config.rateLimit.magicConsumeIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const body = await readJson(c, magicConsumeSchema);
    const account = enforce(c, "auth.magic.consume", deps.config.rateLimit.magicConsumeAccount, `acct:${accountBucket(body.token)}`);
    if (account) return account;
    const result = await consumeMagicLink(deps, body.token);
    if (result.mfaRequired) {
      audit(c, { category: "auth", action: "auth.magic.consume", outcome: "success", message: "mfa_required" });
      return c.json({ mfaRequired: true, challenge: result.challenge });
    }
    setCookie(c, SESSION, result.token, cookieOptions(60 * 60 * 24 * 30));
    audit(c, { category: "auth", action: "auth.magic.consume", outcome: "success", actor: `user:${String(result.user.id)}` });
    return c.json(await getMe(deps, result.user, result.tenantId));
  });

  app.post("/sessions/mfa", async (c) => {
    const limited = enforce(c, "auth.mfa", deps.config.rateLimit.mfaIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const body = await readJson(c, mfaSchema);
    const account = enforce(c, "auth.mfa", deps.config.rateLimit.mfaAccount, `acct:${accountBucket(body.challenge)}`);
    if (account) return account;
    const result = await verifyMfaChallenge(deps, body.challenge, body.code);
    setCookie(c, SESSION, result.token, cookieOptions(60 * 60 * 24 * 30));
    audit(c, { category: "auth", action: "auth.mfa", outcome: "success", actor: `user:${String(result.user.id)}` });
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
    const body = await readJson(c, tenantSwitchSchema);
    await switchTenant(deps, token, actor.userId, body.tenantId);
    const user = c.get("user");
    if (!user) throw new HttpError(401, "unauthorized", "Sign in");
    return c.json(await getMe(deps, user, body.tenantId));
  });

  app.post("/tenants", async (c) => {
    const { user } = await signedIn(c);
    const token = getCookie(c, SESSION);
    if (!token) throw new HttpError(401, "unauthorized", "Sign in");
    await createTenant(deps, String(user.id), asBody(await readJson(c, tenantSchema)), token);
    const sessions = await deps.db.query<Row>("SELECT active_tenant_id FROM sessions WHERE token_hash = $1", [sha256(token)]);
    return c.json(await getMe(deps, user, sessions[0] ? String(sessions[0].active_tenant_id) : null), 201);
  });

  app.get("/me", async (c) => {
    const { user, session } = await signedIn(c);
    return c.json(await getMe(deps, user, session.active_tenant_id ? String(session.active_tenant_id) : null));
  });

  app.post("/me/mfa/enroll", async (c) => {
    const { user } = await signedIn(c);
    await readJson(c, emptySchema);
    return c.json(await beginMfaEnrollment(deps, user));
  });

  app.post("/me/mfa/confirm", async (c) => {
    const { user, session } = await signedIn(c);
    const body = await readJson(c, mfaConfirmSchema);
    const tenantId = session.active_tenant_id ? String(session.active_tenant_id) : null;
    return c.json(await confirmMfaEnrollment(deps, user, tenantId, body.code));
  });

  app.patch("/me", async (c) => {
    const actor = await member(c);
    await updateProfile(deps, actor.userId, asBody(await readJson(c, profileSchema)));
    const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [actor.userId]);
    return c.json(await getMe(deps, users[0], actor.tenantId));
  });

  app.patch("/me/preferences", async (c) => {
    const actor = await member(c);
    return c.json(await savePreferences(deps, actor.userId, actor.tenantId, asBody(await readJson(c, preferencesSchema))));
  });

  app.post("/me/transfer-plan", async (c) => {
    const current = c.get("user");
    if (!current) throw new HttpError(401, "unauthorized", "Sign in");
    const body = await readJson(c, planSchema);
    await setTransferPlan(deps, current, body.plan === "paid" ? "paid" : "free");
    const users = await deps.db.query<Row>("SELECT * FROM users WHERE id = $1", [String(current.id)]);
    const session = c.get("session");
    return c.json(await getMe(deps, users[0], session?.active_tenant_id ? String(session.active_tenant_id) : null));
  });

  app.get("/admin/users", async (c) => c.json(await listTeamUsers(deps, await member(c))));

  app.post("/admin/users", async (c) => {
    const actor = await member(c);
    const created = await createTeamUser(deps, actor, asBody(await readJson(c, teamUserSchema)));
    audit(c, { category: "admin", action: "admin.user.create", outcome: "success", actor: `user:${actor.userId}` });
    return c.json(created, 201);
  });

  app.post("/admin/users/:id/disable", async (c) => {
    const actor = await member(c);
    const disabled = await disableTeamUser(deps, actor, c.req.param("id"));
    audit(c, { category: "admin", action: "admin.user.disable", outcome: "success", actor: `user:${actor.userId}` });
    return c.json(disabled);
  });

  app.delete("/admin/users/:id", async (c) => {
    const actor = await member(c);
    await deleteTeamUser(deps, actor, c.req.param("id"));
    audit(c, { category: "admin", action: "admin.user.delete", outcome: "success", actor: `user:${actor.userId}` });
    return c.body(null, 204);
  });

  app.post("/admin/users/:id/keys", async (c) => {
    const actor = await member(c);
    const issued = await issueApiKey(deps, actor, c.req.param("id"), asBody(await readJson(c, apiKeySchema)));
    audit(c, { category: "config", action: "api_key.issue", outcome: "success", actor: `user:${actor.userId}` });
    return c.json(issued, 201);
  });

  app.get("/admin/retention", async (c) => c.json(await readRetention(deps, await member(c))));

  app.patch("/admin/retention", async (c) => {
    const actor = await member(c);
    const saved = await updateRetention(deps, actor, asBody(await readJson(c, retentionSchema)));
    audit(c, { category: "config", action: "retention.update", outcome: "success", actor: `user:${actor.userId}` });
    return c.json(saved);
  });

  app.get("/audit", async (c) => c.json(await listAudit(deps, await member(c))));

  app.patch("/transfer-settings", async (c) => {
    const actor = await member(c);
    const saved = await updateTransferSettings(deps, actor, asBody(await readJson(c, transferSettingsSchema)));
    audit(c, { category: "config", action: "transfer_settings.update", outcome: "success", actor: `user:${actor.userId}` });
    return c.json(saved);
  });

  app.get("/projects", async (c) => c.json(await listProjects(deps, await member(c))));

  app.post("/projects", async (c) => c.json(await createProject(deps, await member(c), asBody(await readJson(c, projectSchema))), 201));

  app.patch("/projects/:id", async (c) => c.json(await updateProject(deps, await member(c), c.req.param("id"), asBody(await readJson(c, projectSchema)))));

  app.delete("/projects/:id", async (c) => {
    await deleteProject(deps, await member(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/projects/:id/members", async (c) => c.json(await listMembers(deps, await member(c), c.req.param("id"))));

  app.post("/projects/:id/members", async (c) => c.json(await addMember(deps, await member(c), c.req.param("id"), asBody(await readJson(c, memberSchema))), 201));

  app.delete("/projects/:id/members/:userId", async (c) => {
    await removeMember(deps, await member(c), c.req.param("id"), c.req.param("userId"));
    return c.body(null, 204);
  });

  app.get("/projects/:id/drawers", async (c) => c.json(await listDrawers(deps, await member(c), c.req.param("id"))));

  app.post("/projects/:id/drawers/test", async (c) => c.json(await testUnsavedDrawer(deps, await member(c), c.req.param("id"), asBody(await readJson(c, drawerSchema)))));

  app.post("/projects/:id/drawers", async (c) => {
    const actor = await member(c);
    const body = await readJson(c, drawerSchema);
    const created = await createDrawer(deps, actor, c.req.param("id"), asBody(body));
    if (body.secretKey || body.secretAccessKey || body.accessKey || body.accessKeyId) {
      audit(c, { category: "config", action: "drawer.credentials", outcome: "success", actor: `user:${actor.userId}` });
    }
    return c.json(created, 201);
  });

  app.get("/projects/:id/search", async (c) => c.json(await searchProject(deps, await member(c), c.req.param("id"), c.req.query("q") ?? "")));
  app.get("/projects/:id/search/semantic", async (c) =>
    c.json(await semanticSearch(deps, await member(c), c.req.param("id"), c.req.query("q") ?? "")),
  );
  app.post("/projects/:id/ask", async (c) => c.json(await answerQuestion(deps, await member(c), c.req.param("id"), asBody(await readJson(c, askSchema)))));

  app.post("/drawers/:id/test", async (c) => c.json(await testDrawer(deps, await member(c), c.req.param("id"))));

  app.patch("/drawers/:id", async (c) => {
    const actor = await member(c);
    const body = await readJson(c, drawerSchema);
    const updated = await updateDrawer(deps, actor, c.req.param("id"), asBody(body));
    if (body.secretKey || body.secretAccessKey || body.accessKey || body.accessKeyId || body.endpoint) {
      audit(c, { category: "config", action: "drawer.credentials", outcome: "success", actor: `user:${actor.userId}` });
    }
    return c.json(updated);
  });

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

  app.post("/drawers/:id/folders", async (c) => c.json(await createFolder(deps, await member(c), c.req.param("id"), asBody(await readJson(c, folderSchema))), 201));

  app.post("/drawers/:id/uploads", async (c) => c.json(await startUpload(deps, await member(c), c.req.param("id"), asBody(await readJson(c, uploadSchema))), 201));

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
    return c.json(await completeUpload(deps, actor, c.req.param("id"), asBody(await readJson(c, completeUploadSchema))));
  });

  app.post("/nodes/reorder", async (c) => c.json(await reorderNodes(deps, await member(c), asBody(await readJson(c, reorderSchema)))));

  app.post("/nodes/move", async (c) => c.json(await moveNodes(deps, await member(c), asBody(await readJson(c, moveSchema)))));

  app.post("/nodes/copy", async (c) => c.json(await copyNodes(deps, await member(c), asBody(await readJson(c, copySchema))), 202));

  app.post("/nodes/delete", async (c) => c.json(await deleteNodes(deps, await member(c), asBody(await readJson(c, deleteSchema)))));

  app.patch("/nodes/:id", async (c) => c.json(await patchNode(deps, await member(c), c.req.param("id"), asBody(await readJson(c, patchNodeSchema)))));

  app.get("/nodes/:id/content", async (c) => sendContent(c, await member(c), c.req.param("id")));

  app.get("/nodes/:id/versions", async (c) => c.json(await listFileVersions(deps, await member(c), c.req.param("id"))));

  app.get("/nodes/:id/versions/:version/content", async (c) => {
    const opened = await openFileVersion(deps, await member(c), c.req.param("id"), Number(c.req.param("version")));
    return new Response(opened.stream, {
      status: 200,
      headers: {
        "content-type": opened.contentType,
        "content-disposition": contentDisposition("attachment", opened.name),
        "content-length": String(opened.size),
        "cache-control": "private",
      },
    });
  });

  app.post("/nodes/:id/versions/:version/restore", async (c) =>
    c.json(await restoreFileVersion(deps, await member(c), c.req.param("id"), Number(c.req.param("version")))),
  );

  app.get("/nodes/:id/grants", async (c) => c.json(await listGrants(deps, await member(c), c.req.param("id"))));

  app.post("/nodes/:id/grants", async (c) => c.json(await createGrant(deps, await member(c), c.req.param("id"), asBody(await readJson(c, grantSchema))), 201));

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

  app.post("/files/:id/publication", async (c) => c.json(await publishFile(deps, await member(c), c.req.param("id"), asBody(await readJson(c, publishSchema))), 201));

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
    const publicId = c.req.param("publicId");
    const limited = enforce(c, "transfer.ticket", deps.config.rateLimit.ticketIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const account = enforce(c, "transfer.ticket", deps.config.rateLimit.ticketAccount, `acct:${accountBucket(publicId)}`);
    if (account) return account;
    await readJson(c, emptySchema);
    const user = c.get("user");
    const plan = user && String(user.transfer_plan) === "paid" ? "paid" : "free";
    return c.json(await createTicket(deps, publicId, ensureVisitor(c), plan, user ? String(user.id) : null), 201);
  });

  app.post("/publications/:publicId/abuse", async (c) => {
    const publicId = c.req.param("publicId");
    const limited = enforce(c, "transfer.abuse", deps.config.rateLimit.abuseIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const account = enforce(c, "transfer.abuse", deps.config.rateLimit.abuseAccount, `acct:${accountBucket(publicId)}`);
    if (account) return account;
    const body = await readJson(c, abuseSchema);
    const note = (body.note ?? "").trim();
    if (!note) throw new HttpError(400, "invalid", "note is required");
    await reportAbuse(deps, publicId, note);
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
    const slug = c.req.param("slug");
    const limited = enforce(c, "auth.portal", deps.config.rateLimit.portalIp, `ip:${c.get("clientIp")}`);
    if (limited) return limited;
    const account = enforce(c, "auth.portal", deps.config.rateLimit.portalAccount, `acct:${accountBucket(slug)}`);
    if (account) return account;
    const opened = await openPortal(deps, slug, asBody(await readJson(c, portalSessionSchema)));
    setCookie(c, PORTAL, opened.token, cookieOptions(60 * 60 * 24 * 14));
    audit(c, { category: "auth", action: "auth.portal", outcome: "success", actor: null });
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
    const body = await readJson(c, folderSchema);
    return c.json(await createFolder(deps, guest(c), body.drawerId ?? "", asBody(body)), 201);
  });

  app.post("/portal/:slug/uploads", async (c) => {
    const body = await readJson(c, uploadSchema);
    return c.json(await startUpload(deps, guest(c), body.drawerId ?? "", asBody(body)), 201);
  });

  app.post("/portal/:slug/nodes/move", async (c) => c.json(await moveNodes(deps, guest(c), asBody(await readJson(c, moveSchema)))));

  app.post("/portal/:slug/nodes/delete", async (c) => c.json(await deleteNodes(deps, guest(c), asBody(await readJson(c, deleteSchema)))));

  app.patch("/portal/:slug/nodes/:id", async (c) => c.json(await patchNode(deps, guest(c), c.req.param("id"), asBody(await readJson(c, patchNodeSchema)))));

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
