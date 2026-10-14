import crypto from "node:crypto";
import {
  LABEL_COLORS,
  PROJECT_KINDS,
  assertObjectName,
  backendDisplayPath,
  isDescendantKey,
  joinKey,
  normalizePrefix,
  parentPrefix,
  replaceKeyPrefix,
  typeLabel,
  type Drawer,
  type FolderTree,
  type GrantVerb,
  type JobSummary,
  type Listing,
  type Node,
  type PathSegment,
  type Project,
  type ProjectKind,
  type SearchHit,
  type TestResult,
} from "@storageflow/domain";
import type { ObjectBinding, RemoteEntry, StorageAdapter } from "@storageflow/storage";
import { S3Adapter } from "@storageflow/storage";
import { HttpError, asBool, asNumber, likePrefix } from "../http.js";
import { mapDrawer, mapJob, mapNode, mapProject, type Row } from "../mappers.js";
import {
  assertVerb,
  bindingFromRow,
  loadDrawerRow,
  loadNodeRow,
  projectRoleFor,
  recordActivity,
  requireProject,
  rootFolderId,
  type Actor,
  type Deps,
  type MemberActor,
} from "./access.js";
import { isVersionListingName, snapshotFileVersion } from "./versions.js";

const PART_SIZE = 8 * 1024 * 1024;

function colorOf(value: unknown): Node["color"] {
  if (value == null || value === "" || value === "none") return null;
  if (typeof value === "string" && (LABEL_COLORS as readonly string[]).includes(value)) return value as Node["color"];
  throw new HttpError(400, "invalid", "Unknown color");
}

function projectKind(value: unknown): ProjectKind {
  if (typeof value === "string" && (PROJECT_KINDS as readonly string[]).includes(value)) return value as ProjectKind;
  throw new HttpError(400, "invalid", "Unknown project kind");
}

function conflict(error: unknown): never {
  if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
    throw new HttpError(409, "conflict", "An item with that name already exists");
  }
  throw error;
}

async function jobsForProject(deps: Deps, projectId: string): Promise<Map<string, JobSummary[]>> {
  const rows = await deps.db.query<Row>(
    `SELECT * FROM jobs WHERE project_id = $1 AND status IN ('queued', 'running', 'error') ORDER BY created_at DESC`,
    [projectId],
  );
  const map = new Map<string, JobSummary[]>();
  for (const row of rows) {
    const drawerId = row.drawer_id ? String(row.drawer_id) : "";
    const list = map.get(drawerId) ?? [];
    list.push(mapJob(row));
    map.set(drawerId, list);
  }
  return map;
}

async function presentDrawer(deps: Deps, row: Row, jobs: JobSummary[] = []): Promise<Drawer> {
  return mapDrawer(row, await rootFolderId(deps.db, String(row.id)), jobs);
}

async function presentDrawers(deps: Deps, rows: Row[]): Promise<Drawer[]> {
  if (rows.length === 0) return [];
  const jobs = await jobsForProject(deps, String(rows[0].project_id));
  const drawers: Drawer[] = [];
  for (const row of rows) drawers.push(await presentDrawer(deps, row, jobs.get(String(row.id)) ?? []));
  return drawers;
}

function hostedBinding(deps: Deps, prefix: string): ObjectBinding {
  const hosted = deps.config.hosted;
  return {
    kind: "hosted",
    endpoint: hosted.endpoint,
    region: hosted.region,
    bucket: hosted.bucket,
    prefix,
    forcePathStyle: hosted.forcePathStyle,
    accessKeyId: hosted.accessKeyId,
    secretAccessKey: hosted.secretAccessKey,
  };
}

function bindingFromInput(deps: Deps, body: Record<string, unknown>, prefix: string, existingSecret?: string): ObjectBinding {
  const mode = body.mode === "hosted" ? "hosted" : "linked";
  if (mode === "hosted") return hostedBinding(deps, prefix);
  const endpoint = String(body.endpoint ?? "").trim();
  const bucket = String(body.bucket ?? "").trim();
  const accessKey = String(body.accessKey ?? body.accessKeyId ?? "").trim();
  const secret = String(body.secretKey ?? body.secretAccessKey ?? existingSecret ?? "");
  if (!endpoint || !bucket || !accessKey || !secret) {
    throw new HttpError(400, "invalid", "S3 endpoint, bucket, access key, and secret are required");
  }
  return {
    kind: "s3",
    endpoint,
    region: String(body.region ?? "us-east-1").trim() || "us-east-1",
    bucket,
    prefix: normalizePrefix(String(body.prefix ?? prefix ?? "")),
    forcePathStyle: body.pathStyle !== false && body.forcePathStyle !== false,
    accessKeyId: accessKey,
    secretAccessKey: secret,
  };
}

async function rememberHealth(deps: Deps, row: Row, health: { ok: boolean; message?: string }): Promise<void> {
  const wasDown = row.health_ok === false || row.health_ok === "f" || row.health_ok === "false";
  await deps.db.query(
    `UPDATE drawers SET health_ok = $2, health_message = $3, health_checked_at = $4 WHERE id = $1`,
    [String(row.id), health.ok, health.ok ? null : health.message ?? "Unreachable", deps.now().toISOString()],
  );
  if (!health.ok && !wasDown) {
    await recordActivity(deps, {
      tenantId: String(row.tenant_id),
      projectId: String(row.project_id),
      kind: "drawer-health-failure",
      detail: { drawerId: String(row.id), message: health.message ?? "Unreachable" },
    });
  }
}

export async function openAdapter(deps: Deps, row: Row, options?: { requireOk?: boolean }): Promise<StorageAdapter> {
  const binding = bindingFromRow(row, deps.config);
  if (!binding.secretAccessKey) {
    const health = { ok: false, message: "Hosted storage is not configured for this tenant" };
    if (options?.requireOk) {
      await rememberHealth(deps, row, health);
      throw new HttpError(409, "drawer_unavailable", health.message);
    }
  }
  const adapter = deps.adapters.forBinding(binding);
  if (options?.requireOk) {
    const health = await adapter.health();
    await rememberHealth(deps, row, health);
    if (!health.ok) throw new HttpError(409, "drawer_unavailable", health.message ?? "This drawer is unreachable");
  }
  return adapter;
}

