import { LABEL_COLORS, PROJECT_KINDS, VIEW_MODES } from "@storageflow/domain";
import { z } from "zod";
import { HttpError } from "./http.js";

const color = z.union([z.enum(LABEL_COLORS), z.literal(""), z.literal("none"), z.null()]);
const limitNumber = z.number().finite().nonnegative();

export const emptySchema = z.object({});

export const signUpSchema = z.object({
  email: z.string().max(320),
  password: z.string().max(1000),
  name: z.string().max(500).optional(),
});

export const signInSchema = z.object({
  email: z.string().max(320),
  password: z.string().max(1000),
});

export const magicSchema = z.object({
  email: z.string().max(320),
});

export const magicConsumeSchema = z.object({
  token: z.string().max(500),
});

export const mfaSchema = z.object({
  challenge: z.string().max(500),
  code: z.string().max(40),
});

export const tenantSwitchSchema = z.object({
  tenantId: z.string().max(80),
});

export const tenantSchema = z.object({
  name: z.string().max(200),
  slug: z.string().max(80).optional(),
});

export const mfaConfirmSchema = z.object({
  code: z.string().max(40),
});

export const profileSchema = z.object({
  name: z.string().max(500).optional(),
});

export const planSchema = z.object({
  plan: z.enum(["free", "paid"]).optional(),
});

export const preferencesSchema = z.object({
  paneSizes: z
    .object({
      drawers: z.number().finite().optional(),
      folders: z.number().finite().optional(),
      files: z.number().finite().optional(),
    })
    .optional(),
  viewMode: z.enum(VIEW_MODES).optional(),
  zoom: z.number().finite().optional(),
  lastProjectId: z.string().max(80).nullable().optional(),
  defaultProjectId: z.string().max(80).nullable().optional(),
  locationTabs: z
    .array(
      z.object({
        id: z.string().max(200),
        url: z.string().max(2000),
        title: z.string().max(500),
        projectId: z.string().max(80).optional(),
        select: z.string().max(80).optional(),
      }),
    )
    .max(50)
    .optional(),
  favoritesOnly: z.boolean().optional(),
  starredFirst: z.boolean().optional(),
});

export const teamUserSchema = z.object({
  email: z.string().max(320).optional(),
  name: z.string().max(500).optional(),
  kind: z.enum(["user", "service"]).optional(),
  role: z.enum(["owner", "member"]).optional(),
  password: z.string().max(1000).optional(),
});

export const apiKeySchema = z.object({
  name: z.string().max(200).optional(),
  scopes: z.array(z.string().max(40)).max(20).optional(),
  expiresAt: z.string().max(80).nullable().optional(),
});

export const retentionSchema = z.object({
  count: z.number().finite(),
});

export const transferSettingsSchema = z.object({
  freeWaitSeconds: limitNumber.optional(),
  freeBytesPerSecond: limitNumber.optional(),
  freeDailyBytes: limitNumber.optional(),
  freeCooldownSeconds: limitNumber.optional(),
  paidBytesPerSecond: limitNumber.optional(),
  paidDailyBytes: limitNumber.optional(),
  ticketTtlSeconds: limitNumber.optional(),
});

export const projectSchema = z.object({
  name: z.string().max(500).optional(),
  kind: z.enum(PROJECT_KINDS).optional(),
  description: z.string().max(8000).optional(),
  color: color.optional(),
  starred: z.boolean().optional(),
  defaultProject: z.boolean().optional(),
});

export const memberSchema = z.object({
  email: z.string().max(320).optional(),
  role: z.enum(["owner", "member"]).optional(),
});

export const drawerSchema = z.object({
  name: z.string().max(500).optional(),
  mode: z.enum(["hosted", "linked"]).optional(),
  backendKind: z.enum(["s3", "sftp", "hosted", "connector"]).optional(),
  endpoint: z.string().max(2000).optional(),
  region: z.string().max(80).optional(),
  bucket: z.string().max(200).optional(),
  prefix: z.string().max(1000).optional(),
  pathStyle: z.boolean().optional(),
  forcePathStyle: z.boolean().optional(),
  accessKey: z.string().max(500).optional(),
  accessKeyId: z.string().max(500).optional(),
  secretKey: z.string().max(2000).optional(),
  secretAccessKey: z.string().max(2000).optional(),
  color: color.optional(),
  notes: z.string().max(8000).optional(),
  sortOrder: z.number().finite().optional(),
  starred: z.boolean().optional(),
  dropCache: z.boolean().optional(),
  projectId: z.string().max(80).optional(),
});

export const folderSchema = z.object({
  parentId: z.string().max(80).optional(),
  folderId: z.string().max(80).optional(),
  drawerId: z.string().max(80).optional(),
  name: z.string().max(500).optional(),
});

export const uploadSchema = z.object({
  folderId: z.string().max(80).optional(),
  drawerId: z.string().max(80).optional(),
  name: z.string().max(500).optional(),
  size: z.number().finite().nonnegative().optional(),
  contentType: z.string().max(200).optional(),
});

export const completeUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().max(200),
      }),
    )
    .max(10_000)
    .optional(),
});

export const reorderSchema = z.object({
  parentId: z.string().max(80).optional(),
  ids: z.array(z.string().max(80)).max(2000),
});

export const moveSchema = z.object({
  nodeIds: z.array(z.string().max(80)).max(2000),
  destinationFolderId: z.string().max(80).optional(),
});

export const copySchema = z.object({
  nodeIds: z.array(z.string().max(80)).max(2000),
  destinationDrawerId: z.string().max(80).optional(),
  destinationFolderId: z.string().max(80).optional(),
});

export const deleteSchema = z.object({
  nodeIds: z.array(z.string().max(80)).max(2000),
});

export const patchNodeSchema = z.object({
  name: z.string().max(500).optional(),
  starred: z.boolean().optional(),
  color: color.optional(),
});

export const grantSchema = z.object({
  email: z.string().max(320).optional(),
  userId: z.string().max(80).optional(),
  anyoneWithLink: z.boolean().optional(),
  verbs: z.array(z.string().max(40)).max(20).optional(),
  expiresAt: z.string().max(80).optional(),
  password: z.string().max(1000).optional(),
  downloadCap: z.number().finite().nullable().optional(),
});

export const publishSchema = z.object({
  visibility: z.enum(["public", "unlisted"]).optional(),
  title: z.string().max(500).optional(),
  note: z.string().max(8000).optional(),
});

export const askSchema = z.object({
  question: z.string().max(8000).optional(),
});

export const abuseSchema = z.object({
  note: z.string().max(4000).optional(),
});

export const portalSessionSchema = z.object({
  token: z.string().max(500).optional(),
  password: z.string().max(1000).optional(),
});

export async function readJson<T>(c: { req: { text: () => Promise<string> } }, schema: z.ZodType<T>): Promise<T> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(400, "invalid", "Expected JSON");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "invalid", "Expected an object");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "body"))];
    throw new HttpError(400, "invalid", "Invalid request", { fields });
  }
  return parsed.data;
}

export function asBody(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
