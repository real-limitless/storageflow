import type { LocationTab, Project } from "@storageflow/domain";

const SEARCH_KEYS = ["df", "dc", "ff", "fc", "qf", "qc", "sort", "dir", "view", "select"] as const;

export function filterCabinets(projects: Project[], query: string): Project[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter((project) => project.name.toLowerCase().includes(needle) || project.kind.toLowerCase().includes(needle));
}

export function projectIdFromUrl(url: string): string {
  const pathname = url.split("?")[0] ?? "";
  const match = pathname.match(/\/p\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function cabinetTabId(tab: LocationTab): string {
  return tab.projectId || projectIdFromUrl(tab.url) || tab.id;
}

function alignedTab(tab: LocationTab): LocationTab | null {
  const id = cabinetTabId(tab);
  if (!id) return null;
  const urlId = projectIdFromUrl(tab.url);
  if (urlId && urlId !== id) {
    return { ...tab, id, projectId: id, url: `/app/p/${id}`, select: "" };
  }
  return { ...tab, id, projectId: id, select: tab.select || selectFromUrl(tab.url) };
}

export function cabinetTabs(tabs: LocationTab[]): LocationTab[] {
  const ordered: LocationTab[] = [];
  const indexById = new Map<string, number>();
  for (const tab of tabs) {
    const next = alignedTab(tab);
    if (!next) continue;
    const id = next.projectId || next.id;
    const existing = indexById.get(id);
    if (existing == null) {
      indexById.set(id, ordered.length);
      ordered.push(next);
      continue;
    }
    ordered[existing] = { ...ordered[existing], ...next, id, projectId: id };
  }
  return ordered;
}

export function selectFromUrl(url: string): string {
  const query = url.split("?")[1] ?? "";
  return new URLSearchParams(query).get("select") ?? "";
}

export function buildLocationUrl(pathname: string, search: Partial<Record<(typeof SEARCH_KEYS)[number], string | undefined>>): string {
  const params = new URLSearchParams();
  for (const key of SEARCH_KEYS) {
    const value = search[key];
    if (!value) continue;
    if (key === "sort" && value === "name") continue;
    if (key === "dir" && value === "asc") continue;
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function parseLocationUrl(url: string): {
  pathname: string;
  projectId: string;
  drawerId: string;
  folderId: string;
  search: Record<string, string>;
} {
  const [pathname = "", query = ""] = url.split("?");
  const search = Object.fromEntries(new URLSearchParams(query));
  const parts = pathname.split("/").filter(Boolean);
  return {
    pathname,
    projectId: decodeURIComponent(parts[2] ?? ""),
    drawerId: parts[3] === "d" ? decodeURIComponent(parts[4] ?? "") : "",
    folderId: parts[5] === "f" ? decodeURIComponent(parts[6] ?? "") : "",
    search,
  };
}

export function upsertCabinetTab(tabs: LocationTab[], next: LocationTab): LocationTab[] {
  const id = next.projectId || projectIdFromUrl(next.url) || next.id;
  const tab: LocationTab = { ...next, id, projectId: id, select: next.select || selectFromUrl(next.url) };
  const current = cabinetTabs(tabs);
  const index = current.findIndex((item) => cabinetTabId(item) === id);
  if (index < 0) return [...current, tab].slice(0, 12);
  const copy = current.slice();
  copy[index] = { ...current[index], ...tab, id, projectId: id };
  return copy;
}

export function closeCabinetTab(tabs: LocationTab[], projectId: string): LocationTab[] {
  return cabinetTabs(tabs).filter((tab) => cabinetTabId(tab) !== projectId);
}

export function neighborAfterClose(tabs: LocationTab[], projectId: string): LocationTab | null {
  const list = cabinetTabs(tabs);
  const index = list.findIndex((tab) => cabinetTabId(tab) === projectId);
  if (index < 0) return list[0] ?? null;
  return list[index + 1] ?? list[index - 1] ?? null;
}

export function reorderCabinetTabs(tabs: LocationTab[], activeId: string, overId: string): LocationTab[] {
  const list = cabinetTabs(tabs);
  const oldIndex = list.findIndex((tab) => cabinetTabId(tab) === activeId);
  const newIndex = list.findIndex((tab) => cabinetTabId(tab) === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return list;
  const next = list.slice();
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) return list;
  next.splice(newIndex, 0, moved);
  return next;
}

export function restoreCabinetTab(tabs: LocationTab[], tab: LocationTab): LocationTab[] {
  return upsertCabinetTab(tabs, tab);
}

export function openOrRestoreCabinet(openTabs: LocationTab[], closed: LocationTab | undefined, projectId: string): { tabs: LocationTab[]; target: LocationTab | null } {
  const existing = cabinetTabs(openTabs).find((tab) => cabinetTabId(tab) === projectId);
  if (existing) return { tabs: cabinetTabs(openTabs), target: existing };
  if (closed && cabinetTabId(closed) === projectId) {
    return { tabs: restoreCabinetTab(openTabs, closed), target: { ...closed, id: projectId, projectId } };
  }
  return { tabs: cabinetTabs(openTabs), target: null };
}