async function upsertNode(
  deps: Deps,
  input: {
    tenantId: string;
    drawerId: string;
    parentId: string | null;
    backendKey: string;
    kind: "file" | "folder";
    name: string;
    size?: number | null;
    contentType?: string | null;
    modifiedAt?: string | null;
    incomplete?: boolean;
    keepIncomplete?: boolean;
  },
): Promise<Node> {
  const rows = await deps.db.query<Row>(
    `INSERT INTO nodes (id, tenant_id, drawer_id, parent_id, backend_key, kind, name, size, content_type, modified_at, incomplete, cached_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (drawer_id, backend_key) DO UPDATE SET
       parent_id = EXCLUDED.parent_id,
       name = EXCLUDED.name,
       size = EXCLUDED.size,
       content_type = EXCLUDED.content_type,
       modified_at = EXCLUDED.modified_at,
       incomplete = CASE WHEN $13 THEN nodes.incomplete ELSE EXCLUDED.incomplete END,
       cached_at = EXCLUDED.cached_at
     RETURNING *`,
    [
      crypto.randomUUID(),
      input.tenantId,
      input.drawerId,
      input.parentId,
      input.backendKey,
      input.kind,
      input.name,
      input.size ?? null,
      input.contentType ?? null,
      input.modifiedAt ?? null,
      input.incomplete ?? false,
      deps.now().toISOString(),
      input.keepIncomplete ?? false,
    ],
  );
  return mapNode(rows[0]);
}

async function breadcrumb(deps: Deps, project: Row, drawer: Row, folder: Node): Promise<PathSegment[]> {
  const chain: PathSegment[] = [];
  let current = folder;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push({ id: current.id, name: current.name, kind: "folder" });
    const parent = await loadNodeRow(deps, String(drawer.tenant_id), current.parentId);
    current = mapNode(parent);
  }
  return [
    { id: String(project.id), name: String(project.name), kind: "project" },
    { id: String(drawer.id), name: String(drawer.name), kind: "drawer" },
    ...chain.reverse(),
  ];
}

function sortNodes(nodes: Node[], sort: string, direction: string): Node[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...nodes].sort((a, b) => {
    let compared = 0;
    if (sort === "size") compared = (a.size ?? -1) - (b.size ?? -1);
    else if (sort === "modified") compared = (a.modifiedAt ?? "").localeCompare(b.modifiedAt ?? "");
    else if (sort === "type") compared = typeLabel(a.name).localeCompare(typeLabel(b.name)) || a.name.localeCompare(b.name);
    else compared = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return compared * sign || a.name.localeCompare(b.name);
  });
}

export async function listProjects(deps: Deps, actor: MemberActor): Promise<Project[]> {
  const rows =
    actor.tenantRole === "owner"
      ? await deps.db.query<Row>(`SELECT * FROM projects WHERE tenant_id = $1 ORDER BY name`, [actor.tenantId])
      : await deps.db.query<Row>(
          `SELECT p.*, pm.role AS member_role FROM projects p
           JOIN project_members pm ON pm.project_id = p.id
           WHERE p.tenant_id = $1 AND pm.user_id = $2
           ORDER BY p.name`,
          [actor.tenantId, actor.userId],
        );
  const projects: Project[] = [];
  for (const row of rows) {
    const role = actor.tenantRole === "owner" ? "owner" : ((String(row.member_role ?? "member") as Project["role"]) ?? "member");
    projects.push(mapProject(row, role === "owner" ? "owner" : "member"));
  }
  return projects;
}

export async function createProject(deps: Deps, actor: MemberActor, body: Record<string, unknown>): Promise<Project> {
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "invalid", "name is required");
  const kind = projectKind(body.kind);
  const id = crypto.randomUUID();
  const now = deps.now().toISOString();
  await deps.db.query(
    `INSERT INTO projects (id, tenant_id, name, kind, description, color, starred, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
    [id, actor.tenantId, name, kind, String(body.description ?? ""), colorOf(body.color), now],
  );
  await deps.db.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, actor.userId]);
  const rows = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1`, [id]);
  return mapProject(rows[0], "owner");
}

export async function updateProject(deps: Deps, actor: MemberActor, projectId: string, body: Record<string, unknown>): Promise<Project> {
  const role = await projectRoleFor(deps, actor, projectId);
  if (role !== "owner" && actor.tenantRole !== "owner") throw new HttpError(403, "forbidden", "Only an owner can change the project");
  const current = await requireProject(deps, actor, projectId);
  const name = body.name != null ? String(body.name).trim() : String(current.name);
  if (!name) throw new HttpError(400, "invalid", "name is required");
  const kind = body.kind != null ? projectKind(body.kind) : (String(current.kind) as ProjectKind);
  const description = body.description != null ? String(body.description) : String(current.description ?? "");
  const color = body.color !== undefined ? colorOf(body.color) : ((current.color as Project["color"]) ?? null);
  const starred = body.starred !== undefined ? Boolean(body.starred) : asBool(current.starred);
  await deps.db.query(`UPDATE projects SET name = $2, kind = $3, description = $4, color = $5, starred = $6 WHERE id = $1`, [
    projectId,
    name,
    kind,
    description,
    color,
    starred,
  ]);
  if (body.defaultProject === true) {
    await deps.db.query(
      `INSERT INTO preferences (user_id, tenant_id, pane_sizes, view_mode, zoom, default_project_id, location_tabs)
       VALUES ($1, $2, $3::jsonb, 'grid', 2, $4, '[]'::jsonb)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET default_project_id = $4`,
      [actor.userId, actor.tenantId, JSON.stringify({ drawers: 22, folders: 26, files: 52 }), projectId],
    );
  }
  const rows = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1`, [projectId]);
  return mapProject(rows[0], role);
}

export async function deleteProject(deps: Deps, actor: MemberActor, projectId: string): Promise<void> {
  const role = await projectRoleFor(deps, actor, projectId);
  if (role !== "owner") throw new HttpError(403, "forbidden", "Only an owner can delete the project");
  const drawers = await deps.db.query<Row>(`SELECT * FROM drawers WHERE project_id = $1`, [projectId]);
  for (const drawer of drawers) {
    if (String(drawer.mode) !== "hosted") continue;
    try {
      const adapter = await openAdapter(deps, drawer);
      await adapter.remove(String(drawer.prefix), true);
    } catch {
      // The project can still be deleted when hosted bytes are already unreachable.
    }
  }
  await deps.db.query(`DELETE FROM projects WHERE id = $1 AND tenant_id = $2`, [projectId, actor.tenantId]);
}

export async function listDrawers(deps: Deps, actor: MemberActor, projectId: string): Promise<Drawer[]> {
  await requireProject(deps, actor, projectId);
  const rows = await deps.db.query<Row>(`SELECT * FROM drawers WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, name`, [
    projectId,
    actor.tenantId,
  ]);
  return presentDrawers(deps, rows);
}

async function probe(adapter: StorageAdapter, prefix: string): Promise<TestResult> {
  const health = await adapter.health();
  if (!health.ok) return { ok: false, message: health.message ?? "Unreachable", names: [] };
  try {
    const entries = await adapter.list(normalizePrefix(prefix));
    return { ok: true, names: entries.slice(0, 8).map((entry) => entry.name) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "List failed", names: [] };
  }
}

export async function testUnsavedDrawer(deps: Deps, actor: MemberActor, projectId: string, body: Record<string, unknown>): Promise<TestResult> {
  await requireProject(deps, actor, projectId);
  if (body.mode === "hosted" && !deps.config.hosted.configured && deps.config.adapterMode !== "memory") {
    return { ok: false, message: "Hosted storage is not configured for this tenant", names: [] };
  }
  if (body.backendKind === "sftp") throw new HttpError(400, "invalid", "SFTP appears when that adapter exists");
  if (body.backendKind === "connector") throw new HttpError(400, "invalid", "A local connector is not a folder the server can read");
  const prefix = body.mode === "hosted" ? "drawers/" : normalizePrefix(String(body.prefix ?? ""));
  const binding = bindingFromInput(deps, body, prefix);
  return probe(deps.adapters.forBinding(binding), binding.prefix);
}

export async function createDrawer(deps: Deps, actor: MemberActor, projectId: string, body: Record<string, unknown>): Promise<Drawer> {
  await requireProject(deps, actor, projectId);
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "invalid", "name is required");
  if (body.backendKind === "sftp") throw new HttpError(400, "invalid", "SFTP appears when that adapter exists");
  if (body.backendKind === "connector") throw new HttpError(400, "invalid", "A local connector is not a folder the server can read");
  const mode = body.mode === "hosted" ? "hosted" : "linked";
  const id = crypto.randomUUID();
  const prefix = mode === "hosted" ? `drawers/${id}/` : normalizePrefix(String(body.prefix ?? ""));
  const binding = bindingFromInput(deps, { ...body, mode }, prefix);
  const orderRows = await deps.db.query<Row>(`SELECT COALESCE(MAX(sort_order), 0) AS max FROM drawers WHERE project_id = $1`, [projectId]);
  const sortOrder = (asNumber(orderRows[0]?.max) ?? 0) + 1;
  const { encryptString } = await import("../crypto.js");
  const now = deps.now().toISOString();
  await deps.db.query(
    `INSERT INTO drawers (
      id, tenant_id, project_id, name, mode, backend_kind, sort_order, color, starred, notes,
      endpoint, region, bucket, prefix, path_style, access_key, secret_cipher, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      actor.tenantId,
      projectId,
      name,
      mode,
      mode === "hosted" ? "hosted" : "s3",
      sortOrder,
      colorOf(body.color),
      String(body.notes ?? ""),
      binding.endpoint,
      binding.region,
      binding.bucket,
      binding.prefix,
      binding.forcePathStyle,
      binding.accessKeyId,
      binding.secretAccessKey ? encryptString(deps.config.encryptionKey, binding.secretAccessKey) : null,
      now,
    ],
  );
  await deps.db.query(
    `INSERT INTO nodes (id, tenant_id, drawer_id, parent_id, backend_key, kind, name, cached_at)
     VALUES ($1, $2, $3, NULL, $4, 'folder', $5, $6)`,
    [crypto.randomUUID(), actor.tenantId, id, binding.prefix, name, now],
  );
  const row = await loadDrawerRow(deps, actor.tenantId, id);
  try {
    const adapter = deps.adapters.forBinding(binding);
    if (mode === "hosted") await adapter.mkdir(binding.prefix);
    const health = await adapter.health();
    await rememberHealth(deps, row, health);
  } catch (error) {
    await rememberHealth(deps, row, { ok: false, message: error instanceof Error ? error.message : "Unreachable" });
  }
  const fresh = await loadDrawerRow(deps, actor.tenantId, id);
  return presentDrawer(deps, fresh);
}

