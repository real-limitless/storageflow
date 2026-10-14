import crypto from "node:crypto";
import { normalizePrefix, type FileVersionView, type Node } from "@storageflow/domain";
import type { StorageAdapter } from "@storageflow/storage";
import { HttpError, asNumber } from "../http.js";
import { mapFileVersion, mapNode, type Row } from "../mappers.js";
import { assertVerb, bindingFromRow, loadDrawerRow, loadNodeRow, recordAudit, type Actor, type Deps } from "./access.js";

export const VERSION_FOLDER = ".sf-versions";

export function versionObjectKey(prefix: string, nodeId: string, version: number): string {
  return `${normalizePrefix(prefix)}${VERSION_FOLDER}/${nodeId}/${version}`;
}

export function isVersionListingName(name: string): boolean {
  return name === VERSION_FOLDER;
}

async function copyObject(adapter: StorageAdapter, from: string, to: string): Promise<number> {
  const stat = await adapter.stat(from);
  const size = stat.size ?? 0;
  const stream = await adapter.read(from);
  await adapter.write(to, stream, size);
  return size;
}

async function retentionCount(deps: Deps, tenantId: string): Promise<number> {
  const rows = await deps.db.query<Row>(`SELECT version_retention FROM tenants WHERE id = $1`, [tenantId]);
  return asNumber(rows[0]?.version_retention) ?? 10;
}

async function pruneVersions(deps: Deps, adapter: StorageAdapter, tenantId: string, nodeId: string): Promise<void> {
  const keep = await retentionCount(deps, tenantId);
  const rows = await deps.db.query<Row>(
    `SELECT id, storage_key FROM file_versions WHERE node_id = $1 AND tenant_id = $2 ORDER BY version DESC`,
    [nodeId, tenantId],
  );
  for (const row of rows.slice(keep)) {
    try {
      await adapter.remove(String(row.storage_key), false);
    } catch {
      // The row still goes away so retention matches the table.
    }
    await deps.db.query(`DELETE FROM file_versions WHERE id = $1`, [String(row.id)]);
  }
}

export async function snapshotFileVersion(
  deps: Deps,
  actor: Actor,
  adapter: StorageAdapter,
  drawerPrefix: string,
  node: Node,
): Promise<void> {
  const current = await deps.db.query<Row>(`SELECT COALESCE(MAX(version), 0) AS max FROM file_versions WHERE node_id = $1`, [node.id]);
  const version = (asNumber(current[0]?.max) ?? 0) + 1;
  const storageKey = versionObjectKey(drawerPrefix, node.id, version);
  const size = await copyObject(adapter, node.backendKey, storageKey);
  await deps.db.query(
    `INSERT INTO file_versions (id, tenant_id, node_id, version, storage_key, size, author_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [crypto.randomUUID(), actor.tenantId, node.id, version, storageKey, size, actor.userId, deps.now().toISOString()],
  );
  await pruneVersions(deps, adapter, actor.tenantId, node.id);
}

async function fileRow(deps: Deps, actor: Actor, nodeId: string): Promise<{ row: Row; drawer: Row }> {
  const row = await loadNodeRow(deps, actor.tenantId, nodeId);
  if (String(row.kind) !== "file") throw new HttpError(400, "invalid", "Choose a file");
  const drawer = await loadDrawerRow(deps, actor.tenantId, String(row.drawer_id));
  return { row, drawer };
}

function adapterFor(deps: Deps, drawer: Row): StorageAdapter {
  return deps.adapters.forBinding(bindingFromRow(drawer, deps.config));
}

export async function listFileVersions(deps: Deps, actor: Actor, nodeId: string): Promise<FileVersionView[]> {
  const { row } = await fileRow(deps, actor, nodeId);
  await assertVerb(deps, actor, row, "list");
  const rows = await deps.db.query<Row>(
    `SELECT * FROM file_versions WHERE node_id = $1 AND tenant_id = $2 ORDER BY version ASC`,
    [nodeId, actor.tenantId],
  );
  return rows.map(mapFileVersion);
}

export async function openFileVersion(
  deps: Deps,
  actor: Actor,
  nodeId: string,
  version: number,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string; name: string }> {
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "invalid", "version is required");
  const { row, drawer } = await fileRow(deps, actor, nodeId);
  await assertVerb(deps, actor, row, "download");
  const versions = await deps.db.query<Row>(
    `SELECT * FROM file_versions WHERE node_id = $1 AND tenant_id = $2 AND version = $3`,
    [nodeId, actor.tenantId, version],
  );
  const stored = versions[0];
  if (!stored) throw new HttpError(404, "not_found", "Version not found");
  const adapter = adapterFor(deps, drawer);
  const stat = await adapter.stat(String(stored.storage_key));
  const size = stat.size ?? asNumber(stored.size) ?? 0;
  const stream = await adapter.read(String(stored.storage_key));
  return {
    stream,
    size,
    contentType: row.content_type ? String(row.content_type) : "application/octet-stream",
    name: String(row.name),
  };
}

export async function restoreFileVersion(deps: Deps, actor: Actor, nodeId: string, version: number): Promise<Node> {
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "invalid", "version is required");
  const { row, drawer } = await fileRow(deps, actor, nodeId);
  await assertVerb(deps, actor, row, "upload");
  const versions = await deps.db.query<Row>(
    `SELECT * FROM file_versions WHERE node_id = $1 AND tenant_id = $2 AND version = $3`,
    [nodeId, actor.tenantId, version],
  );
  const stored = versions[0];
  if (!stored) throw new HttpError(404, "not_found", "Version not found");
  const adapter = adapterFor(deps, drawer);
  const size = await copyObject(adapter, String(stored.storage_key), String(row.backend_key));
  const now = deps.now().toISOString();
  await deps.db.query(`UPDATE nodes SET size = $2, modified_at = $3, cached_at = $3 WHERE id = $1`, [nodeId, size, now]);
  const node = mapNode(await loadNodeRow(deps, actor.tenantId, nodeId));
  await snapshotFileVersion(deps, actor, adapter, String(drawer.prefix), node);
  await recordAudit(deps, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "version.restore",
    targetType: "node",
    targetId: nodeId,
    detail: { version, name: node.name },
  });
  return mapNode(await loadNodeRow(deps, actor.tenantId, nodeId));
}
