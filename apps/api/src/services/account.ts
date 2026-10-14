import crypto from "node:crypto";
import { DEFAULT_TRANSFER_SETTINGS, type Me, type Membership, type Preferences, type ProjectMember, type TransferPlan } from "@storageflow/domain";
import { hashPassword, secretToken, sha256, slugify, verifyPassword } from "../crypto.js";
import { HttpError, asBool, asNumber } from "../http.js";
import { defaultPreferences, mapMember, mapPreferences, mapSettings, type Row } from "../mappers.js";
import { membershipRole, recordActivity, recordAudit, requireProject, type Deps, type MemberActor } from "./access.js";

export async function insertTransferSettings(deps: Deps, tenantId: string): Promise<void> {
  const settings = DEFAULT_TRANSFER_SETTINGS;
  await deps.db.query(
    `INSERT INTO transfer_settings (
      tenant_id, free_wait_seconds, free_bytes_per_second, free_daily_bytes, free_cooldown_seconds,
      paid_bytes_per_second, paid_daily_bytes, ticket_ttl_seconds
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      settings.freeWaitSeconds,
      settings.freeBytesPerSecond,
      settings.freeDailyBytes,
      settings.freeCooldownSeconds,
      settings.paidBytesPerSecond,
      settings.paidDailyBytes,
      settings.ticketTtlSeconds,
    ],
  );
}

export async function createSession(
  deps: Deps,
  input: {
    userId: string | null;
    tenantId: string | null;
    kind: "member" | "guest" | "transfer";
    portalId?: string | null;
    guestEmail?: string | null;
    linkGrantId?: string | null;
  },
): Promise<string> {
  const token = secretToken();
  const now = deps.now();
  await deps.db.query(
    `INSERT INTO sessions (id, user_id, token_hash, active_tenant_id, kind, portal_id, guest_email, link_grant_id, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      crypto.randomUUID(),
      input.userId,
      sha256(token),
      input.tenantId,
      input.kind,
      input.portalId ?? null,
      input.guestEmail ?? null,
      input.linkGrantId ?? null,
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      now.toISOString(),
    ],
  );
  return token;
}

async function membershipsOf(deps: Deps, userId: string): Promise<Membership[]> {
  const rows = await deps.db.query<Row>(
    `SELECT m.role, t.id AS tenant_id, t.slug, t.name
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 ORDER BY t.name`,
    [userId],
  );
  return rows.map((row) => ({
    tenantId: String(row.tenant_id),
    tenantSlug: String(row.slug),
    tenantName: String(row.name),
    role: String(row.role) as Membership["role"],
  }));
}

async function usage(deps: Deps, tenantId: string, mode: "hosted" | "linked"): Promise<number> {
  const rows = await deps.db.query<Row>(
    `SELECT COALESCE(SUM(n.size), 0) AS bytes
     FROM nodes n JOIN drawers d ON d.id = n.drawer_id
     WHERE d.tenant_id = $1 AND d.mode = $2 AND n.kind = 'file'`,
    [tenantId, mode],
  );
  return asNumber(rows[0]?.bytes) ?? 0;
}

export async function getMe(deps: Deps, user: Row, tenantId: string | null): Promise<Me> {
  const memberships = await membershipsOf(deps, String(user.id));
  const active = tenantId ? memberships.find((item) => item.tenantId === tenantId) ?? null : null;
  const preferencesRow = active
    ? await deps.db.query<Row>(`SELECT * FROM preferences WHERE user_id = $1 AND tenant_id = $2`, [String(user.id), active.tenantId])
    : [];
  const settingsRow = active ? await deps.db.query<Row>(`SELECT * FROM transfer_settings WHERE tenant_id = $1`, [active.tenantId]) : [];
  const canSetPlan = deps.config.allowPlanFlag || deps.config.adminEmails.includes(String(user.email).toLowerCase());
  return {
    user: {
      id: String(user.id),
      email: String(user.email),
      name: String(user.name),
      transferPlan: String(user.transfer_plan) as TransferPlan,
      mfaEnabled: asBool(user.mfa_enabled),
    },
    memberships,
    activeTenant: active ? { id: active.tenantId, slug: active.tenantSlug, name: active.tenantName, role: active.role } : null,
    preferences: mapPreferences(preferencesRow[0]),
    hostedUsageBytes: active ? await usage(deps, active.tenantId, "hosted") : 0,
    hostedQuotaBytes: deps.config.hostedQuotaBytes,
    linkedUsageBytes: active ? await usage(deps, active.tenantId, "linked") : 0,
    canSetPlan,
    transferSettings: settingsRow[0] && active?.role === "owner" ? mapSettings(settingsRow[0]) : null,
  };
}