export async function testDrawer(deps: Deps, actor: MemberActor, drawerId: string): Promise<TestResult> {
  const row = await loadDrawerRow(deps, actor.tenantId, drawerId);
  await requireProject(deps, actor, String(row.project_id));
  const adapter = deps.adapters.forBinding(bindingFromRow(row, deps.config));
  const result = await probe(adapter, String(row.prefix));
  await rememberHealth(deps, row, { ok: result.ok, message: result.message });
  return result;
}

export async function updateDrawer(deps: Deps, actor: MemberActor, drawerId: string, body: Record<string, unknown>): Promise<Drawer> {
  const row = await loadDrawerRow(deps, actor.tenantId, drawerId);
  await requireProject(deps, actor, String(row.project_id));
  const name = body.name != null ? String(body.name).trim() : String(row.name);
  if (!name) throw new HttpError(400, "invalid", "name is required");
  let prefix = String(row.prefix);
  let endpoint = row.endpoint ? String(row.endpoint) : null;
  let region = row.region ? String(row.region) : null;
  let bucket = row.bucket ? String(row.bucket) : null;
  let pathStyle = asBool(row.path_style);
  let accessKey = row.access_key ? String(row.access_key) : null;
  let secretCipher = row.secret_cipher ? String(row.secret_cipher) : null;
  const rebinding = body.endpoint != null || body.bucket != null || body.prefix != null || body.secretKey != null || body.accessKey != null;
  if (rebinding && String(row.mode) === "linked") {
    const nextPrefix = body.prefix != null ? normalizePrefix(String(body.prefix)) : prefix;
    if (nextPrefix !== prefix && body.dropCache !== true) {
      throw new HttpError(409, "confirm_prefix", "Changing the prefix drops the cached listing");
    }
    const existingSecret = secretCipher ? (await import("../crypto.js")).decryptString(deps.config.encryptionKey, secretCipher) : "";
    const resolved = bindingFromInput(
      deps,
      {
        mode: "linked",
        endpoint: body.endpoint ?? endpoint,
        region: body.region ?? region,
        bucket: body.bucket ?? bucket,
        prefix: nextPrefix,
        pathStyle: body.pathStyle ?? pathStyle,
        accessKey: body.accessKey ?? accessKey,
        secretKey: body.secretKey ?? existingSecret,
      },
      nextPrefix,
    );
    prefix = resolved.prefix;
    endpoint = resolved.endpoint;
    region = resolved.region;
    bucket = resolved.bucket;
    pathStyle = resolved.forcePathStyle;
    accessKey = resolved.accessKeyId;
    if (body.secretKey || !secretCipher) {
      const { encryptString } = await import("../crypto.js");
      secretCipher = encryptString(deps.config.encryptionKey, resolved.secretAccessKey);
    }
    if (nextPrefix !== String(row.prefix)) {
      await deps.db.query(`DELETE FROM nodes WHERE drawer_id = $1`, [drawerId]);
      await deps.db.query(
        `INSERT INTO nodes (id, tenant_id, drawer_id, parent_id, backend_key, kind, name, cached_at)
         VALUES ($1, $2, $3, NULL, $4, 'folder', $5, $6)`,
        [crypto.randomUUID(), actor.tenantId, drawerId, prefix, name, deps.now().toISOString()],
      );
    }
  }
  await deps.db.query(
    `UPDATE drawers SET name = $2, sort_order = $3, color = $4, starred = $5, notes = $6,
      endpoint = $7, region = $8, bucket = $9, prefix = $10, path_style = $11, access_key = $12, secret_cipher = $13
     WHERE id = $1`,
    [
      drawerId,
      name,
      body.sortOrder != null ? Number(body.sortOrder) : asNumber(row.sort_order) ?? 0,
      body.color !== undefined ? colorOf(body.color) : ((row.color as Drawer["color"]) ?? null),
      body.starred !== undefined ? Boolean(body.starred) : asBool(row.starred),
      body.notes != null ? String(body.notes) : String(row.notes ?? ""),
      endpoint,
      region,
      bucket,
      prefix,
      pathStyle,
      accessKey,
      secretCipher,
    ],
  );
  const root = await deps.db.query(`UPDATE nodes SET name = $2 WHERE drawer_id = $1 AND parent_id IS NULL`, [drawerId, name]);
  void root;
  const fresh = await loadDrawerRow(deps, actor.tenantId, drawerId);
  return presentDrawer(deps, fresh);
}

