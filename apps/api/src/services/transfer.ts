import crypto from "node:crypto";
import {
  chunkDelayMs,
  cooldownRemaining,
  dailyRemaining,
  limitsFor,
  ticketWindow,
  type PublicPublication,
  type TicketView,
  type TransferPlan,
  type TransferSettings,
  type Visibility,
} from "@storageflow/domain";
import { publicId } from "../crypto.js";
import { HttpError, asIso, asNumber } from "../http.js";
import { mapSettings, type Row } from "../mappers.js";
import { loadNodeRow, recordActivity, requireProject, type Deps, type MemberActor } from "./access.js";
import { openAdapter } from "./cabinet.js";

export function throttleStream(
  source: ReadableStream<Uint8Array>,
  bytesPerSecond: number,
  maxBytes: number,
  hooks: { onBytes?: (count: number) => void; onDone?: () => void },
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let sent = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    hooks.onDone?.();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (maxBytes <= 0 || sent >= maxBytes) {
        controller.close();
        finish();
        return;
      }
      const next = await reader.read();
      if (next.done) {
        controller.close();
        finish();
        return;
      }
      let value = next.value;
      if (sent + value.byteLength > maxBytes) value = value.slice(0, maxBytes - sent);
      sent += value.byteLength;
      hooks.onBytes?.(value.byteLength);
      controller.enqueue(value);
      const wait = chunkDelayMs(value.byteLength, bytesPerSecond);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    },
    cancel() {
      finish();
      return reader.cancel();
    },
  });
}

async function settingsFor(deps: Deps, tenantId: string): Promise<TransferSettings> {
  const rows = await deps.db.query<Row>(`SELECT * FROM transfer_settings WHERE tenant_id = $1`, [tenantId]);
  if (!rows[0]) throw new HttpError(404, "not_found", "Transfer settings are missing");
  return mapSettings(rows[0]);
}

