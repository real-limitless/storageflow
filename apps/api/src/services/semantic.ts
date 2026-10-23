import crypto from "node:crypto";
import { scopeAllows, verbsForNode, type GrantCheck, type RagAnswer, type SearchHit } from "@storageflow/domain";
import { EMBEDDING_DIMENSIONS, fitDimensions, vectorLiteral, type Passage } from "../embed.js";
import { HttpError } from "../http.js";
import { runtimeEvent } from "../log.js";
import { mapNode, verbsFromRow, type Row } from "../mappers.js";
import { bindingFromRow, loadDrawerRow, loadNodeRow, type Deps, type MemberActor } from "./access.js";

const MIN_SCORE = 0.35;
const CHUNK_SIZE = 800;
const MAX_CHUNKS = 8;
/** Attempts after the first unreachable embedding call, then a backfill probe takes over. */
export const EMBEDDING_RETRY_DELAYS_MS = [250, 1000, 4000];
/** Probe cadence once retries are exhausted. The last delay repeats until embeddings work. */
export const EMBEDDING_BACKFILL_DELAYS_MS = [2000, 5000, 15000, 30000];

interface RecoveryState {
  probeScheduled: boolean;
  probeAttempt: number;
}

const recoveryByDeps = new WeakMap<Deps, RecoveryState>();

interface SearchAccess {
  kind: "project" | "grants" | "none";
  grants: GrantCheck[];
}