export async function deleteDrawer(deps: Deps, actor: MemberActor, drawerId: string): Promise<void> {
  const row = await loadDrawerRow(deps, actor.tenantId, drawerId);
  await requireProject(deps, actor, String(row.project_id));
  if (String(row.mode) === "hosted" && row.secret_cipher) {
    try {
      const adapter = deps.adapters.forBinding(bindingFromRow(row, deps.config));
      await adapter.remove(String(row.prefix), true);
    } catch {
      // Metadata removal still proceeds.
    }
  }
  await deps.db.query(`DELETE FROM drawers WHERE id = $1 AND tenant_id = $2`, [drawerId, actor.tenantId]);
}

async function cachedChildren(deps: Deps, drawerId: string, folderId: string, kind: "file" | "folder"): Promise<Node[]> {
  const rows = await deps.db.query<Row>(
    `SELECT * FROM nodes WHERE drawer_id = $1 AND parent_id = $2 AND kind = $3 ORDER BY sort_order, name`,
    [drawerId, folderId, kind],
  );
  return rows.map(mapNode);
}

export async function listFolder(
  deps: Deps,
  actor: Actor,
  drawerId: string,
  folderId: string,
  query: { q?: string; color?: string; sort?: string; dir?: string; cursor?: string; limit?: number },
): Promise<Listing> {
  const tenantId = actor.tenantId;
  const drawer = await loadDrawerRow(deps, tenantId, drawerId);
  if (actor.kind === "member") await requireProject(deps, actor, String(drawer.project_id));
  const folderRow = await loadNodeRow(deps, tenantId, folderId);
  if (String(folderRow.drawer_id) !== drawerId) throw new HttpError(404, "not_found", "Folder not found");
  await assertVerb(deps, actor, folderRow, "list");
  const projectRows = await deps.db.query<Row>(`SELECT * FROM projects WHERE id = $1`, [String(drawer.project_id)]);
  const folder = mapNode(folderRow);
  let stale = false;
  let error: string | null = null;
  try {
    const adapter = await openAdapter(deps, drawer);
    const health = await adapter.health();
    await rememberHealth(deps, drawer, health);
    if (!health.ok) throw new Error(health.message ?? "Unreachable");
    const entries = await adapter.list(folder.backendKey);
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = entry.kind === "prefix" ? (entry.key.endsWith("/") ? entry.key : `${entry.key}/`) : entry.key;
      if (isVersionListingName(entry.name) || key.includes("/.sf-versions/")) continue;
      seen.add(key);
      await upsertNode(deps, {
        tenantId,
        drawerId,
        parentId: folder.id,
        backendKey: key,
        kind: entry.kind === "prefix" ? "folder" : "file",
        name: entry.name,
        size: entry.size ?? null,
        contentType: entry.contentType ?? null,
        modifiedAt: entry.modifiedAt ?? null,
        incomplete: false,
        keepIncomplete: true,
      });
    }
    const existing = await deps.db.query<Row>(`SELECT * FROM nodes WHERE drawer_id = $1 AND parent_id = $2`, [drawerId, folder.id]);
    for (const child of existing) {
      if (seen.has(String(child.backend_key))) continue;
      if (String(child.kind) === "folder") {
        await deps.db.query(`DELETE FROM nodes WHERE drawer_id = $1 AND (id = $2 OR backend_key LIKE $3 ESCAPE '\\')`, [
          drawerId,
          String(child.id),
          likePrefix(String(child.backend_key)),
        ]);
      } else {
        await deps.db.query(`DELETE FROM nodes WHERE id = $1`, [String(child.id)]);
      }
    }
    await deps.db.query(`UPDATE drawers SET cache_listed_at = $2, health_ok = true, health_message = NULL WHERE id = $1`, [
      drawerId,
      deps.now().toISOString(),
    ]);
  } catch (cause) {
    stale = true;
    error = cause instanceof Error ? cause.message : "Unreachable";
  }
  const freshDrawer = await loadDrawerRow(deps, tenantId, drawerId);
  let folders = await cachedChildren(deps, drawerId, folder.id, "folder");
  let files = await cachedChildren(deps, drawerId, folder.id, "file");
  const q = (query.q ?? "").trim().toLowerCase();
  const color = query.color && query.color !== "all" ? query.color : "";
  if (q || color) {
    const keep = (node: Node) => (!q || node.name.toLowerCase().includes(q)) && (!color || node.color === color);
    folders = folders.filter(keep);
    files = files.filter(keep);
  }
  if (query.sort === "order") {
    const byOrder = (a: Node, b: Node) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    folders.sort(byOrder);
    files.sort(byOrder);
  } else {
    files = sortNodes(files, query.sort || "name", query.dir || "asc");
  }
  const totalFiles = files.length;
  const offset = Number(query.cursor || 0) || 0;
  const limit = Math.min(Math.max(query.limit || 200, 1), 200);
  const page = files.slice(offset, offset + limit);
  const presented = await presentDrawer(deps, freshDrawer);
  return {
    drawer: presented,
    folder,
    folders,
    files: page,
    breadcrumb: await breadcrumb(deps, projectRows[0], freshDrawer, folder),
    backendPath: backendDisplayPath(presented.bucket, folder.backendKey),
    stale,
    listedAt: presented.cacheListedAt,
    error,
    nextCursor: offset + limit < totalFiles ? String(offset + limit) : null,
    totalFiles,
  };
}