export async function signUp(deps: Deps, body: Record<string, unknown>): Promise<Row> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? email.split("@")[0] ?? "").trim();
  if (!email.includes("@") || password.length < 8 || !name) throw new HttpError(400, "invalid", "Email, name, and a password of 8 characters are required");
  const existing = await deps.db.query<Row>(`SELECT * FROM users WHERE email = $1`, [email]);
  if (existing[0]?.password_hash) throw new HttpError(409, "conflict", "An account with that email already exists");
  const hash = hashPassword(password, deps.config.scryptN);
  if (existing[0]) {
    await deps.db.query(`UPDATE users SET password_hash = $2, name = $3 WHERE id = $1`, [String(existing[0].id), hash, name]);
    const rows = await deps.db.query<Row>(`SELECT * FROM users WHERE id = $1`, [String(existing[0].id)]);
    return rows[0];
  }
  const id = crypto.randomUUID();
  await deps.db.query(`INSERT INTO users (id, email, name, password_hash, transfer_plan, created_at) VALUES ($1,$2,$3,$4,'free',$5)`, [
    id,
    email,
    name,
    hash,
    deps.now().toISOString(),
  ]);
  const rows = await deps.db.query<Row>(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0];
}

export function accountCanUsePassword(user: Row): void {
  if (String(user.kind) === "service") {
    throw new HttpError(401, "unauthorized", "Service accounts sign in with an API key");
  }
  if (user.disabled_at) throw new HttpError(403, "disabled", "This account is disabled");
}

export type PasswordSignIn =
  | { mfaRequired: true; challenge: string }
  | { mfaRequired: false; token: string; user: Row; tenantId: string | null };

const MFA_CHALLENGE_MS = 5 * 60 * 1000;

async function issueMfaChallenge(deps: Deps, userId: string): Promise<string> {
  const token = secretToken();
  const now = deps.now();
  await deps.db.query(`INSERT INTO mfa_challenges (token_hash, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)`, [
    sha256(token),
    userId,
    new Date(now.getTime() + MFA_CHALLENGE_MS).toISOString(),
    now.toISOString(),
  ]);
  return token;
}

async function finishSignIn(deps: Deps, user: Row, method: "password" | "magic"): Promise<PasswordSignIn> {
  if (asBool(user.mfa_enabled)) {
    return { mfaRequired: true, challenge: await issueMfaChallenge(deps, String(user.id)) };
  }
  const memberships = await membershipsOf(deps, String(user.id));
  const tenantId = memberships[0]?.tenantId ?? null;
  const token = await createSession(deps, { userId: String(user.id), tenantId, kind: "member" });
  if (tenantId) {
    if (method === "password") {
      await recordActivity(deps, { tenantId, actorUserId: String(user.id), actorEmail: String(user.email), kind: "sign-in", detail: {} });
    }
    await recordAudit(deps, {
      tenantId,
      actorUserId: String(user.id),
      action: "sign-in",
      targetType: "user",
      targetId: String(user.id),
      detail: { method },
    });
  }
  return { mfaRequired: false, token, user, tenantId };
}