export async function publishFile(deps: Deps, actor: MemberActor, nodeId: string, body: Record<string, unknown>) {
  const node = await loadNodeRow(deps, actor.tenantId, nodeId);
  if (String(node.kind) !== "file") throw new HttpError(400, "invalid", "Publish a file");
  const drawer = await deps.db.query<Row>(`SELECT * FROM drawers WHERE id = $1`, [String(node.drawer_id)]);
  await requireProject(deps, actor, String(drawer[0].project_id));
  const visibility: Visibility = body.visibility === "public" ? "public" : "unlisted";
  const title = String(body.title ?? node.name).trim() || String(node.name);
  const note = String(body.note ?? "");
  const existing = await deps.db.query<Row>(`SELECT * FROM publications WHERE node_id = $1 AND unpublished_at IS NULL`, [nodeId]);
  const now = deps.now().toISOString();
  let row: Row;
  if (existing[0]) {
    await deps.db.query(`UPDATE publications SET title = $2, visibility = $3, note = $4 WHERE id = $1`, [String(existing[0].id), title, visibility, note]);
    const rows = await deps.db.query<Row>(`SELECT * FROM publications WHERE id = $1`, [String(existing[0].id)]);
    row = rows[0];
  } else {
    const id = crypto.randomUUID();
    await deps.db.query(
      `INSERT INTO publications (id, public_id, tenant_id, project_id, node_id, title, visibility, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, publicId(), actor.tenantId, String(drawer[0].project_id), nodeId, title, visibility, note, now],
    );
    const rows = await deps.db.query<Row>(`SELECT * FROM publications WHERE id = $1`, [id]);
    row = rows[0];
  }
  await recordActivity(deps, {
    tenantId: actor.tenantId,
    projectId: String(drawer[0].project_id),
    nodeId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind: "publish",
    detail: { publicId: String(row.public_id), visibility },
  });
  return presentPublication(row, node);
}

function presentPublication(row: Row, node: Row) {
  return {
    id: String(row.id),
    publicId: String(row.public_id),
    nodeId: String(row.node_id),
    title: String(row.title),
    visibility: String(row.visibility) as Visibility,
    note: String(row.note ?? ""),
    downloadCount: asNumber(row.download_count) ?? 0,
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    fileName: String(node.name),
    size: asNumber(node.size),
    unpublishedAt: asIso(row.unpublished_at),
  };
}

export async function unpublish(deps: Deps, actor: MemberActor, publicationId: string): Promise<void> {
  const rows = await deps.db.query<Row>(`SELECT * FROM publications WHERE id = $1 AND tenant_id = $2`, [publicationId, actor.tenantId]);
  const publication = rows[0];
  if (!publication) throw new HttpError(404, "not_found", "Publication not found");
  await requireProject(deps, actor, String(publication.project_id));
  const now = deps.now().toISOString();
  await deps.db.query(`UPDATE publications SET unpublished_at = $2 WHERE id = $1`, [publicationId, now]);
  await deps.db.query(`UPDATE tickets SET status = 'revoked' WHERE publication_id = $1`, [publicationId]);
  await recordActivity(deps, {
    tenantId: actor.tenantId,
    projectId: String(publication.project_id),
    nodeId: String(publication.node_id),
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind: "unpublish",
    detail: { publicId: String(publication.public_id) },
  });
}

export async function publicMetadata(deps: Deps, publicIdValue: string): Promise<PublicPublication> {
  const rows = await deps.db.query<Row>(
    `SELECT p.*, n.name AS file_name, n.size FROM publications p JOIN nodes n ON n.id = p.node_id WHERE p.public_id = $1`,
    [publicIdValue],
  );
  const row = rows[0];
  if (!row || row.unpublished_at) throw new HttpError(404, "not_found", "This file is not published");
  return {
    publicId: String(row.public_id),
    title: String(row.title),
    note: String(row.note ?? ""),
    size: asNumber(row.size),
    fileName: String(row.file_name),
    publishedAt: asIso(row.created_at) ?? deps.now().toISOString(),
    downloadCount: asNumber(row.download_count) ?? 0,
    visibility: String(row.visibility) as Visibility,
  };
}

export async function catalog(deps: Deps, tenantSlug: string) {
  const tenants = await deps.db.query<Row>(`SELECT id, name FROM tenants WHERE slug = $1`, [tenantSlug]);
  if (!tenants[0]) throw new HttpError(404, "not_found", "Workspace not found");
  const rows = await deps.db.query<Row>(
    `SELECT p.public_id, p.title, p.created_at, p.download_count, n.name AS file_name, n.size
     FROM publications p JOIN nodes n ON n.id = p.node_id
     WHERE p.tenant_id = $1 AND p.visibility = 'public' AND p.unpublished_at IS NULL
     ORDER BY p.created_at DESC`,
    [String(tenants[0].id)],
  );
  return {
    tenant: { slug: tenantSlug, name: String(tenants[0].name) },
    files: rows.map((row) => ({
      publicId: String(row.public_id),
      title: String(row.title),
      size: asNumber(row.size),
      fileName: String(row.file_name),
      publishedAt: asIso(row.created_at) ?? deps.now().toISOString(),
      downloadCount: asNumber(row.download_count) ?? 0,
    })),
  };
}

export async function createTicket(deps: Deps, publicIdValue: string, visitorToken: string, plan: TransferPlan, userId: string | null): Promise<TicketView> {
  const rows = await deps.db.query<Row>(`SELECT * FROM publications WHERE public_id = $1`, [publicIdValue]);
  const publication = rows[0];
  if (!publication || publication.unpublished_at) throw new HttpError(404, "not_found", "This file is not published");
  const settings = await settingsFor(deps, String(publication.tenant_id));
  const limits = limitsFor(plan, settings);
  const now = deps.now();
  if (limits.cooldownSeconds > 0) {
    const previous = await deps.db.query<Row>(
      `SELECT created_at FROM tickets WHERE visitor_hash = $1 AND plan = 'free' ORDER BY created_at DESC LIMIT 1`,
      [visitorToken],
    );
    const last = previous[0]?.created_at ? new Date(String(previous[0].created_at)) : null;
    const wait = cooldownRemaining(now, last, limits.cooldownSeconds);
    if (wait > 0) throw new HttpError(429, "cooldown", "Wait before starting another free download", { retryAfterMs: wait });
  }
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const usedRows = await deps.db.query<Row>(
    `SELECT COALESCE(SUM(bytes_sent), 0) AS used FROM tickets WHERE visitor_hash = $1 AND plan = $2 AND created_at >= $3`,
    [visitorToken, plan, since],
  );
  const remaining = dailyRemaining(asNumber(usedRows[0]?.used) ?? 0, limits.dailyBytes);
  if (remaining <= 0) throw new HttpError(429, "daily_cap", "Daily download limit reached");
  const window = ticketWindow(now, limits);
  const id = crypto.randomUUID();
  await deps.db.query(
    `INSERT INTO tickets (id, publication_id, visitor_hash, user_id, plan, created_at, ready_at, expires_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
    [id, String(publication.id), visitorToken, userId, plan, now.toISOString(), window.readyAt.toISOString(), window.expiresAt.toISOString()],
  );
  await recordActivity(deps, {
    tenantId: String(publication.tenant_id),
    projectId: String(publication.project_id),
    nodeId: String(publication.node_id),
    actorUserId: userId,
    kind: "ticket-start",
    detail: { publicId: publicIdValue, plan },
  });
  return {
    id,
    plan,
    readyAt: window.readyAt.toISOString(),
    expiresAt: window.expiresAt.toISOString(),
    waitSeconds: limits.waitSeconds,
    bytesPerSecond: limits.bytesPerSecond,
    status: "open",
  };
}

export async function readTicket(deps: Deps, ticketId: string, visitorHash: string): Promise<TicketView> {
  const ticket = await loadTicket(deps, ticketId, visitorHash);
  const publication = await deps.db.query<Row>(`SELECT tenant_id FROM publications WHERE id = $1`, [String(ticket.publication_id)]);
  const settings = await settingsFor(deps, String(publication[0].tenant_id));
  const limits = limitsFor(String(ticket.plan) as TransferPlan, settings);
  return {
    id: String(ticket.id),
    plan: String(ticket.plan) as TransferPlan,
    readyAt: asIso(ticket.ready_at) ?? deps.now().toISOString(),
    expiresAt: asIso(ticket.expires_at) ?? deps.now().toISOString(),
    waitSeconds: limits.waitSeconds,
    bytesPerSecond: limits.bytesPerSecond,
    status: String(ticket.status),
  };
}

async function loadTicket(deps: Deps, ticketId: string, visitorHash: string): Promise<Row> {
  const rows = await deps.db.query<Row>(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
  const ticket = rows[0];
  if (!ticket || String(ticket.visitor_hash) !== visitorHash) throw new HttpError(404, "not_found", "Ticket not found");
  return ticket;
}

export async function streamTicket(deps: Deps, ticketId: string, visitorHash: string): Promise<{ stream: ReadableStream<Uint8Array>; fileName: string; contentType: string; size: number }> {
  const ticket = await loadTicket(deps, ticketId, visitorHash);
  const publications = await deps.db.query<Row>(`SELECT * FROM publications WHERE id = $1`, [String(ticket.publication_id)]);
  const publication = publications[0];
  if (!publication || publication.unpublished_at || String(ticket.status) === "revoked") {
    throw new HttpError(410, "unpublished", "This file is no longer published");
  }
  const now = deps.now();
  if (new Date(String(ticket.expires_at)).getTime() <= now.getTime()) throw new HttpError(410, "expired", "This ticket has expired");
  if (new Date(String(ticket.ready_at)).getTime() > now.getTime()) {
    throw new HttpError(425, "waiting", "The free download has not started", { readyAt: asIso(ticket.ready_at) });
  }
  const settings = await settingsFor(deps, String(publication.tenant_id));
  const plan = String(ticket.plan) as TransferPlan;
  const limits = limitsFor(plan, settings);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const usedRows = await deps.db.query<Row>(
    `SELECT COALESCE(SUM(bytes_sent), 0) AS used FROM tickets WHERE visitor_hash = $1 AND plan = $2 AND created_at >= $3 AND id <> $4`,
    [visitorHash, plan, since, ticketId],
  );
  const already = asNumber(ticket.bytes_sent) ?? 0;
  const remaining = dailyRemaining((asNumber(usedRows[0]?.used) ?? 0) + already, limits.dailyBytes);
  if (remaining <= 0) throw new HttpError(429, "daily_cap", "Daily download limit reached");
  const node = await loadNodeRow(deps, String(publication.tenant_id), String(publication.node_id));
  const drawer = await deps.db.query<Row>(`SELECT * FROM drawers WHERE id = $1`, [String(node.drawer_id)]);
  const adapter = await openAdapter(deps, drawer[0]);
  const stat = await adapter.stat(String(node.backend_key));
  const size = Math.min(stat.size ?? asNumber(node.size) ?? remaining, remaining);
  let release = async () => {};
  if (plan === "free") {
    const locked = await deps.db.query(`UPDATE tickets SET active_connection = true WHERE id = $1 AND active_connection = false RETURNING id`, [ticketId]);
    if (locked.length === 0) throw new HttpError(409, "connection_open", "This free ticket already has a connection");
    let released = false;
    release = async () => {
      if (released) return;
      released = true;
      await deps.db.query(`UPDATE tickets SET active_connection = false WHERE id = $1`, [ticketId]);
    };
  }
  await deps.db.query(`UPDATE publications SET download_count = download_count + 1 WHERE id = $1`, [String(publication.id)]);
  let source: ReadableStream<Uint8Array>;
  try {
    source = await adapter.read(String(node.backend_key));
  } catch (error) {
    await release();
    throw error;
  }
  const stream = throttleStream(source, limits.bytesPerSecond, size, {
    onBytes: (count) => {
      void deps.db.query(`UPDATE tickets SET bytes_sent = bytes_sent + $2 WHERE id = $1`, [ticketId, count]);
    },
    onDone: () => {
      void release();
    },
  });
  return {
    stream,
    fileName: String(node.name),
    contentType: node.content_type ? String(node.content_type) : "application/octet-stream",
    size,
  };
}

export async function reportAbuse(deps: Deps, publicIdValue: string, note: string): Promise<void> {
  const rows = await deps.db.query<Row>(`SELECT * FROM publications WHERE public_id = $1`, [publicIdValue]);
  const publication = rows[0];
  if (!publication) throw new HttpError(404, "not_found", "This file is not published");
  await deps.db.query(`INSERT INTO abuse_reports (id, publication_id, tenant_id, note, created_at) VALUES ($1,$2,$3,$4,$5)`, [
    crypto.randomUUID(),
    String(publication.id),
    String(publication.tenant_id),
    note,
    deps.now().toISOString(),
  ]);
  await recordActivity(deps, {
    tenantId: String(publication.tenant_id),
    projectId: String(publication.project_id),
    nodeId: String(publication.node_id),
    kind: "abuse-report",
    detail: { publicId: publicIdValue, note },
  });
}

export async function updateTransferSettings(deps: Deps, actor: MemberActor, body: Record<string, unknown>): Promise<TransferSettings> {
  if (actor.tenantRole !== "owner") throw new HttpError(403, "forbidden", "Only an owner can change transfer limits");
  const current = await settingsFor(deps, actor.tenantId);
  const next = {
    freeWaitSeconds: numberField(body, "freeWaitSeconds", current.freeWaitSeconds),
    freeBytesPerSecond: numberField(body, "freeBytesPerSecond", current.freeBytesPerSecond),
    freeDailyBytes: numberField(body, "freeDailyBytes", current.freeDailyBytes),
    freeCooldownSeconds: numberField(body, "freeCooldownSeconds", current.freeCooldownSeconds),
    paidBytesPerSecond: numberField(body, "paidBytesPerSecond", current.paidBytesPerSecond),
    paidDailyBytes: numberField(body, "paidDailyBytes", current.paidDailyBytes),
    ticketTtlSeconds: numberField(body, "ticketTtlSeconds", current.ticketTtlSeconds),
  };
  await deps.db.query(
    `UPDATE transfer_settings SET free_wait_seconds = $2, free_bytes_per_second = $3, free_daily_bytes = $4, free_cooldown_seconds = $5,
      paid_bytes_per_second = $6, paid_daily_bytes = $7, ticket_ttl_seconds = $8 WHERE tenant_id = $1`,
    [actor.tenantId, next.freeWaitSeconds, next.freeBytesPerSecond, next.freeDailyBytes, next.freeCooldownSeconds, next.paidBytesPerSecond, next.paidDailyBytes, next.ticketTtlSeconds],
  );
  return next;
}

function numberField(body: Record<string, unknown>, key: string, fallback: number): number {
  if (body[key] == null) return fallback;
  const value = Number(body[key]);
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "invalid", `${key} must be a number`);
  return value;
}
