export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid", "Expected an object");
  }
  return value as Record<string, unknown>;
}

export function requiredString(source: Record<string, unknown>, field: string, max = 200): string {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "invalid", `${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, "invalid", `${field} is too long`);
  return trimmed;
}

export function optionalString(source: Record<string, unknown>, field: string, max = 2000): string | undefined {
  const value = source[field];
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new HttpError(400, "invalid", `${field} must be a string`);
  if (value.length > max) throw new HttpError(400, "invalid", `${field} is too long`);
  return value.trim();
}

export function jsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function asIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return null;
}

export function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
