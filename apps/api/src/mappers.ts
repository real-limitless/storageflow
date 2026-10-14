import type { ActivityEvent, AuditEvent, Drawer, FileVersionView, GrantVerb, JobSummary, Node, Preferences, Project, ProjectMember, TeamUser, TransferSettings, UserKind } from "@storageflow/domain";
import { asBool, asIso, asNumber, jsonField } from "./http.js";

export type Row = Record<string, unknown>;

export function mapProject(row: Row, role: Project["role"]): Project {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    kind: row.kind as Project["kind"],
    description: String(row.description ?? ""),
    color: (row.color as Project["color"]) ?? null,
    starred: asBool(row.starred),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    role,
  };
}

export function mapNode(row: Row): Node {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    drawerId: String(row.drawer_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    backendKey: String(row.backend_key),
    kind: row.kind as Node["kind"],
    name: String(row.name),
    size: asNumber(row.size),
    contentType: row.content_type ? String(row.content_type) : null,
    modifiedAt: asIso(row.modified_at),
    starred: asBool(row.starred),
    color: (row.color as Node["color"]) ?? null,
    sortOrder: asNumber(row.sort_order) ?? 0,
    incomplete: asBool(row.incomplete),
    cachedAt: asIso(row.cached_at) ?? new Date(0).toISOString(),
  };
}

export function mapJob(row: Row): JobSummary {
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: row.status as JobSummary["status"],
    progress: asNumber(row.progress) ?? 0,
    message: row.message ? String(row.message) : null,
    error: row.error ? String(row.error) : null,
  };
}

export function mapDrawer(row: Row, rootFolderId: string | null, jobs: JobSummary[]): Drawer {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    projectId: String(row.project_id),
    name: String(row.name),
    mode: row.mode as Drawer["mode"],
    backendKind: row.backend_kind as Drawer["backendKind"],
    sortOrder: asNumber(row.sort_order) ?? 0,
    color: (row.color as Drawer["color"]) ?? null,
    starred: asBool(row.starred),
    notes: String(row.notes ?? ""),
    endpoint: row.endpoint ? String(row.endpoint) : null,
    region: row.region ? String(row.region) : null,
    bucket: row.bucket ? String(row.bucket) : null,
    prefix: String(row.prefix ?? ""),
    pathStyle: asBool(row.path_style),
    accessKey: row.access_key ? String(row.access_key) : null,
    secretSet: Boolean(row.secret_cipher),
    healthOk: row.health_ok == null ? null : asBool(row.health_ok),
    healthMessage: row.health_message ? String(row.health_message) : null,
    healthCheckedAt: asIso(row.health_checked_at),
    cacheListedAt: asIso(row.cache_listed_at),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    rootFolderId,
    jobs,
  };
}

export function mapMember(row: Row): ProjectMember {
  return {
    userId: String(row.user_id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as ProjectMember["role"],
  };
}

export function mapActivity(row: Row): ActivityEvent {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    nodeId: row.node_id ? String(row.node_id) : null,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    kind: String(row.kind),
    detail: jsonField<Record<string, unknown>>(row.detail, {}),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapSettings(row: Row): TransferSettings {
  return {
    freeWaitSeconds: asNumber(row.free_wait_seconds) ?? 30,
    freeBytesPerSecond: asNumber(row.free_bytes_per_second) ?? 51200,
    freeDailyBytes: asNumber(row.free_daily_bytes) ?? 0,
    freeCooldownSeconds: asNumber(row.free_cooldown_seconds) ?? 60,
    paidBytesPerSecond: asNumber(row.paid_bytes_per_second) ?? 0,
    paidDailyBytes: asNumber(row.paid_daily_bytes) ?? 0,
    ticketTtlSeconds: asNumber(row.ticket_ttl_seconds) ?? 3600,
  };
}

export function defaultPreferences(): Preferences {
  return {
    paneSizes: { drawers: 22, folders: 26, files: 52 },
    viewMode: "grid",
    zoom: 2,
    lastProjectId: null,
    defaultProjectId: null,
    locationTabs: [],
    favoritesOnly: false,
    starredFirst: false,
  };
}

export function mapPreferences(row: Row | undefined): Preferences {
  if (!row) return defaultPreferences();
  const base = defaultPreferences();
  const sizes = jsonField(row.pane_sizes, base.paneSizes);
  return {
    paneSizes: {
      drawers: asNumber(sizes.drawers) ?? base.paneSizes.drawers,
      folders: asNumber(sizes.folders) ?? base.paneSizes.folders,
      files: asNumber(sizes.files) ?? base.paneSizes.files,
    },
    viewMode: row.view_mode === "list" || row.view_mode === "details" || row.view_mode === "grid" ? row.view_mode : "grid",
    zoom: Math.min(4, Math.max(1, asNumber(row.zoom) ?? 2)),
    lastProjectId: row.last_project_id ? String(row.last_project_id) : null,
    defaultProjectId: row.default_project_id ? String(row.default_project_id) : null,
    locationTabs: jsonField(row.location_tabs, []),
    favoritesOnly: asBool(row.favorites_only),
    starredFirst: asBool(row.starred_first),
  };
}

export function mapTeamUser(row: Row): TeamUser {
  const kind = String(row.kind) === "service" ? "service" : "user";
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    kind: kind as UserKind,
    role: String(row.role) === "owner" ? "owner" : "member",
    disabledAt: asIso(row.disabled_at),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapFileVersion(row: Row): FileVersionView {
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    version: asNumber(row.version) ?? 0,
    storageKey: String(row.storage_key),
    size: asNumber(row.size),
    authorUserId: row.author_user_id ? String(row.author_user_id) : null,
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapAudit(row: Row): AuditEvent {
  return {
    id: String(row.id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    action: String(row.action),
    targetType: row.target_type ? String(row.target_type) : null,
    targetId: row.target_id ? String(row.target_id) : null,
    detail: jsonField(row.detail, {}),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

export function verbsFromRow(row: Row): GrantVerb[] {
  const verbs: GrantVerb[] = [];
  if (asBool(row.can_list)) verbs.push("list");
  if (asBool(row.can_download)) verbs.push("download");
  if (asBool(row.can_upload)) verbs.push("upload");
  if (asBool(row.can_delete)) verbs.push("delete");
  if (asBool(row.can_reshare)) verbs.push("reshare");
  return verbs;
}
