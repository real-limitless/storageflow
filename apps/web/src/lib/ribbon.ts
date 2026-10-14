import type { PathSegment } from "@storageflow/domain";

export const RIBBON_TABS = ["Home", "Inbox", "Manage", "Edit", "Search"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];

export const DETAIL_COLUMN_HEADERS = ["Name", "Size", "Item type", "Date modified", "Color", "Star"] as const;

export type RibbonActionId =
  | "cabinets"
  | "open"
  | "email"
  | "scan"
  | "ocr"
  | "portal"
  | "split"
  | "preview"
  | "tools"
  | "move"
  | "namings"
  | "templates"
  | "separators"
  | "cleanup"
  | "actions"
  | "convert"
  | "combine"
  | "extract"
  | "settings"
  | "guide"
  | "help"
  | "new-folder"
  | "upload"
  | "rename"
  | "delete"
  | "share"
  | "download"
  | "publish";

export interface RibbonAction {
  id: RibbonActionId;
  label: string;
  availability: "live" | "soon";
  issue: number | null;
}

export interface RibbonSelection {
  projectId: string;
  drawerId: string;
  folderId: string;
  rootFolderId: string;
  writesEnabled: boolean;
  portalSlug: string | null;
  drawerIds: string[];
  folderIds: string[];
  fileIds: string[];
}

const ISSUE_BASE = "https://github.com/real-limitless/storageflow/issues";

export const RIBBON_ACTIONS: readonly RibbonAction[] = [
  { id: "cabinets", label: "Cabinets", availability: "live", issue: null },
  { id: "open", label: "Open", availability: "live", issue: null },
  { id: "email", label: "Email", availability: "soon", issue: 19 },
  { id: "scan", label: "Scan", availability: "soon", issue: 20 },
  { id: "ocr", label: "OCR", availability: "soon", issue: 21 },
  { id: "portal", label: "Portal", availability: "live", issue: null },
  { id: "split", label: "Split", availability: "soon", issue: 22 },
  { id: "preview", label: "Preview", availability: "live", issue: null },
  { id: "tools", label: "Tools", availability: "soon", issue: 12 },
  { id: "move", label: "Move", availability: "live", issue: null },
  { id: "namings", label: "Namings", availability: "soon", issue: 23 },
  { id: "templates", label: "Templates", availability: "soon", issue: 24 },
  { id: "separators", label: "Separators", availability: "soon", issue: 25 },
  { id: "cleanup", label: "Cleanup", availability: "soon", issue: 26 },
  { id: "actions", label: "Actions", availability: "soon", issue: 27 },
  { id: "convert", label: "Convert", availability: "soon", issue: 28 },
  { id: "combine", label: "Combine", availability: "soon", issue: 29 },
  { id: "extract", label: "Extract", availability: "soon", issue: 30 },
  { id: "settings", label: "Settings", availability: "live", issue: null },
  { id: "guide", label: "Guide", availability: "soon", issue: 31 },
  { id: "help", label: "Help", availability: "soon", issue: 32 },
  { id: "new-folder", label: "New folder", availability: "live", issue: null },
  { id: "upload", label: "Upload", availability: "live", issue: null },
  { id: "rename", label: "Rename", availability: "live", issue: null },
  { id: "delete", label: "Delete", availability: "live", issue: null },
  { id: "share", label: "Share", availability: "live", issue: null },
  { id: "download", label: "Download", availability: "live", issue: null },
  { id: "publish", label: "Publish", availability: "live", issue: null },
];

/** Compact action control, in CSS pixels. The ribbon buttons use this same width. */
export const RIBBON_ACTION_WIDTH = 64;
/** Vertical rule between groups, including its side margins. */
export const RIBBON_RULE_WIDTH = 13;
/** Width of the overflow control reserved at the end of a full row. */
export const RIBBON_OVERFLOW_WIDTH = 64;
/** Content width of the ribbon on a desktop cabinet, after the sidebar and page margins. */
export const DESKTOP_RIBBON_WIDTH = 1024;

