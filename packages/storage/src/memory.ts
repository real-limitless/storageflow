import { baseName, isInsidePrefix, normalizePrefix } from "@storageflow/domain";
import type { RemoteEntry, StorageAdapter } from "./types.js";

interface StoredObject {
  body: Uint8Array;
  modifiedAt: string;
  contentType: string;
}

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
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

export class MemoryAdapter implements StorageAdapter {
  readonly kind;
  private readonly objects = new Map<string, StoredObject>();
  readonly prefix: string;
  failWrites = false;
  offlineMessage: string | null = null;

  constructor(
    kind: StorageAdapter["kind"],
    prefix: string,
    options?: { failWrites?: boolean; offlineMessage?: string | null },
  ) {
    this.kind = kind;
    this.prefix = normalizePrefix(prefix);
    this.failWrites = options?.failWrites ?? false;
    this.offlineMessage = options?.offlineMessage ?? null;
  }

  private guard(key: string): void {
    if (!isInsidePrefix(this.prefix, key) && key !== this.prefix) {
      throw new Error("Key is outside the drawer prefix");
    }
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    if (this.offlineMessage) return { ok: false, message: this.offlineMessage };
    return { ok: true };
  }

  async list(prefix: string): Promise<RemoteEntry[]> {
    this.guard(prefix || this.prefix);
    const root = normalizePrefix(prefix || this.prefix);
    const folders = new Map<string, RemoteEntry>();
    const files: RemoteEntry[] = [];
    for (const [key, stored] of this.objects) {
      if (root && !key.startsWith(root)) continue;
      const rest = root ? key.slice(root.length) : key;
      if (!rest || rest === "") continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        files.push({
          key,
          name: baseName(key),
          kind: "file",
          size: stored.body.byteLength,
          modifiedAt: stored.modifiedAt,
          contentType: stored.contentType,
        });
        continue;
      }
      const name = rest.slice(0, slash);
      const folderKey = `${root}${name}/`;
      if (!folders.has(folderKey)) {
        folders.set(folderKey, { key: folderKey, name, kind: "prefix" });
      }
    }
    return [...folders.values(), ...files.filter((file) => !file.key.endsWith("/"))];
  }

  async stat(key: string): Promise<RemoteEntry> {
    this.guard(key);
    const stored = this.objects.get(key);
    if (!stored) throw new Error("Not found");
    return {
      key,
      name: baseName(key),
      kind: key.endsWith("/") ? "prefix" : "file",
      size: stored.body.byteLength,
      modifiedAt: stored.modifiedAt,
      contentType: stored.contentType,
    };
  }

  async mkdir(prefix: string): Promise<void> {
    const key = normalizePrefix(prefix);
    this.guard(key);
    if (!this.objects.has(key)) {
      this.objects.set(key, { body: new Uint8Array(), modifiedAt: new Date().toISOString(), contentType: "application/x-directory" });
    }
  }

  async write(key: string, body: ReadableStream<Uint8Array>, _size: number): Promise<void> {
    this.guard(key);
    const bytes = await readAll(body);
    this.objects.set(key, {
      body: bytes,
      modifiedAt: new Date().toISOString(),
      contentType: "application/octet-stream",
    });
    if (this.failWrites) throw new Error("connection reset");
  }

  async read(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    this.guard(key);
    const stored = this.objects.get(key);
    if (!stored) throw new Error("Not found");
    const start = range?.start ?? 0;
    const end = range?.end ?? stored.body.byteLength - 1;
    return streamFrom(stored.body.slice(start, end + 1));
  }

  private keysUnder(prefix: string): string[] {
    const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return [...this.objects.keys()].filter((key) => key === prefix || key.startsWith(root) || key === root);
  }

  async move(from: string, to: string): Promise<void> {
    this.guard(from);
    this.guard(to);
    if (from.endsWith("/")) {
      const dest = normalizePrefix(to);
      const keys = this.keysUnder(from);
      for (const key of keys) {
        const next = dest + key.slice(normalizePrefix(from).length);
        const stored = this.objects.get(key);
        if (!stored) continue;
        this.objects.set(next, stored);
        this.objects.delete(key);
      }
      return;
    }
    const stored = this.objects.get(from);
    if (!stored) throw new Error("Not found");
    this.objects.set(to, stored);
    this.objects.delete(from);
  }

  async remove(key: string, recursive: boolean): Promise<void> {
    this.guard(key);
    if (recursive || key.endsWith("/")) {
      for (const item of this.keysUnder(key)) this.objects.delete(item);
      return;
    }
    this.objects.delete(key);
  }
}
