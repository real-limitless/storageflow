import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  encryptionKey: Buffer;
  databaseUrl: string;
  hosted: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    configured: boolean;
  };
  hostedQuotaBytes: number;
  publicOrigin: string;
  secureCookie: boolean;
  scryptN: number;
  exposeMagicLink: boolean;
  allowPlanFlag: boolean;
  adminEmails: string[];
  uploadTransport: "presigned" | "proxy";
  adapterMode: "s3" | "memory";
  seedEmail: string;
  seedPassword: string;
  seedName: string;
  tenantSlug: string;
  tenantName: string;
  embeddingUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  answerUrl: string;
  answerApiKey: string;
  answerModel: string;
}

function readTenants(secretsDir: string, tenant: string): { accessKey: string; secretKey: string } {
  const file = path.join(secretsDir, "tenants.json");
  if (!fs.existsSync(file)) return { accessKey: "", secretKey: "" };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { access_key?: string; secret_key?: string }>;
  return {
    accessKey: parsed[tenant]?.access_key ?? "",
    secretKey: parsed[tenant]?.secret_key ?? "",
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const keyHex = env.APP_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters");
  }
  const tenantSlug = env.HOSTED_TENANT ?? "acme";
  const fromFile = readTenants(env.SECRETS_DIR ?? path.resolve("secrets"), tenantSlug);
  const accessKeyId = env.HOSTED_S3_ACCESS_KEY || fromFile.accessKey;
  const secretAccessKey = env.HOSTED_S3_SECRET_KEY || fromFile.secretKey;
  const uploadTransport = env.UPLOAD_TRANSPORT === "presigned" ? "presigned" : "proxy";
  return {
    encryptionKey: Buffer.from(keyHex, "hex"),
    databaseUrl: env.DATABASE_URL ?? "",
    hosted: {
      endpoint: env.HOSTED_S3_ENDPOINT ?? "http://127.0.0.1:8795",
      region: env.HOSTED_S3_REGION ?? "us-east-1",
      bucket: env.HOSTED_S3_BUCKET ?? "acme-plain",
      accessKeyId,
      secretAccessKey,
      forcePathStyle: (env.HOSTED_S3_PATH_STYLE ?? "1") !== "0",
      configured: Boolean(accessKeyId && secretAccessKey && (env.HOSTED_S3_ENDPOINT ?? env.HOSTED_S3_ACCESS_KEY ?? fromFile.accessKey)),
    },
    hostedQuotaBytes: Number(env.HOSTED_QUOTA_BYTES ?? 5 * 1024 * 1024 * 1024),
    publicOrigin: env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173",
    secureCookie: env.COOKIE_SECURE === "1",
    scryptN: Number(env.SCRYPT_N ?? 16384),
    exposeMagicLink: env.DEV_EXPOSE_MAGIC_LINK === "1",
    allowPlanFlag: env.ALLOW_PLAN_FLAG === "1",
    adminEmails: (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    uploadTransport,
    adapterMode: env.STORAGE_ADAPTER === "memory" ? "memory" : "s3",
    seedEmail: env.SEED_EMAIL ?? "",
    seedPassword: env.SEED_PASSWORD ?? "",
    seedName: env.SEED_NAME ?? "Ada",
    tenantSlug,
    tenantName: env.HOSTED_TENANT_NAME ?? "Acme",
    embeddingUrl: env.EMBEDDING_URL ?? "",
    embeddingApiKey: env.EMBEDDING_API_KEY ?? "",
    embeddingModel: env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    answerUrl: env.ANSWER_URL ?? "",
    answerApiKey: env.ANSWER_API_KEY ?? "",
    answerModel: env.ANSWER_MODEL ?? "gpt-4o-mini",
  };
}