export async function folderTree(deps: Deps, actor: Actor, drawerId: string): Promise<FolderTree> {
  const drawer = await loadDrawerRow(deps, actor.tenantId, drawerId);
  if (actor.kind === "member") await requireProject(deps, actor, String(drawer.project_id));
  const rootId = await rootFolderId(deps.db, drawerId);
  if (!rootId) throw new HttpError(404, "not_found", "Drawer root is missing");
  const root = mapNode(await loadNodeRow(deps, actor.tenantId, rootId));
  if (actor.kind === "guest") await assertVerb(deps, actor, await loadNodeRow(deps, actor.tenantId, rootId), "list").catch(() => undefined);
  const rows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE drawer_id = $1 AND kind = 'folder' ORDER BY name`, [drawerId]);
  let folders = rows.map(mapNode).filter((node) => node.id !== root.id);
  if (actor.kind === "guest") {
    const { guestGrants } = await import("./access.js");
    const { coversKey } = await import("@storageflow/domain");
    const grants = await guestGrants(deps, actor);
    folders = folders.filter((node) => grants.some((grant) => coversKey(grant.backendKey, node.backendKey, grant.nodeKind)));
    const rootAllowed = grants.some((grant) => coversKey(grant.backendKey, root.backendKey, grant.nodeKind));
    if (!rootAllowed) {
      const visibleIds = new Set(folders.map((folder) => folder.id));
      folders = folders.filter((folder) => folder.parentId && (visibleIds.has(folder.parentId) || grants.some((grant) => grant.backendKey === folder.backendKey)));
    }
  }
  return { root, folders };
}

export async function createFolder(deps: Deps, actor: Actor, drawerId: string, body: Record<string, unknown>): Promise<Node> {
  const drawer = await loadDrawerRow(deps, actor.tenantId, drawerId);
  const parentId = String(body.parentId ?? body.folderId ?? "");
  if (!parentId) throw new HttpError(400, "invalid", "parentId is required");
  const parent = await loadNodeRow(deps, actor.tenantId, parentId);
  if (String(parent.drawer_id) !== drawerId || String(parent.kind) !== "folder") throw new HttpError(400, "invalid", "Choose a folder");
  await assertVerb(deps, actor, parent, actor.kind === "guest" ? "upload" : "list");
  if (actor.kind === "member") await requireProject(deps, actor, String(drawer.project_id));
  const name = assertObjectName(String(body.name ?? ""));
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  const key = `${joinKey(String(parent.backend_key), name)}/`;
  await adapter.mkdir(key);
  try {
    return await upsertNode(deps, {
      tenantId: actor.tenantId,
      drawerId,
      parentId,
      backendKey: key,
      kind: "folder",
      name,
    });
  } catch (error) {
    conflict(error);
  }
}

export async function patchNode(deps: Deps, actor: Actor, nodeId: string, body: Record<string, unknown>): Promise<Node> {
  const node = await loadNodeRow(deps, actor.tenantId, nodeId);
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(node.drawer_id));
  const renaming = body.name != null && String(body.name).trim() !== String(node.name);
  if (renaming) {
    await assertVerb(deps, actor, node, actor.kind === "guest" ? "upload" : "list");
    if (node.parent_id == null) throw new HttpError(400, "invalid", "Rename the drawer, not its root");
    const name = assertObjectName(String(body.name));
    const adapter = await openAdapter(deps, drawer, { requireOk: true });
    const nextKey =
      String(node.kind) === "folder" ? `${joinKey(parentPrefix(String(node.backend_key)), name)}/` : joinKey(parentPrefix(String(node.backend_key)), name);
    await adapter.move(String(node.backend_key), nextKey);
    if (String(node.kind) === "folder") {
      const rows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE drawer_id = $1 AND (id = $2 OR backend_key LIKE $3 ESCAPE '\\')`, [
        String(node.drawer_id),
        nodeId,
        likePrefix(String(node.backend_key)),
      ]);
      for (const row of rows) {
        const key = replaceKeyPrefix(String(row.backend_key), String(node.backend_key), nextKey);
        await deps.db.query(`UPDATE nodes SET backend_key = $2, name = $3 WHERE id = $1`, [
          String(row.id),
          key,
          String(row.id) === nodeId ? name : String(row.name),
        ]);
      }
    } else {
      await deps.db.query(`UPDATE nodes SET backend_key = $2, name = $3 WHERE id = $1`, [nodeId, nextKey, name]);
    }
  }
  if (body.starred !== undefined || body.color !== undefined) {
    if (actor.kind === "guest") throw new HttpError(403, "forbidden", "Permission denied");
    await requireProject(deps, actor, String(drawer.project_id));
    await deps.db.query(`UPDATE nodes SET starred = $2, color = $3 WHERE id = $1`, [
      nodeId,
      body.starred !== undefined ? Boolean(body.starred) : asBool(node.starred),
      body.color !== undefined ? colorOf(body.color) : ((node.color as Node["color"]) ?? null),
    ]);
  }
  return mapNode(await loadNodeRow(deps, actor.tenantId, nodeId));
}

export async function reorderNodes(deps: Deps, actor: Actor, body: Record<string, unknown>): Promise<Node[]> {
  const parentId = String(body.parentId ?? "");
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
  if (!parentId || ids.length === 0) throw new HttpError(400, "invalid", "parentId and ids are required");
  const parent = await loadNodeRow(deps, actor.tenantId, parentId);
  if (String(parent.kind) !== "folder") throw new HttpError(400, "invalid", "Choose a folder");
  await assertVerb(deps, actor, parent, "upload");
  for (const id of ids) {
    const child = await loadNodeRow(deps, actor.tenantId, id);
    if (String(child.parent_id ?? "") !== parentId || String(child.drawer_id) !== String(parent.drawer_id)) {
      throw new HttpError(400, "invalid", "Reorder items in one folder");
    }
  }
  for (let index = 0; index < ids.length; index += 1) {
    await deps.db.query(`UPDATE nodes SET sort_order = $2 WHERE id = $1 AND tenant_id = $3`, [ids[index], index, actor.tenantId]);
  }
  const rows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE parent_id = $1 AND tenant_id = $2`, [parentId, actor.tenantId]);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids.map((id) => mapNode(byId.get(id) as Row));
}

async function sameDrawerDestination(deps: Deps, actor: Actor, folderId: string, drawerId: string): Promise<Row> {
  const folder = await loadNodeRow(deps, actor.tenantId, folderId);
  if (String(folder.drawer_id) !== drawerId || String(folder.kind) !== "folder") {
    throw new HttpError(400, "invalid", "Choose a folder in this drawer");
  }
  await assertVerb(deps, actor, folder, actor.kind === "guest" ? "upload" : "list");
  return folder;
}

export async function moveNodes(deps: Deps, actor: Actor, body: Record<string, unknown>): Promise<{ nodes: Node[] }> {
  const ids = Array.isArray(body.nodeIds) ? body.nodeIds.map(String) : [];
  const destinationFolderId = String(body.destinationFolderId ?? "");
  if (ids.length === 0 || !destinationFolderId) throw new HttpError(400, "invalid", "Choose items and a destination folder");
  const moved: Node[] = [];
  for (const id of ids) {
    const node = await loadNodeRow(deps, actor.tenantId, id);
    if (node.parent_id == null) throw new HttpError(400, "invalid", "The drawer root stays where it is");
    const drawer = await loadDrawerRow(deps, actor.tenantId, String(node.drawer_id));
    const destination = await sameDrawerDestination(deps, actor, destinationFolderId, String(node.drawer_id));
    await assertVerb(deps, actor, node, actor.kind === "guest" ? "upload" : "list");
    if (String(node.kind) === "folder" && (String(destination.id) === id || isDescendantKey(String(node.backend_key), String(destination.backend_key)))) {
      throw new HttpError(400, "invalid", "A folder cannot be moved into itself");
    }
    const adapter = await openAdapter(deps, drawer, { requireOk: true });
    const nextKey =
      String(node.kind) === "folder"
        ? `${joinKey(String(destination.backend_key), String(node.name))}/`
        : joinKey(String(destination.backend_key), String(node.name));
    await adapter.move(String(node.backend_key), nextKey);
    if (String(node.kind) === "folder") {
      const rows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE drawer_id = $1 AND (id = $2 OR backend_key LIKE $3 ESCAPE '\\')`, [
        String(node.drawer_id),
        id,
        likePrefix(String(node.backend_key)),
      ]);
      for (const row of rows) {
        await deps.db.query(`UPDATE nodes SET backend_key = $2, parent_id = $3 WHERE id = $1`, [
          String(row.id),
          replaceKeyPrefix(String(row.backend_key), String(node.backend_key), nextKey),
          String(row.id) === id ? destinationFolderId : row.parent_id,
        ]);
      }
    } else {
      await deps.db.query(`UPDATE nodes SET backend_key = $2, parent_id = $3 WHERE id = $1`, [id, nextKey, destinationFolderId]);
    }
    moved.push(mapNode(await loadNodeRow(deps, actor.tenantId, id)));
  }
  return { nodes: moved };
}

