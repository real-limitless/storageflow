const INVALID_NAME = /[\\/\0]/;

export function objectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed === "." || trimmed === "..") return "Name cannot be . or ..";
  if (INVALID_NAME.test(trimmed)) return "Name cannot contain / or \\";
  if (trimmed.length > 200) return "Name is too long";
  return null;
}

export function normalizePrefix(prefix: string): string {
  let value = prefix.trim().replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (value === "" || value === "/") return "";
  if (!value.endsWith("/")) value += "/";
  return value;
}

export function assertObjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || INVALID_NAME.test(trimmed)) {
    throw new Error("Invalid name");
  }
  return trimmed;
}

export function joinKey(prefix: string, name: string): string {
  return normalizePrefix(prefix) + assertObjectName(name);
}

export function baseName(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function parentPrefix(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? "" : trimmed.slice(0, index + 1);
}

export function isInsidePrefix(prefix: string, key: string): boolean {
  if (key.startsWith("/") || key.includes("\\") || key.split("/").includes("..")) return false;
  const root = normalizePrefix(prefix);
  if (root === "") return true;
  return key === root || key === root.slice(0, -1) || key.startsWith(root);
}

export function coversKey(grantKey: string, nodeKey: string, grantKind: "file" | "folder"): boolean {
  if (grantKind === "file") return nodeKey === grantKey;
  const prefix = grantKey.endsWith("/") ? grantKey : `${grantKey}/`;
  return nodeKey === grantKey || nodeKey === prefix.slice(0, -1) || nodeKey.startsWith(prefix);
}

export function isDescendantKey(ancestorKey: string, candidateKey: string): boolean {
  const prefix = ancestorKey.endsWith("/") ? ancestorKey : `${ancestorKey}/`;
  if (candidateKey === ancestorKey || candidateKey === prefix) return false;
  return candidateKey.startsWith(prefix);
}

export function replaceKeyPrefix(key: string, fromPrefix: string, toPrefix: string): string {
  const from = fromPrefix.endsWith("/") ? fromPrefix : `${fromPrefix}/`;
  const to = toPrefix.endsWith("/") ? toPrefix : `${toPrefix}/`;
  if (key === from.slice(0, -1)) return to.slice(0, -1);
  if (key.startsWith(from)) return to + key.slice(from.length);
  return key;
}

export function backendDisplayPath(bucket: string | null, key: string): string {
  const bucketName = bucket || "bucket";
  return `s3://${bucketName}/${key}`;
}

export function extensionOf(name: string): string {
  const base = name.split("/").pop() ?? name;
  const index = base.lastIndexOf(".");
  if (index <= 0) return "";
  return base.slice(index + 1).toLowerCase();
}

export function typeLabel(name: string): string {
  const extension = extensionOf(name);
  return extension ? extension : "unknown";
}