async function searchAccess(deps: Deps, actor: MemberActor, projectId: string): Promise<SearchAccess> {
  const projects = await deps.db.query<Row>(`SELECT id FROM projects WHERE id = $1 AND tenant_id = $2`, [projectId, actor.tenantId]);
  if (!projects[0]) throw new HttpError(404, "not_found", "Project not found");
  if (actor.scopes && !scopeAllows(actor.scopes, "list")) return { kind: "none", grants: [] };
  if (actor.tenantRole === "owner") return { kind: "project", grants: [] };
  const members = await deps.db.query<Row>(`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, actor.userId]);
  if (members[0]) return { kind: "project", grants: [] };
  const grants = await grantsForMember(deps, actor, projectId);
  if (!grants.length) return { kind: "none", grants: [] };
  return { kind: "grants", grants };
}

async function grantsForMember(deps: Deps, actor: MemberActor, projectId: string): Promise<GrantCheck[]> {
  const rows = await deps.db.query<Row>(
    `SELECT g.*, n.backend_key, n.kind AS node_kind
     FROM grants g
     JOIN nodes n ON n.id = g.node_id
     WHERE g.tenant_id = $1
       AND g.project_id = $2
       AND g.can_list = true
       AND g.password_hash IS NULL
       AND (
         g.grantee_user_id = $3
         OR lower(COALESCE(g.grantee_email, '')) = lower($4)
       )`,
    [actor.tenantId, projectId, actor.userId, actor.email],
  );
  return rows.map((row) => ({
    backendKey: String(row.backend_key),
    nodeKind: String(row.node_kind) === "file" ? "file" : "folder",
    verbs: verbsFromRow(row),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    downloadCap: null,
    downloadCount: 0,
  }));
}

function canList(access: SearchAccess, backendKey: string, now: Date): boolean {
  if (access.kind === "project") return true;
  if (access.kind === "none") return false;
  return verbsForNode(access.grants, backendKey, now).includes("list");
}

function deny(): never {
  throw new HttpError(403, "forbidden", "You do not have access to search this cabinet");
}

async function nearest(deps: Deps, actor: MemberActor, projectId: string, text: string, access: SearchAccess): Promise<SearchHit[]> {
  const term = text.trim();
  if (!term) return [];
  const [embedded] = await deps.embedder.embed([term]);
  const fitted = fitDimensions(embedded ?? [], EMBEDDING_DIMENSIONS);
  if (fitted.every((value) => value === 0)) return [];
  const rows = await deps.db.query<Row>(
    `SELECT n.id, n.tenant_id, n.drawer_id, n.parent_id, n.backend_key, n.kind, n.name,
            n.size, n.content_type, n.modified_at, n.starred, n.color, n.sort_order,
            n.incomplete, n.cached_at,
            d.name AS drawer_name,
            d.project_id AS hit_project_id,
            e.content AS snippet,
            (1 - (e.embedding <=> $3::vector)) AS score
     FROM embeddings e
     JOIN nodes n ON n.id = e.node_id
     JOIN drawers d ON d.id = n.drawer_id
     WHERE e.project_id = $1 AND e.tenant_id = $2 AND n.parent_id IS NOT NULL
     ORDER BY e.embedding <=> $3::vector
     LIMIT 40`,
    [projectId, actor.tenantId, vectorLiteral(fitted)],
  );
  const best = new Map<string, SearchHit>();
  for (const row of rows) {
    const score = Number(row.score);
    if (!Number.isFinite(score) || score < MIN_SCORE) continue;
    if (!canList(access, String(row.backend_key), deps.now())) continue;
    const hit: SearchHit = {
      node: mapNode(row),
      drawerId: String(row.drawer_id),
      drawerName: String(row.drawer_name),
      projectId: String(row.hit_project_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      snippet: String(row.snippet ?? "").slice(0, 280),
      score,
    };
    const current = best.get(hit.node.id);
    if (!current || (hit.score ?? 0) > (current.score ?? 0)) best.set(hit.node.id, hit);
  }
  return [...best.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 20);
}

export async function semanticSearch(deps: Deps, actor: MemberActor, projectId: string, q: string): Promise<SearchHit[]> {
  const access = await searchAccess(deps, actor, projectId);
  if (access.kind === "none") deny();
  return nearest(deps, actor, projectId, q, access);
}

export async function answerQuestion(deps: Deps, actor: MemberActor, projectId: string, body: Record<string, unknown>): Promise<RagAnswer> {
  const question = String(body.question ?? "").trim();
  if (!question) throw new HttpError(400, "invalid", "question is required");
  const access = await searchAccess(deps, actor, projectId);
  if (access.kind === "none") deny();
  const hits = await nearest(deps, actor, projectId, question, access);
  const passages: Passage[] = hits.slice(0, 4).map((hit) => ({
    name: hit.node.name,
    content: hit.snippet ?? hit.node.name,
  }));
  const answer = await deps.answerer.answer(question, passages);
  return { answer, hits };
}

interface IndexTarget {
  tenantId: string;
  projectId: string;
  drawerId: string;
  nodeId: string;
}

export async function indexUploadedFile(deps: Deps, input: IndexTarget): Promise<void> {
  await indexRecovering(deps, input, 0);
}

async function indexRecovering(deps: Deps, input: IndexTarget, attempt: number): Promise<void> {
  try {
    await indexOnce(deps, input);
    await backfillUnindexed(deps);
  } catch (error) {
    if (!isEmbedderUnavailable(error)) throw error;
    const delay = EMBEDDING_RETRY_DELAYS_MS[attempt];
    if (delay == null) {
      deps.logger?.write(
        runtimeEvent(deps.config, deps.now(), "embedding.unavailable", "failure", "Embedding endpoint is down; unindexed files will be backfilled when it recovers"),
      );
      scheduleBackfill(deps);
      return;
    }
    void sleep(deps, delay).then(() => {
      deps.jobs.enqueue(() => indexRecovering(deps, input, attempt + 1));
    });
  }
}

/** Index file nodes that never received an embedding, once the endpoint answers. */
export async function backfillUnindexed(deps: Deps): Promise<void> {
  const rows = await deps.db.query<Row>(
    `SELECT n.id AS node_id, n.tenant_id, n.drawer_id, d.project_id
     FROM nodes n
     JOIN drawers d ON d.id = n.drawer_id
     WHERE n.kind = 'file' AND n.parent_id IS NOT NULL AND n.incomplete = false
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.node_id = n.id)
     ORDER BY n.cached_at`,
  );
  for (const row of rows) {
    const input: IndexTarget = {
      tenantId: String(row.tenant_id),
      projectId: String(row.project_id),
      drawerId: String(row.drawer_id),
      nodeId: String(row.node_id),
    };
    try {
      await indexOnce(deps, input);
    } catch (error) {
      if (isEmbedderUnavailable(error)) {
        scheduleBackfill(deps);
        return;
      }
      deps.logger?.write(
        runtimeEvent(deps.config, deps.now(), "embedding.index", "failure", error instanceof Error ? error.message : "Embedding index failed"),
      );
    }
  }
}

/** Probe for unindexed files. A down endpoint schedules the next probe with backoff. */
export function watchUnindexedEmbeddings(deps: Deps): void {
  deps.jobs.enqueue(() => probeAndBackfill(deps));
}

function scheduleBackfill(deps: Deps): void {
  const state = recoveryState(deps);
  if (state.probeScheduled) return;
  state.probeScheduled = true;
  const delay = EMBEDDING_BACKFILL_DELAYS_MS[Math.min(state.probeAttempt, EMBEDDING_BACKFILL_DELAYS_MS.length - 1)];
  void sleep(deps, delay).then(() => {
    state.probeScheduled = false;
    deps.jobs.enqueue(() => probeAndBackfill(deps));
  });
}

async function probeAndBackfill(deps: Deps): Promise<void> {
  const state = recoveryState(deps);
  try {
    await deps.embedder.embed(["."]);
  } catch (error) {
    if (!isEmbedderUnavailable(error)) throw error;
    state.probeAttempt += 1;
    scheduleBackfill(deps);
    return;
  }
  state.probeAttempt = 0;
  await backfillUnindexed(deps);
}

function recoveryState(deps: Deps): RecoveryState {
  const existing = recoveryByDeps.get(deps);
  if (existing) return existing;
  const created = { probeScheduled: false, probeAttempt: 0 };
  recoveryByDeps.set(deps, created);
  return created;
}

function sleep(deps: Deps, ms: number): Promise<void> {
  if (deps.sleep) return deps.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** Network failures and embedding HTTP 5xx are retried. A 4xx is the caller's error. */
export function isEmbedderUnavailable(error: unknown): boolean {
  return embedderDown(error, new Set());
}

function embedderDown(error: unknown, seen: Set<unknown>): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const record = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown; status?: unknown; name?: unknown };
  if (typeof record.code === "string" && (RETRYABLE_NETWORK_CODES.has(record.code) || record.code.includes("TIMEOUT"))) return true;
  if (typeof record.status === "number" && record.status >= 500 && record.status <= 599) return true;
  if (typeof record.name === "string" && record.name.endsWith("TimeoutError")) return true;
  if (typeof record.message === "string") {
    if (/\b(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT)\b/.test(record.message)) return true;
    if (/timeout/i.test(record.message)) return true;
    if (/Embedding request failed \((5\d\d)\)/.test(record.message)) return true;
  }
  if (Array.isArray(record.errors) && record.errors.some((item) => embedderDown(item, seen))) return true;
  return embedderDown(record.cause, seen);
}

async function indexOnce(deps: Deps, input: IndexTarget): Promise<void> {
  const node = await loadNodeRow(deps, input.tenantId, input.nodeId);
  if (String(node.kind) !== "file") return;
  const drawer = await loadDrawerRow(deps, input.tenantId, input.drawerId);
  const adapter = deps.adapters.forBinding(bindingFromRow(drawer, deps.config));
  let body = "";
  try {
    const stream = await adapter.read(String(node.backend_key));
    body = textFromBytes(await readBytes(stream));
  } catch {
    body = "";
  }
  const name = String(node.name);
  const readable = body.trim() || name;
  const embedded = chunksOf(body.trim() ? `${name}\n${readable}` : name);
  const shown = chunksOf(readable);
  if (!embedded.length) return;
  const vectors = await deps.embedder.embed(embedded);
  const now = deps.now().toISOString();
  await deps.db.query(`DELETE FROM embeddings WHERE node_id = $1`, [input.nodeId]);
  for (let index = 0; index < embedded.length; index += 1) {
    const vector = fitDimensions(vectors[index] ?? [], EMBEDDING_DIMENSIONS);
    await deps.db.query(
      `INSERT INTO embeddings (id, tenant_id, project_id, node_id, chunk_index, content, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)`,
      [crypto.randomUUID(), input.tenantId, input.projectId, input.nodeId, index, shown[index] ?? embedded[index], vectorLiteral(vector), now],
    );
  }
}

function chunksOf(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];
  const parts: string[] = [];
  const step = CHUNK_SIZE - 100;
  for (let index = 0; index < clean.length && parts.length < MAX_CHUNKS; index += step) {
    parts.push(clean.slice(index, index + CHUNK_SIZE));
  }
  return parts;
}

function textFromBytes(bytes: Uint8Array): string {
  if (!bytes.byteLength || bytes.byteLength > 1_000_000 || bytes.includes(0)) return "";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!text || text.includes("\uFFFD")) return "";
  let printable = 0;
  for (const char of text) {
    if (char === "\n" || char === "\t" || char === "\r" || (char >= " " && char <= "~")) printable += 1;
  }
  if (printable / text.length < 0.9) return "";
  return text;
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    length += next.value.byteLength;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