export interface RibbonRowItem {
  id: RibbonActionId;
  ruleBefore: boolean;
}

export interface RibbonRowLayout {
  visible: RibbonRowItem[];
  overflow: RibbonActionId[];
  width: number;
}

function ribbonSlots(groups: readonly (readonly RibbonActionId[])[]): RibbonRowItem[] {
  const slots: RibbonRowItem[] = [];
  groups.forEach((group, groupIndex) => {
    group.forEach((id, index) => {
      slots.push({ id, ruleBefore: groupIndex > 0 && index === 0 });
    });
  });
  return slots;
}

function slotWidth(slot: RibbonRowItem, drawRule: boolean): number {
  return (drawRule && slot.ruleBefore ? RIBBON_RULE_WIDTH : 0) + RIBBON_ACTION_WIDTH;
}

/** Pack actions onto one row. Whatever does not fit goes to the overflow menu, in the same order. */
export function fitRibbonRow(groups: readonly (readonly RibbonActionId[])[], containerWidth: number): RibbonRowLayout {
  const slots = ribbonSlots(groups);
  const full = slots.reduce((sum, slot) => sum + slotWidth(slot, true), 0);
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || full <= containerWidth) {
    return { visible: slots, overflow: [], width: full };
  }
  let used = RIBBON_OVERFLOW_WIDTH;
  const visible: RibbonRowItem[] = [];
  let index = 0;
  for (; index < slots.length; index += 1) {
    const ruleBefore = visible.length > 0 && slots[index].ruleBefore;
    const next = slotWidth(slots[index], ruleBefore);
    if (used + next > containerWidth) break;
    used += next;
    visible.push({ id: slots[index].id, ruleBefore });
  }
  return {
    visible,
    overflow: slots.slice(index).map((slot) => slot.id),
    width: used,
  };
}

export const HOME_GROUPS: readonly (readonly RibbonActionId[])[] = [
  ["cabinets", "open"],
  ["email", "scan", "ocr"],
  ["portal", "split", "preview"],
  ["tools", "move"],
  ["namings", "templates", "separators", "cleanup", "actions"],
  ["convert", "combine", "extract"],
  ["settings", "guide", "help"],
  ["new-folder", "upload"],
];

export const INBOX_GROUPS: readonly (readonly RibbonActionId[])[] = [["email", "scan"]];

export const MANAGE_GROUPS: readonly (readonly RibbonActionId[])[] = [
  ["cabinets", "open", "move", "new-folder", "upload"],
  ["rename", "delete", "share", "download", "publish"],
  ["portal", "namings", "templates", "separators", "cleanup"],
  ["settings"],
];

export const EDIT_GROUPS: readonly (readonly RibbonActionId[])[] = [
  ["preview", "split", "ocr"],
  ["convert", "combine", "extract", "actions"],
];

const byId = new Map(RIBBON_ACTIONS.map((action) => [action.id, action]));

export function ribbonAction(id: RibbonActionId): RibbonAction {
  const action = byId.get(id);
  if (!action) throw new Error(`Unknown ribbon action ${id}`);
  return action;
}

export function groupsForTab(tab: RibbonTab): readonly (readonly RibbonActionId[])[] {
  if (tab === "Inbox") return INBOX_GROUPS;
  if (tab === "Manage") return MANAGE_GROUPS;
  if (tab === "Edit") return EDIT_GROUPS;
  if (tab === "Search") return [];
  return HOME_GROUPS;
}

export function issueUrl(issue: number): string {
  return `${ISSUE_BASE}/${issue}`;
}

function movableFolders(selection: RibbonSelection): string[] {
  return selection.folderIds.filter((id) => id && id !== selection.rootFolderId);
}

