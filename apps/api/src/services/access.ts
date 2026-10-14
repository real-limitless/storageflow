import crypto from "node:crypto";
import type { GrantVerb, MemberRole, TransferPlan } from "@storageflow/domain";
import { scopeAllows, verbsForNode, type GrantCheck } from "@storageflow/domain";
import type { ObjectBinding } from "@storageflow/storage";
import type { AppConfig } from "../config.js";
import { decryptString } from "../crypto.js";
import type { Db } from "../db.js";
import { HttpError, asBool, asNumber } from "../http.js";
import type { JobQueue } from "../jobs.js";
import type { AdapterResolver } from "../adapters.js";
import { verbsFromRow, type Row } from "../mappers.js";

export interface Deps {
  db: Db;
  adapters: AdapterResolver;
  config: AppConfig;
  jobs: JobQueue;
  now: () => Date;
}

export interface MemberActor {
  kind: "member";
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantRole: MemberRole;
  transferPlan: TransferPlan;
  /** Set for a scoped API key. A session cookie leaves this unset. */
  scopes?: readonly GrantVerb[];
}

export interface GuestActor {
  kind: "guest";
  userId: string | null;
  email: string | null;
  portalId: string;
  linkGrantId: string | null;
  tenantId: string;
}

export type Actor = MemberActor | GuestActor;

// The tenant is the team. Drawers belong to a cabinet (projects row) inside that
// team. Drawer and node lookups below filter on tenant_id.

export async function recordAudit(
  deps: Deps,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await deps.db.query(
    `INSERT INTO audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      crypto.randomUUID(),
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.detail ?? {}),
      deps.now().toISOString(),
    ],
  );
}

export async function recordActivity(
  deps: Deps,
  input: {
    tenantId: string;
    projectId?: string | null;
    nodeId?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    kind: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await deps.db.query(
    `INSERT INTO activity (id, tenant_id, project_id, node_id, actor_user_id, actor_email, kind, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      crypto.randomUUID(),
      input.tenantId,
      input.projectId ?? null,
      input.nodeId ?? null,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.kind,
      JSON.stringify(input.detail ?? {}),
      deps.now().toISOString(),
    ],
  );
}

export async function membershipRole(db: Db, tenantId: string, userId: string): Promise<MemberRole | null> {
  const rows = await db.query<Row>(`SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
  return rows[0] ? (String(rows[0].role) as MemberRole) : null;
}

export async function requireProject(deps: Deps, actor: MemberActor, projectId: string): Promise<Row> {
  const rows = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1 AND tenant_id = $2`, [projectId, actor.tenantId]);
  const project = rows[0];
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  if (actor.tenantRole === "owner") return project;
  const member = await deps.db.query<Row>(`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, actor.userId]);
  if (!member[0]) throw new HttpError(403, "forbidden", "You are not on this project");
  return project;
}

export async function projectRoleFor(deps: Deps, actor: MemberActor, projectId: string): Promise<MemberRole> {
  if (actor.tenantRole === "owner") return "owner";
  const member = await deps.db.query<Row>(`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, actor.userId]);
  if (!member[0]) throw new HttpError(403, "forbidden", "You are not on this project");
  return String(member[0].role) as MemberRole;
}

export async function loadDrawerRow(deps: Deps, tenantId: string, drawerId: string): Promise<Row> {
  const rows = await deps.db.query<Row>(`SELECT * FROM drawers WHERE id = $1 AND tenant_id = $2`, [drawerId, tenantId]);
  if (!rows[0]) throw new HttpError(404, "not_found", "Drawer not found");
  return rows[0];
}

export async function loadNodeRow(deps: Deps, tenantId: string, nodeId: string): Promise<Row> {
  const rows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE id = $1 AND tenant_id = $2`, [nodeId, tenantId]);
  if (!rows[0]) throw new HttpError(404, "not_found", "Item not found");
  return rows[0];
}

export function bindingFromRow(row: Row, config: AppConfig): ObjectBinding {
  const secret = row.secret_cipher ? decryptString(config.encryptionKey, String(row.secret_cipher)) : "";
  const kind = String(row.backend_kind) === "hosted" ? "hosted" : "s3";
  return {
    kind,
    endpoint: String(row.endpoint ?? ""),
    region: String(row.region ?? "us-east-1"),
    bucket: String(row.bucket ?? ""),
    prefix: String(row.prefix ?? ""),
    forcePathStyle: asBool(row.path_style),
    accessKeyId: String(row.access_key ?? ""),
    secretAccessKey: secret,
  };
}

export async function guestGrants(deps: Deps, guest: GuestActor): Promise<Array<GrantCheck & { id: string }>> {
  const rows = await deps.db.query<Row>(
    `SELECT g.*, n.backend_key, n.kind AS node_kind
     FROM grants g
     JOIN nodes n ON n.id = g.node_id
     WHERE g.portal_id = $1
       AND g.tenant_id = $2
       AND (
         ($3 <> '' AND lower(COALESCE(g.grantee_email, '')) = lower($3))
         OR ($4 <> '' AND g.id::text = $4 AND g.anyone_with_link = true)
       )`,
    [guest.portalId, guest.tenantId, guest.email ?? "", guest.linkGrantId ?? ""],
  );
  return rows.map((row) => ({
    id: String(row.id),
    backendKey: String(row.backend_key),
    nodeKind: String(row.node_kind) === "file" ? "file" : "folder",
    verbs: verbsFromRow(row),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    downloadCap: asNumber(row.download_cap),
    downloadCount: asNumber(row.download_count) ?? 0,
  }));
}

export async function assertVerb(deps: Deps, actor: Actor, node: Row, verb: GrantVerb): Promise<void> {
  if (actor.kind === "member") {
    if (actor.scopes && !scopeAllows(actor.scopes, verb)) {
      throw new HttpError(403, "forbidden", "This key does not allow that");
    }
    const drawer = await loadDrawerRow(deps, actor.tenantId, String(node.drawer_id));
    await requireProject(deps, actor, String(drawer.project_id));
    return;
  }
  if (String(node.tenant_id) !== actor.tenantId) throw new HttpError(403, "forbidden", "Permission denied");
  const portalRows = await deps.db.query<Row>(`SELECT project_id FROM drawers WHERE id = $1`, [String(node.drawer_id)]);
  const portal = await deps.db.query<Row>(`SELECT id FROM portals WHERE id = $1 AND project_id = $2`, [
    actor.portalId,
    portalRows[0] ? String(portalRows[0].project_id) : null,
  ]);
  if (!portal[0]) throw new HttpError(403, "forbidden", "Permission denied");
  const grants = await guestGrants(deps, actor);
  const verbs = verbsForNode(grants, String(node.backend_key), deps.now());
  if (!verbs.includes(verb)) throw new HttpError(403, "forbidden", "Permission denied");
}

export async function rootFolderId(db: Db, drawerId: string): Promise<string | null> {
  const rows = await db.query<Row>(`SELECT id FROM nodes WHERE drawer_id = $1 AND parent_id IS NULL AND kind = 'folder' ORDER BY cached_at ASC LIMIT 1`, [drawerId]);
  return rows[0] ? String(rows[0].id) : null;
}