export async function signIn(deps: Deps, email: string, password: string): Promise<PasswordSignIn> {
  const rows = await deps.db.query<Row>(`SELECT * FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user) throw new HttpError(401, "unauthorized", "Email or password is wrong");
  accountCanUsePassword(user);
  if (!user.password_hash || !verifyPassword(password, String(user.password_hash))) {
    throw new HttpError(401, "unauthorized", "Email or password is wrong");
  }
  return finishSignIn(deps, user, "password");
}

export async function startMagicLink(deps: Deps, email: string): Promise<{ sent: true; devToken?: string }> {
  const normalized = email.trim().toLowerCase();
  const users = await deps.db.query<Row>(`SELECT id, kind, disabled_at FROM users WHERE email = $1`, [normalized]);
  const token = secretToken();
  if (users[0] && String(users[0].kind) !== "service" && !users[0].disabled_at) {
    await deps.db.query(`INSERT INTO magic_links (token_hash, email, expires_at, created_at) VALUES ($1,$2,$3,$4)`, [
      sha256(token),
      normalized,
      new Date(deps.now().getTime() + 15 * 60 * 1000).toISOString(),
      deps.now().toISOString(),
    ]);
  }
  return deps.config.exposeMagicLink && users[0] ? { sent: true, devToken: token } : { sent: true };
}

export async function consumeMagicLink(deps: Deps, token: string): Promise<PasswordSignIn> {
  const rows = await deps.db.query<Row>(`SELECT * FROM magic_links WHERE token_hash = $1`, [sha256(token)]);
  const link = rows[0];
  if (!link || new Date(String(link.expires_at)).getTime() <= deps.now().getTime()) throw new HttpError(401, "unauthorized", "This link is not valid");
  await deps.db.query(`DELETE FROM magic_links WHERE token_hash = $1`, [sha256(token)]);
  const users = await deps.db.query<Row>(`SELECT * FROM users WHERE email = $1`, [String(link.email)]);
  if (!users[0]) throw new HttpError(401, "unauthorized", "This link is not valid");
  accountCanUsePassword(users[0]);
  return finishSignIn(deps, users[0], "magic");
}

export async function signOut(deps: Deps, token: string | null): Promise<void> {
  if (!token) return;
  await deps.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function signOutAll(deps: Deps, userId: string): Promise<void> {
  await deps.db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function switchTenant(deps: Deps, token: string, userId: string, tenantId: string): Promise<void> {
  const role = await membershipRole(deps.db, tenantId, userId);
  if (!role) throw new HttpError(403, "forbidden", "You are not in that workspace");
  await deps.db.query(`UPDATE sessions SET active_tenant_id = $2 WHERE token_hash = $1`, [sha256(token), tenantId]);
}

export async function updateProfile(deps: Deps, userId: string, body: Record<string, unknown>): Promise<void> {
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw new HttpError(400, "invalid", "name is required");
    await deps.db.query(`UPDATE users SET name = $2 WHERE id = $1`, [userId, name]);
  }
}

export async function setTransferPlan(deps: Deps, user: Row, plan: TransferPlan): Promise<void> {
  const allowed = deps.config.allowPlanFlag || deps.config.adminEmails.includes(String(user.email).toLowerCase());
  if (!allowed) throw new HttpError(403, "forbidden", "The transfer plan is set by an admin flag");
  if (plan !== "free" && plan !== "paid") throw new HttpError(400, "invalid", "Unknown plan");
  await deps.db.query(`UPDATE users SET transfer_plan = $2 WHERE id = $1`, [String(user.id), plan]);
}

export async function savePreferences(deps: Deps, userId: string, tenantId: string, body: Record<string, unknown>): Promise<Preferences> {
  const currentRows = await deps.db.query<Row>(`SELECT * FROM preferences WHERE user_id = $1 AND tenant_id = $2`, [userId, tenantId]);
  const current = mapPreferences(currentRows[0]);
  const pane = body.paneSizes && typeof body.paneSizes === "object" ? (body.paneSizes as Record<string, unknown>) : null;
  const next: Preferences = {
    paneSizes: pane
      ? {
          drawers: Number(pane.drawers ?? current.paneSizes.drawers),
          folders: Number(pane.folders ?? current.paneSizes.folders),
          files: Number(pane.files ?? current.paneSizes.files),
        }
      : current.paneSizes,
    viewMode: body.viewMode === "list" || body.viewMode === "details" || body.viewMode === "grid" ? body.viewMode : current.viewMode,
    zoom: body.zoom != null ? Math.min(4, Math.max(1, Number(body.zoom))) : current.zoom,
    lastProjectId: body.lastProjectId !== undefined ? (body.lastProjectId ? String(body.lastProjectId) : null) : current.lastProjectId,
    defaultProjectId: body.defaultProjectId !== undefined ? (body.defaultProjectId ? String(body.defaultProjectId) : null) : current.defaultProjectId,
    locationTabs: Array.isArray(body.locationTabs) ? (body.locationTabs as Preferences["locationTabs"]) : current.locationTabs,
    favoritesOnly: body.favoritesOnly !== undefined ? Boolean(body.favoritesOnly) : current.favoritesOnly,
    starredFirst: body.starredFirst !== undefined ? Boolean(body.starredFirst) : current.starredFirst,
  };
  await deps.db.query(
    `INSERT INTO preferences (user_id, tenant_id, pane_sizes, view_mode, zoom, last_project_id, default_project_id, location_tabs, favorites_only, starred_first)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET
       pane_sizes = EXCLUDED.pane_sizes,
       view_mode = EXCLUDED.view_mode,
       zoom = EXCLUDED.zoom,
       last_project_id = EXCLUDED.last_project_id,
       default_project_id = EXCLUDED.default_project_id,
       location_tabs = EXCLUDED.location_tabs,
       favorites_only = EXCLUDED.favorites_only,
       starred_first = EXCLUDED.starred_first`,
    [
      userId,
      tenantId,
      JSON.stringify(next.paneSizes),
      next.viewMode,
      next.zoom,
      next.lastProjectId,
      next.defaultProjectId,
      JSON.stringify(next.locationTabs),
      next.favoritesOnly,
      next.starredFirst,
    ],
  );
  return next;
}

export async function createTenant(deps: Deps, userId: string, body: Record<string, unknown>, sessionToken: string): Promise<void> {
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "invalid", "name is required");
  const slug = slugify(String(body.slug ?? name));
  const id = crypto.randomUUID();
  try {
    await deps.db.query(`INSERT INTO tenants (id, slug, name, created_at) VALUES ($1,$2,$3,$4)`, [id, slug, name, deps.now().toISOString()]);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      throw new HttpError(409, "conflict", "That workspace address is taken");
    }
    throw error;
  }
  await deps.db.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [id, userId]);
  await insertTransferSettings(deps, id);
  await deps.db.query(`UPDATE sessions SET active_tenant_id = $2 WHERE token_hash = $1`, [sha256(sessionToken), id]);
}

export async function listMembers(deps: Deps, actor: MemberActor, projectId: string): Promise<ProjectMember[]> {
  await requireProject(deps, actor, projectId);
  const rows = await deps.db.query<Row>(
    `SELECT pm.user_id, pm.role, u.email, u.name
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 ORDER BY u.email`,
    [projectId],
  );
  return rows.map(mapMember);
}

export async function addMember(deps: Deps, actor: MemberActor, projectId: string, body: Record<string, unknown>): Promise<ProjectMember> {
  const role = await (await import("./access.js")).projectRoleFor(deps, actor, projectId);
  if (role !== "owner") throw new HttpError(403, "forbidden", "Only an owner can invite members");
  const email = String(body.email ?? "").trim().toLowerCase();
  const memberRole = body.role === "owner" ? "owner" : "member";
  if (!email.includes("@")) throw new HttpError(400, "invalid", "email is required");
  let users = await deps.db.query<Row>(`SELECT * FROM users WHERE email = $1`, [email]);
  if (!users[0]) {
    const id = crypto.randomUUID();
    await deps.db.query(`INSERT INTO users (id, email, name, transfer_plan, created_at) VALUES ($1,$2,$3,'free',$4)`, [
      id,
      email,
      email.split("@")[0],
      deps.now().toISOString(),
    ]);
    users = await deps.db.query<Row>(`SELECT * FROM users WHERE id = $1`, [id]);
  }
  const userId = String(users[0].id);
  await deps.db.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [actor.tenantId, userId],
  );
  await deps.db.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, memberRole],
  );
  return { userId, email, name: String(users[0].name), role: memberRole };
}

export async function removeMember(deps: Deps, actor: MemberActor, projectId: string, userId: string): Promise<void> {
  const role = await (await import("./access.js")).projectRoleFor(deps, actor, projectId);
  if (role !== "owner") throw new HttpError(403, "forbidden", "Only an owner can remove members");
  await deps.db.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
}

export async function seedOwner(deps: Deps): Promise<void> {
  if (!deps.config.seedEmail || !deps.config.seedPassword) return;
  const existing = await deps.db.query(`SELECT id FROM users WHERE email = $1`, [deps.config.seedEmail.toLowerCase()]);
  if (existing.length) return;
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = deps.now().toISOString();
  await deps.db.query(`INSERT INTO tenants (id, slug, name, created_at) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    deps.config.tenantSlug,
    deps.config.tenantName,
    now,
  ]);
  await deps.db.query(`INSERT INTO users (id, email, name, password_hash, transfer_plan, created_at) VALUES ($1,$2,$3,$4,'free',$5)`, [
    userId,
    deps.config.seedEmail.toLowerCase(),
    deps.config.seedName,
    hashPassword(deps.config.seedPassword, deps.config.scryptN),
    now,
  ]);
  await deps.db.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [tenantId, userId]);
  await insertTransferSettings(deps, tenantId);
}

export function emptyPreferences(): Preferences {
  return defaultPreferences();
}
