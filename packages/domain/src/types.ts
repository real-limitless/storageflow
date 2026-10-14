export const PROJECT_KINDS = ["work", "personal", "school", "sports", "custom"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const LABEL_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const DRAWER_MODES = ["linked", "hosted"] as const;
export type DrawerMode = (typeof DRAWER_MODES)[number];

export const BACKEND_KINDS = ["s3", "sftp", "hosted", "connector"] as const;
export type BackendKind = (typeof BACKEND_KINDS)[number];

export const NODE_KINDS = ["file", "folder"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const GRANT_VERBS = ["list", "download", "upload", "delete", "reshare"] as const;
export type GrantVerb = (typeof GRANT_VERBS)[number];

export const TRANSFER_PLANS = ["free", "paid"] as const;
export type TransferPlan = (typeof TRANSFER_PLANS)[number];

export const VIEW_MODES = ["grid", "list", "details"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VISIBILITIES = ["unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEMBER_ROLES = ["owner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const USER_KINDS = ["user", "service"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  kind: ProjectKind;
  description: string;
  color: LabelColor | null;
  starred: boolean;
  createdAt: string;
  role: MemberRole;
}

export interface JobSummary {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string | null;
  error: string | null;
}

export interface Drawer {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  mode: DrawerMode;
  backendKind: BackendKind;
  sortOrder: number;
  color: LabelColor | null;
  starred: boolean;
  notes: string;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  prefix: string;
  pathStyle: boolean;
  accessKey: string | null;
  secretSet: boolean;
  healthOk: boolean | null;
  healthMessage: string | null;
  healthCheckedAt: string | null;
  cacheListedAt: string | null;
  createdAt: string;
  rootFolderId: string | null;
  jobs: JobSummary[];
}

export interface Node {
  id: string;
  tenantId: string;
  drawerId: string;
  parentId: string | null;
  backendKey: string;
  kind: NodeKind;
  name: string;
  size: number | null;
  contentType: string | null;
  modifiedAt: string | null;
  starred: boolean;
  color: LabelColor | null;
  sortOrder: number;
  incomplete: boolean;
  cachedAt: string;
}

export interface PathSegment {
  id: string;
  name: string;
  kind: "project" | "drawer" | "folder";
}

export interface Listing {
  drawer: Drawer;
  folder: Node;
  folders: Node[];
  files: Node[];
  breadcrumb: PathSegment[];
  backendPath: string;
  stale: boolean;
  listedAt: string | null;
  error: string | null;
  nextCursor: string | null;
  totalFiles: number;
}

export interface FolderTree {
  root: Node;
  folders: Node[];
}

export interface GrantView {
  id: string;
  nodeId: string;
  portalId: string | null;
  portalSlug: string | null;
  granteeEmail: string | null;
  granteeUserId: string | null;
  anyoneWithLink: boolean;
  verbs: GrantVerb[];
  expiresAt: string | null;
  downloadCap: number | null;
  downloadCount: number;
  hasPassword: boolean;
  link: string | null;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string | null;
  nodeId: string | null;
  actorEmail: string | null;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectMember {
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
}

export interface PublicationView {
  id: string;
  publicId: string;
  nodeId: string;
  title: string;
  visibility: Visibility;
  note: string;
  downloadCount: number;
  createdAt: string;
  fileName: string;
  size: number | null;
  unpublishedAt: string | null;
}

export interface PublicPublication {
  publicId: string;
  title: string;
  note: string;
  size: number | null;
  fileName: string;
  publishedAt: string;
  downloadCount: number;
  visibility: Visibility;
}

export interface CatalogEntry {
  publicId: string;
  title: string;
  size: number | null;
  fileName: string;
  publishedAt: string;
  downloadCount: number;
}

export interface TicketView {
  id: string;
  plan: TransferPlan;
  readyAt: string;
  expiresAt: string;
  waitSeconds: number;
  bytesPerSecond: number;
  status: string;
}

export interface LocationTab {
  id: string;
  url: string;
  title: string;
  /** Cabinet id. Older tabs leave this empty and keep the id in `url`. */
  projectId?: string;
  /** Selected node id. The `url` query also carries `select`. */
  select?: string;
}

export interface Preferences {
  paneSizes: { drawers: number; folders: number; files: number };
  viewMode: ViewMode;
  zoom: number;
  lastProjectId: string | null;
  defaultProjectId: string | null;
  locationTabs: LocationTab[];
  favoritesOnly: boolean;
  starredFirst: boolean;
}

export interface TransferSettings {
  freeWaitSeconds: number;
  freeBytesPerSecond: number;
  freeDailyBytes: number;
  freeCooldownSeconds: number;
  paidBytesPerSecond: number;
  paidDailyBytes: number;
  ticketTtlSeconds: number;
}

export interface Membership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MemberRole;
}

export interface Me {
  user: { id: string; email: string; name: string; transferPlan: TransferPlan; mfaEnabled: boolean };
  memberships: Membership[];
  activeTenant: { id: string; slug: string; name: string; role: MemberRole } | null;
  preferences: Preferences;
  hostedUsageBytes: number;
  hostedQuotaBytes: number;
  linkedUsageBytes: number;
  canSetPlan: boolean;
  transferSettings: TransferSettings | null;
}

export interface SearchHit {
  node: Node;
  drawerId: string;
  drawerName: string;
  projectId: string;
  parentId: string | null;
  snippet?: string;
  score?: number;
}

export interface RagAnswer {
  answer: string;
  hits: SearchHit[];
}

export interface PortalRoot {
  node: Node;
  drawerId: string;
  drawerName: string;
  grantId: string;
  verbs: GrantVerb[];
  dropFolder: boolean;
}

export interface TestResult {
  ok: boolean;
  message?: string;
  names: string[];
}

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  kind: UserKind;
  role: MemberRole;
  disabledAt: string | null;
  createdAt: string;
}

export interface IssuedApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: GrantVerb[];
  expiresAt: string | null;
  createdAt: string;
  token: string;
}

export interface FileVersionView {
  id: string;
  nodeId: string;
  version: number;
  storageKey: string;
  size: number | null;
  authorUserId: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface UploadTicket {
  uploadId: string;
  transport: "presigned" | "proxy";
  key: string;
  url?: string;
  headers?: Record<string, string>;
  parts?: { partNumber: number; url: string }[];
  multipartUploadId?: string;
}