async function walkFiles(adapter: StorageAdapter, prefix: string): Promise<RemoteEntry[]> {
  const entries = await adapter.list(prefix);
  const files: RemoteEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "prefix") files.push(...(await walkFiles(adapter, entry.key)));
    else files.push(entry);
  }
  return files;
}

export async function copyNodes(deps: Deps, actor: MemberActor, body: Record<string, unknown>): Promise<JobSummary> {
  const ids = Array.isArray(body.nodeIds) ? body.nodeIds.map(String) : [];
  const destinationDrawerId = String(body.destinationDrawerId ?? "");
  const destinationFolderId = String(body.destinationFolderId ?? "");
  if (!ids.length || !destinationDrawerId || !destinationFolderId) throw new HttpError(400, "invalid", "Choose items and a destination");
  const destinationDrawer = await loadDrawerRow(deps, actor.tenantId, destinationDrawerId);
  await requireProject(deps, actor, String(destinationDrawer.project_id));
  const destinationFolder = await loadNodeRow(deps, actor.tenantId, destinationFolderId);
  if (String(destinationFolder.drawer_id) !== destinationDrawerId) throw new HttpError(400, "invalid", "Destination folder is in another drawer");
  const source = await loadNodeRow(deps, actor.tenantId, ids[0]);
  if (String(source.drawer_id) === destinationDrawerId) throw new HttpError(400, "invalid", "Use move inside a drawer");
  const jobId = crypto.randomUUID();
  const now = deps.now().toISOString();
  await deps.db.query(
    `INSERT INTO jobs (id, tenant_id, drawer_id, project_id, kind, status, progress, payload, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'copy', 'queued', 0, $5::jsonb, $6, $6)`,
    [jobId, actor.tenantId, destinationDrawerId, String(destinationDrawer.project_id), JSON.stringify({ nodeIds: ids, destinationFolderId }), now],
  );
  deps.jobs.enqueue(() => runCopy(deps, jobId));
  const rows = await deps.db.query<Row>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  return mapJob(rows[0]);
}

async function runCopy(deps: Deps, jobId: string): Promise<void> {
  const rows = await deps.db.query<Row>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  const job = rows[0];
  if (!job) return;
  await deps.db.query(`UPDATE jobs SET status = 'running', updated_at = $2 WHERE id = $1`, [jobId, deps.now().toISOString()]);
  try {
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : (job.payload as { nodeIds: string[]; destinationFolderId: string });
    const destinationDrawer = await loadDrawerRow(deps, String(job.tenant_id), String(job.drawer_id));
    const destinationFolder = await loadNodeRow(deps, String(job.tenant_id), payload.destinationFolderId);
    const destAdapter = await openAdapter(deps, destinationDrawer, { requireOk: true });
    let done = 0;
    for (const nodeId of payload.nodeIds) {
      const node = await loadNodeRow(deps, String(job.tenant_id), nodeId);
      const sourceDrawer = await loadDrawerRow(deps, String(job.tenant_id), String(node.drawer_id));
      const sourceAdapter = await openAdapter(deps, sourceDrawer, { requireOk: true });
      await copyTree(deps, sourceAdapter, destAdapter, node, destinationFolder, destinationDrawer);
      done += 1;
      await deps.db.query(`UPDATE jobs SET progress = $2, updated_at = $3 WHERE id = $1`, [
        jobId,
        Math.round((done / payload.nodeIds.length) * 100),
        deps.now().toISOString(),
      ]);
    }
    await deps.db.query(`UPDATE jobs SET status = 'done', progress = 100, updated_at = $2 WHERE id = $1`, [jobId, deps.now().toISOString()]);
  } catch (error) {
    await deps.db.query(`UPDATE jobs SET status = 'error', error = $2, updated_at = $3 WHERE id = $1`, [
      jobId,
      error instanceof Error ? error.message : "Copy failed",
      deps.now().toISOString(),
    ]);
  }
}

async function copyTree(deps: Deps, source: StorageAdapter, dest: StorageAdapter, node: Row, destFolder: Row, destDrawer: Row): Promise<void> {
  if (String(node.kind) === "file") {
    await copyFile(deps, source, dest, String(node.backend_key), String(node.name), destFolder, destDrawer, String(node.content_type ?? ""));
    return;
  }
  const folderKey = `${joinKey(String(destFolder.backend_key), String(node.name))}/`;
  await dest.mkdir(folderKey);
  const created = await upsertNode(deps, {
    tenantId: String(destDrawer.tenant_id),
    drawerId: String(destDrawer.id),
    parentId: String(destFolder.id),
    backendKey: folderKey,
    kind: "folder",
    name: String(node.name),
  });
  const folderRow = await loadNodeRow(deps, String(destDrawer.tenant_id), created.id);
  const files = await walkFiles(source, String(node.backend_key));
  for (const file of files) {
    const relative = file.key.slice(String(node.backend_key).length);
    const parts = relative.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let parent = folderRow;
    let key = folderKey;
    for (const part of parts) {
      key = `${joinKey(key, part)}/`;
      const next = await upsertNode(deps, {
        tenantId: String(destDrawer.tenant_id),
        drawerId: String(destDrawer.id),
        parentId: String(parent.id),
        backendKey: key,
        kind: "folder",
        name: part,
      });
      await dest.mkdir(key);
      parent = await loadNodeRow(deps, String(destDrawer.tenant_id), next.id);
    }
    await copyFile(deps, source, dest, file.key, fileName, parent, destDrawer, file.contentType ?? "");
  }
}