export function isActionEnabled(id: RibbonActionId, selection: RibbonSelection): boolean {
  const files = selection.fileIds.length;
  const folders = movableFolders(selection).length;
  const drawers = selection.drawerIds.length;
  const oneFile = files === 1 && folders === 0 && drawers === 0;
  const oneFolder = folders === 1 && files === 0 && drawers === 0;
  const oneDrawer = drawers === 1 && files === 0 && folders === 0;
  const anyFile = files > 0;
  const anyMovable = files + folders > 0;

  switch (id) {
    case "cabinets":
    case "guide":
    case "help":
    case "tools":
      return true;
    case "settings":
      return selection.projectId.length > 0;
    case "open":
      return oneFile || oneFolder || oneDrawer;
    case "preview":
    case "split":
    case "extract":
      return files === 1;
    case "portal":
      return Boolean(selection.portalSlug);
    case "move":
    case "delete":
      return selection.writesEnabled && anyMovable;
    case "new-folder":
      return selection.writesEnabled && selection.drawerId.length > 0;
    case "upload":
    case "scan":
    case "templates":
    case "cleanup":
      return selection.writesEnabled && selection.folderId.length > 0;
    case "email":
    case "ocr":
    case "separators":
    case "convert":
      return anyFile;
    case "namings":
      return anyFile || folders > 0;
    case "actions":
      return anyFile || folders > 0 || drawers > 0;
    case "combine":
      return files >= 2;
    case "rename":
      return (oneFile || oneFolder) && selection.writesEnabled;
    case "share":
      return selection.folderId.length > 0 || selection.rootFolderId.length > 0;
    case "download":
      return anyFile;
    case "publish":
      return files === 1;
    default:
      return false;
  }
}

export function disabledReason(id: RibbonActionId, selection: RibbonSelection): string | null {
  if (isActionEnabled(id, selection)) return null;
  switch (id) {
    case "open":
      return "Select one drawer, folder, or file";
    case "preview":
    case "split":
    case "extract":
      return "Select one file";
    case "portal":
      return "This drawer has no portal";
    case "move":
    case "delete":
      return selection.writesEnabled ? "Select a file or folder" : "Writes are paused";
    case "new-folder":
      return selection.writesEnabled ? "Open a drawer first" : "Writes are paused";
    case "upload":
    case "scan":
    case "templates":
    case "cleanup":
      return selection.writesEnabled ? "Open a folder first" : "Writes are paused";
    case "email":
    case "ocr":
    case "separators":
    case "convert":
    case "download":
      return "Select a file";
    case "publish":
      return "Select one file";
    case "combine":
      return "Select two or more files";
    case "namings":
      return "Select a file or folder";
    case "actions":
      return "Select an item";
    case "rename":
      return selection.writesEnabled ? "Select one file or folder" : "Writes are paused";
    case "share":
      return "Open a drawer first";
    case "settings":
      return "Open a cabinet first";
    default:
      return "Unavailable";
  }
}

export function comingSoonCopy(action: RibbonAction): string {
  if (action.id === "tools") {
    return "Tools is coming soon. Audit and MFA stay on issue #12.";
  }
  return `${action.label} is coming soon.`;
}

export function statusLabel(selected: number, folders: number, files: number): string {
  const selectedText = selected === 0 ? "Nothing selected" : selected === 1 ? "1 item selected" : `${selected} items selected`;
  const folderText = folders === 1 ? "1 folder" : `${folders} folders`;
  const fileText = files === 1 ? "1 file" : `${files} files`;
  return `${selectedText} · ${folderText}, ${fileText}`;
}

export function parentCrumb(crumbs: PathSegment[], rootFolderId: string): { kind: "project" } | { kind: "folder"; id: string } | null {
  const last = crumbs[crumbs.length - 1];
  if (!last || last.kind === "project") return null;
  if (last.kind === "drawer") return { kind: "project" };
  const previousFolder = [...crumbs].reverse().slice(1).find((crumb) => crumb.kind === "folder");
  if (previousFolder) return { kind: "folder", id: previousFolder.id };
  if (rootFolderId && rootFolderId !== last.id) return { kind: "folder", id: rootFolderId };
  return { kind: "project" };
}
