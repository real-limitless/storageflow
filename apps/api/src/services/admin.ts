import crypto from "node:crypto";
import type { AuditEvent, GrantVerb, IssuedApiKey, TeamUser } from "@storageflow/domain";
import { MEMBER_ROLES, normalizeScopes } from "@storageflow/domain";
import { hashPassword, secretToken, sha256 } from "../crypto.js";
import { HttpError } from "../http.js";
import { mapAudit, mapTeamUser, type Row } from "../mappers.js";
import { recordAudit, type Deps, type MemberActor } from "./access.js";

function requireOwner(actor: MemberActor): void {
  if (actor.scopes) throw new HttpError(403, "forbidden", "API keys cannot administer the team");
  if (actor.tenantRole !== "owner") throw new HttpError(403, "forbidden", "Only an owner can do that");
}

async function teamUser(deps: Deps, tenantId: string, userId: string): Promise<Row> {
  const rows = await deps.db.query<Row>(
    `SELECT u.*, m.role
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE u.id = $1 AND m.tenant_id = $2`,
    [userId, tenantId],
  );
  if (!rows[0]) throw new HttpError(404, "not_found", "User not found");
  return rows[0];
}

export async function createTeamUser(deps: Deps, actor: MemberActor, body: Record<string, unknown>): Promise<TeamUser> {
  requireOwner(actor);
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const kind = body.kind === "service" ? "service" : body.kind == null || body.kind === "user" ? "user" : "";
  const role = body.role == null ? "member" : String(body.role);
  if (!email.includes("@") || !name) throw new HttpError(400, "invalid", "Email and name are required");
  if (!kind) throw new HttpError(400, "invalid", "kind must be user or service");
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) throw new HttpError(400, "invalid", "role must be owner or member");
  const password = body.password == null ? "" : String(body.password);
  if (kind === "service") {
    if (password) throw new HttpError(400, "invalid", "Service accounts have no password");
  } else if (password.length < 8) {
    throw new HttpError(400, "invalid", "A password of 8 characters is required");
  }
  const existing = await deps.db.query<Row>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing[0]) throw new HttpError(409, "conflict", "An account with that email already exists");
  const id = crypto.randomUUID();
  const now = deps.now().toISOString();
  const passwordHash = kind === "user" ? hashPassword(password, deps.config.scryptN) : null;
  await deps.db.query(
    `INSERT INTO users (id, email, name, password_hash, transfer_plan, kind, created_at) VALUES ($1,$2,$3,$4,'free',$5,$6)`,
    [id, email, name, passwordHash, kind, now],
  );
  await deps.db.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [actor.tenantId, id, role]);
  await recordAudit(deps, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "user.create",
    targetType: "user",
    targetId: id,
    detail: { email, kind, role },
  });
  return mapTeamUser(await teamUser(deps, actor.tenantId, id));
}

export async function disableTeamUser(deps: Deps, actor: MemberActor, userId: string): Promise<TeamUser> {
  requireOwner(actor);
  if (userId === actor.userId) throw new HttpError(400, "invalid", "You cannot disable yourself");
  const user = await teamUser(deps, actor.tenantId, userId);
  const now = deps.now().toISOString();
  await deps.db.query(`UPDATE users SET disabled_at = $2 WHERE id = $1 AND disabled_at IS NULL`, [userId, now]);
  await deps.db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await recordAudit(deps, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "user.disable",
    targetType: "user",
    targetId: userId,
    detail: { email: String(user.email) },
  });
  return mapTeamUser(await teamUser(deps, actor.tenantId, userId));
}

export async function deleteTeamUser(deps: Deps, actor: MemberActor, userId: string): Promise<void> {
  requireOwner(actor);
  if (userId === actor.userId) throw new HttpError(400, "invalid", "You cannot delete yourself");
  const user = await teamUser(deps, actor.tenantId, userId);
  if (String(user.role) === "owner") {
    const owners = await deps.db.query<Row>(`SELECT user_id FROM memberships WHERE tenant_id = $1 AND role = 'owner'`, [actor.tenantId]);
    if (owners.length <= 1) throw new HttpError(409, "conflict", "The team needs an owner");
  }
  await recordAudit(deps, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "user.delete",
    targetType: "user",
    targetId: userId,
    detail: { email: String(user.email), kind: String(user.kind) },
  });
  await deps.db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function issueApiKey(deps: Deps, actor: MemberActor, userId: string, body: Record<string, unknown>): Promise<IssuedApiKey> {
  requireOwner(actor);
  const user = await teamUser(deps, actor.tenantId, userId);
  if (String(user.kind) !== "service") throw new HttpError(400, "invalid", "API keys belong to service accounts");
  if (user.disabled_at) throw new HttpError(409, "conflict", "This account is disabled");
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "invalid", "name is required");
  const rawScopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
  const scopes = normalizeScopes(rawScopes);
  if (!scopes) throw new HttpError(400, "invalid", "scopes must be grant verbs");
  let expiresAt: string | null = null;
  if (body.expiresAt != null && body.expiresAt !== "") {
    const parsed = new Date(String(body.expiresAt));
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "invalid", "expiresAt is not a time");
    if (parsed.getTime() <= deps.now().getTime()) throw new HttpError(400, "invalid", "expiresAt is in the past");
    expiresAt = parsed.toISOString();
  }
  const token = `sfk_${secretToken()}`;
  const id = crypto.randomUUID();
  const now = deps.now().toISOString();
  await deps.db.query(
    `INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash, key_prefix, scopes, expires_at, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
    [id, actor.tenantId, userId, name, sha256(token), token.slice(0, 12), JSON.stringify(scopes), expiresAt, actor.userId, now],
  );
  await recordAudit(deps, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "api_key.issue",
    targetType: "api_key",
    targetId: id,
    detail: { userId, name, prefix: token.slice(0, 12), scopes },
  });
  return {
    id,
    userId,
    name,
    prefix: token.slice(0, 12),
    scopes: scopes as GrantVerb[],
    expiresAt,
    createdAt: now,
    token,
  };
}

export async function listAudit(deps: Deps, actor: MemberActor): Promise<AuditEvent[]> {
  requireOwner(actor);
  const rows = await deps.db.query<Row>(`SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`, [actor.tenantId]);
  return rows.map(mapAudit);
}

export async function readRetention(deps: Deps, actor: MemberActor): Promise<{ count: number }> {
  requireOwner(actor);
  const rows = await deps.db.query<Row>(`SELECT version_retention FROM tenants WHERE id = $1`, [actor.tenantId]);
  return { count: Number(rows[0]?.version_retention ?? 10) };
}

export async function updateRetention(deps: Deps, actor: MemberActor, body: Record<string, unknown>): Promise<{ count: number }> {
  requireOwner(actor);
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new HttpError(400, "invalid", "count is a whole number from 1 to 1000");
  }
  await deps.db.query(`UPDATE tenants SET version_retention = $2 WHERE id = $1`, [actor.tenantId, count]);
  return { count };
}