async function copyFile(
  deps: Deps,
  source: StorageAdapter,
  dest: StorageAdapter,
  fromKey: string,
  name: string,
  destFolder: Row,
  destDrawer: Row,
  contentType: string,
): Promise<void> {
  const toKey = joinKey(String(destFolder.backend_key), name);
  const incomplete = await upsertNode(deps, {
    tenantId: String(destDrawer.tenant_id),
    drawerId: String(destDrawer.id),
    parentId: String(destFolder.id),
    backendKey: toKey,
    kind: "file",
    name,
    incomplete: true,
    contentType: contentType || null,
  });
  const stat = await source.stat(fromKey);
  const stream = await source.read(fromKey);
  await dest.write(toKey, stream, stat.size ?? 0);
  await deps.db.query(`UPDATE nodes SET incomplete = false, size = $2, modified_at = $3, cached_at = $3 WHERE id = $1`, [
    incomplete.id,
    stat.size ?? 0,
    deps.now().toISOString(),
  ]);
}

export async function deleteNodes(deps: Deps, actor: Actor, body: Record<string, unknown>): Promise<{ job: JobSummary | null }> {
  const ids = Array.isArray(body.nodeIds) ? body.nodeIds.map(String) : [];
  if (ids.length === 0) throw new HttpError(400, "invalid", "Choose something to delete");
  const nodes = [];
  for (const id of ids) nodes.push(await loadNodeRow(deps, actor.tenantId, id));
  for (const node of nodes) {
    await assertVerb(deps, actor, node, "delete");
    if (node.parent_id == null) throw new HttpError(400, "invalid", "Delete the drawer from the drawer list");
  }
  const folder = nodes.some((node) => String(node.kind) === "folder");
  if (!folder && nodes.length === 1) {
    await removeNode(deps, nodes[0]);
    await recordActivity(deps, {
      tenantId: actor.tenantId,
      projectId: null,
      nodeId: String(nodes[0].id),
      actorUserId: actor.userId,
      actorEmail: actor.email,
      kind: "delete",
      detail: { name: String(nodes[0].name) },
    });
    return { job: null };
  }
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(nodes[0].drawer_id));
  const jobId = crypto.randomUUID();
  const now = deps.now().toISOString();
  await deps.db.query(
    `INSERT INTO jobs (id, tenant_id, drawer_id, project_id, kind, status, progress, payload, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'delete','queued',0,$5::jsonb,$6,$6)`,
    [jobId, actor.tenantId, String(drawer.id), String(drawer.project_id), JSON.stringify({ nodeIds: ids, actorUserId: actor.userId, actorEmail: actor.email }), now],
  );
  deps.jobs.enqueue(() => runDelete(deps, jobId));
  const rows = await deps.db.query<Row>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  return { job: mapJob(rows[0]) };
}

async function removeNode(deps: Deps, node: Row): Promise<void> {
  const drawer = await loadDrawerRow(deps, String(node.tenant_id), String(node.drawer_id));
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  const versionRows =
    String(node.kind) === "folder"
      ? await deps.db.query<Row>(
          `SELECT fv.storage_key
           FROM file_versions fv
           JOIN nodes n ON n.id = fv.node_id
           WHERE n.drawer_id = $1 AND (n.id = $2 OR n.backend_key LIKE $3 ESCAPE '\\')`,
          [String(node.drawer_id), String(node.id), likePrefix(String(node.backend_key))],
        )
      : await deps.db.query<Row>(`SELECT storage_key FROM file_versions WHERE node_id = $1`, [String(node.id)]);
  for (const version of versionRows) {
    try {
      await adapter.remove(String(version.storage_key), false);
    } catch {
      // Metadata removal still proceeds.
    }
  }
  await adapter.remove(String(node.backend_key), true);
  if (String(node.kind) === "folder") {
    await deps.db.query(`DELETE FROM nodes WHERE drawer_id = $1 AND (id = $2 OR backend_key LIKE $3 ESCAPE '\\')`, [
      String(node.drawer_id),
      String(node.id),
      likePrefix(String(node.backend_key)),
    ]);
  } else {
    await deps.db.query(`DELETE FROM nodes WHERE id = $1`, [String(node.id)]);
  }
}

async function runDelete(deps: Deps, jobId: string): Promise<void> {
  const rows = await deps.db.query<Row>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  const job = rows[0];
  if (!job) return;
  await deps.db.query(`UPDATE jobs SET status = 'running', updated_at = $2 WHERE id = $1`, [jobId, deps.now().toISOString()]);
  try {
    const payload = typeof job.payload === "string" ? JSON.parse(String(job.payload)) : (job.payload as { nodeIds: string[]; actorUserId?: string; actorEmail?: string });
    let done = 0;
    for (const nodeId of payload.nodeIds) {
      const nodeRows = await deps.db.query<Row>(`SELECT * FROM nodes WHERE id = $1`, [nodeId]);
      if (nodeRows[0]) {
        await removeNode(deps, nodeRows[0]);
        await recordActivity(deps, {
          tenantId: String(job.tenant_id),
          projectId: String(job.project_id),
          nodeId,
          actorUserId: payload.actorUserId ?? null,
          actorEmail: payload.actorEmail ?? null,
          kind: "delete",
          detail: { name: String(nodeRows[0].name) },
        });
      }
      done += 1;
      await deps.db.query(`UPDATE jobs SET progress = $2, updated_at = $3 WHERE id = $1`, [
        jobId,
        Math.round((done / payload.nodeIds.length) * 100),
        deps.now().toISOString(),
      ]);
    }
    await deps.db.query(`UPDATE jobs SET status = 'done', progress = 100, updated_at = $2 WHERE id = $1`, [jobId, deps.now().toISOString()]);
  } catch (error) {
    await deps.db.query(`UPDATE jobs SET status = 'error', error = $2, updated_at = $3 WHERE id = $1`, [
      jobId,
      error instanceof Error ? error.message : "Delete failed",
      deps.now().toISOString(),
    ]);
  }
}

