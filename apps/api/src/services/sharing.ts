import crypto from "node:crypto";
import { GRANT_VERBS, isDropFolder, type GrantVerb, type GrantView, type PortalRoot } from "@storageflow/domain";
import { decryptString, encryptString, hashPassword, publicId, secretToken, sha256, slugify, verifyPassword } from "../crypto.js";
import { HttpError, asBool, asIso, asNumber } from "../http.js";
import { mapNode, verbsFromRow, type Row } from "../mappers.js";
import { guestGrants, loadNodeRow, recordActivity, requireProject, type Deps, type GuestActor, type MemberActor } from "./access.js";

function verbsOf(body: Record<string, unknown>): GrantVerb[] {
  const raw = Array.isArray(body.verbs) ? body.verbs : [];
  const verbs = raw.filter((verb): verb is GrantVerb => typeof verb === "string" && (GRANT_VERBS as readonly string[]).includes(verb));
  if (verbs.length === 0) throw new HttpError(400, "invalid", "Choose what they can do");
  return verbs;
}

async function ensurePortal(deps: Deps, projectId: string, tenantId: string, projectName: string): Promise<Row> {
  const existing = await deps.db.query<Row>(`SELECT * FROM portals WHERE project_id = $1 ORDER BY created_at ASC LIMIT 1`, [projectId]);
  if (existing[0]) return existing[0];
  const id = crypto.randomUUID();
  let slug = slugify(projectName);
  const clash = await deps.db.query(`SELECT id FROM portals WHERE slug = $1`, [slug]);
  if (clash.length) slug = `${slug}-${publicId().slice(0, 4)}`;
  const now = deps.now().toISOString();
  await deps.db.query(`INSERT INTO portals (id, tenant_id, project_id, slug, name, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [
    id,
    tenantId,
    projectId,
    slug,
    projectName,
    now,
  ]);
  const rows = await deps.db.query<Row>(`SELECT * FROM portals WHERE id = $1`, [id]);
  return rows[0];
}

function grantView(deps: Deps, row: Row, slug: string | null): GrantView {
  let link: string | null = null;
  if (row.token_cipher && slug) {
    try {
      const token = decryptString(deps.config.encryptionKey, String(row.token_cipher));
      link = `${deps.config.publicOrigin}/portal/${slug}?token=${encodeURIComponent(token)}`;
    } catch {
      link = null;
    }
  }
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    portalId: row.portal_id ? String(row.portal_id) : null,
    portalSlug: slug,
    granteeEmail: row.grantee_email ? String(row.grantee_email) : null,
    granteeUserId: row.grantee_user_id ? String(row.grantee_user_id) : null,
    anyoneWithLink: asBool(row.anyone_with_link),
    verbs: verbsFromRow(row),
    expiresAt: asIso(row.expires_at),
    downloadCap: asNumber(row.download_cap),
    downloadCount: asNumber(row.download_count) ?? 0,
    hasPassword: Boolean(row.password_hash),
    link,
    createdAt: asIso(row.created_at) ?? deps.now().toISOString(),
  };
}

export async function listGrants(deps: Deps, actor: MemberActor, nodeId: string): Promise<GrantView[]> {
  const node = await loadNodeRow(deps, actor.tenantId, nodeId);
  const drawer = await deps.db.query<Row>(`SELECT project_id FROM drawers WHERE id = $1`, [String(node.drawer_id)]);
  await requireProject(deps, actor, String(drawer[0].project_id));
  const rows = await deps.db.query<Row>(
    `SELECT g.*, p.slug FROM grants g LEFT JOIN portals p ON p.id = g.portal_id WHERE g.node_id = $1 ORDER BY g.created_at DESC`,
    [nodeId],
  );
  return rows.map((row) => grantView(deps, row, row.slug ? String(row.slug) : null));
}

export async function createGrant(deps: Deps, actor: MemberActor | GuestActor, nodeId: string, body: Record<string, unknown>): Promise<GrantView> {
  const node = await loadNodeRow(deps, actor.tenantId, nodeId);
  const drawerRows = await deps.db.query<Row>(`SELECT * FROM drawers WHERE id = $1`, [String(node.drawer_id)]);
  const drawer = drawerRows[0];
  if (actor.kind === "guest") {
    const { assertVerb } = await import("./access.js");
    await assertVerb(deps, actor, node, "reshare");
  } else {
    await requireProject(deps, actor, String(drawer.project_id));
  }
  const verbs = verbsOf(body);
  const anyone = Boolean(body.anyoneWithLink);
  let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  let granteeUserId: string | null = null;
  if (!anyone && !email && typeof body.userId === "string") granteeUserId = body.userId;
  if (granteeUserId) {
    const users = await deps.db.query<Row>(`SELECT email FROM users WHERE id = $1`, [granteeUserId]);
    if (!users[0]) throw new HttpError(404, "not_found", "Member not found");
    email = String(users[0].email).toLowerCase();
  }
  if (!anyone && !email) throw new HttpError(400, "invalid", "Choose an email, a member, or anyone with the link");
  const project = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1`, [String(drawer.project_id)]);
  const portal = await ensurePortal(deps, String(drawer.project_id), actor.tenantId, String(project[0].name));
  const token = secretToken();
  const id = crypto.randomUUID();
  const password = typeof body.password === "string" && body.password ? hashPassword(body.password, deps.config.scryptN) : null;
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
  const downloadCap = body.downloadCap == null || body.downloadCap === "" ? null : Number(body.downloadCap);
  await deps.db.query(
    `INSERT INTO grants (
      id, tenant_id, project_id, node_id, portal_id, grantee_user_id, grantee_email, anyone_with_link,
      password_hash, token_hash, token_cipher, can_list, can_download, can_upload, can_delete, can_reshare,
      expires_at, download_cap, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      actor.tenantId,
      String(drawer.project_id),
      nodeId,
      String(portal.id),
      granteeUserId,
      email || null,
      anyone,
      password,
      sha256(token),
      encryptString(deps.config.encryptionKey, token),
      verbs.includes("list"),
      verbs.includes("download"),
      verbs.includes("upload"),
      verbs.includes("delete"),
      verbs.includes("reshare"),
      expiresAt,
      Number.isFinite(downloadCap) ? downloadCap : null,
      deps.now().toISOString(),
    ],
  );
  await recordActivity(deps, {
    tenantId: actor.tenantId,
    projectId: String(drawer.project_id),
    nodeId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind: "grant-create",
    detail: { email: email || null, anyone, verbs },
  });
  const rows = await deps.db.query<Row>(`SELECT * FROM grants WHERE id = $1`, [id]);
  return grantView(deps, rows[0], String(portal.slug));
}

export async function revokeGrant(deps: Deps, actor: MemberActor, grantId: string): Promise<void> {
  const rows = await deps.db.query<Row>(`SELECT * FROM grants WHERE id = $1 AND tenant_id = $2`, [grantId, actor.tenantId]);
  const grant = rows[0];
  if (!grant) throw new HttpError(404, "not_found", "Grant not found");
  await requireProject(deps, actor, String(grant.project_id));
  await deps.db.query(`DELETE FROM grants WHERE id = $1`, [grantId]);
  await recordActivity(deps, {
    tenantId: actor.tenantId,
    projectId: String(grant.project_id),
    nodeId: String(grant.node_id),
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind: "grant-revoke",
    detail: { grantId },
  });
}

export async function openPortal(deps: Deps, slug: string, body: Record<string, unknown>): Promise<{ token: string; portalId: string; email: string | null }> {
  const portals = await deps.db.query<Row>(`SELECT * FROM portals WHERE slug = $1`, [slug]);
  const portal = portals[0];
  if (!portal) throw new HttpError(404, "not_found", "Portal not found");
  const token = typeof body.token === "string" ? body.token : "";
  const grants = await deps.db.query<Row>(`SELECT * FROM grants WHERE token_hash = $1 AND portal_id = $2`, [sha256(token), String(portal.id)]);
  const grant = grants[0];
  if (!grant) {
    await recordActivity(deps, {
      tenantId: String(portal.tenant_id),
      projectId: String(portal.project_id),
      kind: "failed-portal-sign-in",
      detail: { slug },
    });
    throw new HttpError(401, "unauthorized", "This link is not valid");
  }
  if (grant.expires_at && new Date(String(grant.expires_at)).getTime() <= deps.now().getTime()) {
    throw new HttpError(401, "expired", "This link has expired");
  }
  if (grant.password_hash) {
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) throw new HttpError(401, "password_required", "Password required");
    if (!verifyPassword(password, String(grant.password_hash))) {
      await recordActivity(deps, {
        tenantId: String(portal.tenant_id),
        projectId: String(portal.project_id),
        kind: "failed-portal-sign-in",
        detail: { slug },
      });
      throw new HttpError(401, "unauthorized", "Wrong password");
    }
  }
  const sessionToken = secretToken();
  const email = grant.grantee_email ? String(grant.grantee_email) : null;
  await deps.db.query(
    `INSERT INTO sessions (id, user_id, token_hash, active_tenant_id, kind, portal_id, guest_email, link_grant_id, expires_at, created_at)
     VALUES ($1, NULL, $2, $3, 'guest', $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      sha256(sessionToken),
      String(portal.tenant_id),
      String(portal.id),
      email,
      asBool(grant.anyone_with_link) && !email ? String(grant.id) : null,
      new Date(deps.now().getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      deps.now().toISOString(),
    ],
  );
  await recordActivity(deps, {
    tenantId: String(portal.tenant_id),
    projectId: String(portal.project_id),
    actorEmail: email,
    kind: "sign-in",
    detail: { portal: slug },
  });
  return { token: sessionToken, portalId: String(portal.id), email };
}

export async function portalHome(deps: Deps, guest: GuestActor, slug: string) {
  const portals = await deps.db.query<Row>(`SELECT * FROM portals WHERE slug = $1`, [slug]);
  const portal = portals[0];
  if (!portal || String(portal.id) !== guest.portalId) throw new HttpError(403, "forbidden", "Permission denied");
  const project = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1`, [String(portal.project_id)]);
  const grants = await guestGrants(deps, guest);
  const roots: PortalRoot[] = [];
  for (const grant of grants) {
    const rows = await deps.db.query<Row>(
      `SELECT n.*, d.name AS drawer_name FROM nodes n JOIN drawers d ON d.id = n.drawer_id
       WHERE n.tenant_id = $1 AND n.backend_key = $2 LIMIT 1`,
      [guest.tenantId, grant.backendKey],
    );
    if (!rows[0]) continue;
    const verbs = grant.verbs;
    roots.push({
      node: mapNode(rows[0]),
      drawerId: String(rows[0].drawer_id),
      drawerName: String(rows[0].drawer_name),
      grantId: grant.id,
      verbs,
      dropFolder: isDropFolder(verbs),
    });
  }
  return {
    portal: { slug, name: String(portal.name), projectName: String(project[0]?.name ?? portal.name) },
    email: guest.email,
    roots,
  };
}

export async function portalActivity(deps: Deps, guest: GuestActor, slug: string) {
  const portals = await deps.db.query<Row>(`SELECT * FROM portals WHERE id = $1 AND slug = $2`, [guest.portalId, slug]);
  if (!portals[0]) throw new HttpError(403, "forbidden", "Permission denied");
  const rows = await deps.db.query<Row>(
    `SELECT * FROM activity WHERE project_id = $1 AND actor_email IS NOT NULL AND lower(actor_email) = lower($2) ORDER BY created_at DESC LIMIT 100`,
    [String(portals[0].project_id), guest.email ?? ""],
  );
  const { mapActivity } = await import("../mappers.js");
  return rows.map(mapActivity);
}
