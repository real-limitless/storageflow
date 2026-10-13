import crypto from "node:crypto";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function secretToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function publicId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.randomBytes(12)].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function hashPassword(password: string, n: number): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: n, r: 8, p: 1 });
  return `scrypt$${n}$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, nRaw, rRaw, pRaw, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 32, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  });
  const expected = Buffer.from(hashHex, "hex");
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

export function encryptString(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptString(key: Buffer, payload: string): string {
  const [version, iv, tag, enc] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !enc) throw new Error("Unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "portal";
}