export async function startUpload(deps: Deps, actor: Actor, drawerId: string, body: Record<string, unknown>) {
  const drawer = await loadDrawerRow(deps, actor.tenantId, drawerId);
  const folder = await loadNodeRow(deps, actor.tenantId, String(body.folderId ?? ""));
  if (String(folder.drawer_id) !== drawerId) throw new HttpError(400, "invalid", "Folder not found");
  await assertVerb(deps, actor, folder, "upload");
  const name = assertObjectName(String(body.name ?? ""));
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size < 0) throw new HttpError(400, "invalid", "size is required");
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  if (String(drawer.mode) === "hosted") {
    const usage = await deps.db.query<Row>(
      `SELECT COALESCE(SUM(n.size), 0) AS bytes FROM nodes n JOIN drawers d ON d.id = n.drawer_id
       WHERE d.tenant_id = $1 AND d.mode = 'hosted' AND n.kind = 'file'`,
      [actor.tenantId],
    );
    if ((asNumber(usage[0]?.bytes) ?? 0) + size > deps.config.hostedQuotaBytes) {
      throw new HttpError(413, "quota", "Hosted storage is over the plan");
    }
  }
  const key = joinKey(String(folder.backend_key), name);
  const uploadId = crypto.randomUUID();
  const contentType = String(body.contentType ?? "application/octet-stream");
  const transport = deps.config.uploadTransport === "presigned" && adapter.presignPut ? "presigned" : "proxy";
  let multipartUploadId: string | null = null;
  let parts: { partNumber: number; url: string }[] | undefined;
  let url: string | undefined;
  let headers: Record<string, string> | undefined;
  if (transport === "presigned" && adapter instanceof S3Adapter && size > PART_SIZE) {
    const created = await adapter.createMultipart(key, contentType, PART_SIZE, size, 600);
    multipartUploadId = created.uploadId;
    parts = created.parts;
  } else if (transport === "presigned" && adapter.presignPut) {
    const signed = await adapter.presignPut(key, { contentType, expiresIn: 600 });
    url = signed.url;
    headers = signed.headers;
  }
  const now = deps.now();
  await deps.db.query(
    `INSERT INTO upload_sessions (id, tenant_id, drawer_id, folder_id, actor_user_id, backend_key, name, size, content_type, transport, multipart_upload_id, status, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,$13)`,
    [
      uploadId,
      actor.tenantId,
      drawerId,
      String(folder.id),
      actor.userId,
      key,
      name,
      size,
      contentType,
      transport,
      multipartUploadId,
      now.toISOString(),
      new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    ],
  );
  return { uploadId, transport, key, url, headers, parts, multipartUploadId: multipartUploadId ?? undefined };
}

async function openUpload(deps: Deps, uploadId: string, actor: Actor): Promise<Row> {
  const rows = await deps.db.query<Row>(`SELECT * FROM upload_sessions WHERE id = $1 AND tenant_id = $2`, [uploadId, actor.tenantId]);
  const session = rows[0];
  if (!session || String(session.status) !== "open") throw new HttpError(404, "not_found", "Upload not found");
  if (new Date(String(session.expires_at)).getTime() <= deps.now().getTime()) throw new HttpError(410, "expired", "Upload expired");
  return session;
}

export async function writeUpload(deps: Deps, actor: Actor, uploadId: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
  const session = await openUpload(deps, uploadId, actor);
  const folder = await loadNodeRow(deps, actor.tenantId, String(session.folder_id));
  await assertVerb(deps, actor, folder, "upload");
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(session.drawer_id));
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  await adapter.write(String(session.backend_key), body, size);
}

export async function completeUpload(deps: Deps, actor: Actor, uploadId: string, body: Record<string, unknown>): Promise<Node> {
  const session = await openUpload(deps, uploadId, actor);
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(session.drawer_id));
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  if (session.multipart_upload_id) {
    if (!(adapter instanceof S3Adapter)) throw new HttpError(400, "invalid", "Multipart completion is only for S3");
    const parts = Array.isArray(body.parts) ? (body.parts as { partNumber: number; etag: string }[]) : [];
    await adapter.completeMultipart(String(session.backend_key), String(session.multipart_upload_id), parts);
  }
  const stat = await adapter.stat(String(session.backend_key));
  const folder = await loadNodeRow(deps, actor.tenantId, String(session.folder_id));
  await assertVerb(deps, actor, folder, "upload");
  const node = await upsertNode(deps, {
    tenantId: actor.tenantId,
    drawerId: String(session.drawer_id),
    parentId: String(session.folder_id),
    backendKey: String(session.backend_key),
    kind: "file",
    name: String(session.name),
    size: stat.size ?? asNumber(session.size),
    contentType: stat.contentType ?? (session.content_type ? String(session.content_type) : null),
    modifiedAt: stat.modifiedAt ?? deps.now().toISOString(),
    incomplete: false,
  });
  await snapshotFileVersion(deps, actor, adapter, String(drawer.prefix), node);
  await deps.db.query(`UPDATE upload_sessions SET status = 'complete' WHERE id = $1`, [uploadId]);
  await recordActivity(deps, {
    tenantId: actor.tenantId,
    projectId: String(drawer.project_id),
    nodeId: node.id,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind: "upload",
    detail: { name: node.name, size: node.size },
  });
  return node;
}

export async function searchProject(deps: Deps, actor: MemberActor, projectId: string, q: string): Promise<SearchHit[]> {
  await requireProject(deps, actor, projectId);
  const term = q.trim();
  if (!term) return [];
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = await deps.db.query<Row>(
    `SELECT n.*, d.name AS drawer_name, d.project_id
     FROM nodes n
     JOIN drawers d ON d.id = n.drawer_id
     WHERE d.project_id = $1 AND d.tenant_id = $2 AND n.parent_id IS NOT NULL AND n.name ILIKE $3 ESCAPE '\\'
     ORDER BY n.name
     LIMIT 50`,
    [projectId, actor.tenantId, pattern],
  );
  return rows.map((row) => ({
    node: mapNode(row),
    drawerId: String(row.drawer_id),
    drawerName: String(row.drawer_name),
    projectId: String(row.project_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
  }));
}

export async function openContent(
  deps: Deps,
  actor: Actor,
  nodeId: string,
  verb: GrantVerb,
  range?: { start: number; end: number },
): Promise<{ stream: ReadableStream<Uint8Array>; node: Node; size: number }> {
  const row = await loadNodeRow(deps, actor.tenantId, nodeId);
  if (String(row.kind) !== "file") throw new HttpError(400, "invalid", "Choose a file");
  await assertVerb(deps, actor, row, verb);
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(row.drawer_id));
  const adapter = await openAdapter(deps, drawer, { requireOk: true });
  const stat = await adapter.stat(String(row.backend_key));
  const size = stat.size ?? asNumber(row.size) ?? 0;
  if (verb === "download") {
    await recordActivity(deps, {
      tenantId: actor.tenantId,
      projectId: String(drawer.project_id),
      nodeId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      kind: "download",
      detail: { name: String(row.name) },
    });
    if (actor.kind === "guest") {
      const { guestGrants } = await import("./access.js");
      const { coversKey } = await import("@storageflow/domain");
      const grants = await guestGrants(deps, actor);
      for (const grant of grants) {
        if (coversKey(grant.backendKey, String(row.backend_key), grant.nodeKind) && grant.verbs.includes("download")) {
          await deps.db.query(`UPDATE grants SET download_count = download_count + 1 WHERE id = $1`, [grant.id]);
        }
      }
    }
  }
  const stream = await adapter.read(String(row.backend_key), range);
  return { stream, node: mapNode(row), size };
}
