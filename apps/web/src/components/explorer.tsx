import { closestCenter, DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  backendDisplayPath,
  buildTree,
  flattenTree,
  LABEL_COLORS,
  extensionOf,
  objectNameError,
  typeLabel,
  type LabelColor,
  type Drawer,
  type FolderTree,
  type GrantView,
  type Listing,
  type LocationTab,
  type Me,
  type Node,
  type Preferences,
  type Project,
  type SearchHit,
} from "@storageflow/domain";
import { ChevronRight, File, FileText, Folder, FolderOpen, Image as ImageIcon, LayoutGrid, List, Star, Table2, Upload } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { CabinetTabs } from "@/components/cabinet-tabs";
import { DrawerWizard, FileDialog, FolderDialog, PublishDialog, ShareDialog } from "@/components/dialogs";
import { DeleteConfirm, ItemMenu, type ItemMenuProps } from "@/components/item-menu";
import { PropertiesPane, type PropertiesTarget } from "@/components/properties-pane";
import { AppShell } from "@/components/header";
import { FileCenterRibbon, LocationBar, StatusCounts } from "@/components/ribbon";
import { buildLocationUrl, cabinetTabs, closeCabinetTab, neighborAfterClose, openOrRestoreCabinet, parseLocationUrl, projectIdFromUrl, reorderCabinetTabs, upsertCabinetTab } from "@/lib/cabinets";
import {
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { COLOR_CLASS, fileKind, formatBytes, formatWhen } from "@/lib/format";
import { DETAIL_COLUMN_HEADERS, parentCrumb, type RibbonActionId, type RibbonSelection, type RibbonTab } from "@/lib/ribbon";
import { validateExplorerSearch, type ExplorerSearch } from "@/lib/search";
import { uploads, useUploads } from "@/lib/uploads";

type Pane = "drawers" | "folders" | "files";

interface MenuActions {
  writesEnabled: boolean;
  openNewFolder: () => void;
  openNewFile: () => void;
  openUpload: () => void;
  openProperties: () => void;
  file: (node: Node, index: number, count: number) => Omit<ItemMenuProps, "children">;
  folder: (node: Node, siblings: Node[]) => Omit<ItemMenuProps, "children">;
  drawer: (drawer: Drawer, index: number, count: number) => Omit<ItemMenuProps, "children">;
}

const MenuContext = createContext<MenuActions | null>(null);

function useMenus() {
  return useContext(MenuContext);
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return narrow;
}

export function ExplorerPage() {
  const params = useParams({ strict: false }) as { projectId?: string; drawerId?: string; folderId?: string };
  const projectId = params.projectId ?? "";
  const drawerId = params.drawerId ?? "";
  const folderId = params.folderId ?? "";
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = validateExplorerSearch((useSearch({ strict: false }) ?? {}) as Record<string, unknown>);
  const queryClient = useQueryClient();
  const narrow = useNarrow();
  const [step, setStep] = useState<Pane>("drawers");
  const [focus, setFocus] = useState<Pane>("drawers");
  const [selected, setSelected] = useState<Record<Pane, string[]>>({ drawers: [], folders: [], files: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [wizard, setWizard] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Node | null>(null);
  const [palette, setPalette] = useState(false);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>("Home");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDestination, setMoveDestination] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [nameHits, setNameHits] = useState<SearchHit[] | null>(null);
  const [nameSearching, setNameSearching] = useState(false);
  const [createProject, setCreateProject] = useState(false);
  const [fileDialog, setFileDialog] = useState(false);
  const [createParentId, setCreateParentId] = useState("");
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [propertiesTarget, setPropertiesTarget] = useState<PropertiesTarget | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{ kind: "nodes" | "drawer"; ids: string[]; label: string } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDrawerId, setRenameDrawerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadParent = useRef("");
  const paneTimer = useRef<number | undefined>(undefined);
  const tabsRef = useRef<LocationTab[]>([]);
  const closedTabs = useRef<Map<string, LocationTab>>(new Map());
  const suppressProject = useRef<string | null>(null);
  const prefWrite = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects") });
  const project = projects.data?.find((item) => item.id === projectId) ?? null;
  const drawers = useQuery({ queryKey: ["drawers", projectId], queryFn: () => api<Drawer[]>(`/projects/${projectId}/drawers`), enabled: !!projectId });
  const tree = useQuery({ queryKey: ["tree", drawerId], queryFn: () => api<FolderTree>(`/drawers/${drawerId}/tree`), enabled: !!drawerId });
  const listing = useQuery({
    queryKey: ["listing", drawerId, folderId, search.qf, search.qc, search.sort, search.dir],
    queryFn: () => api<Listing>(`/drawers/${drawerId}/list?${new URLSearchParams({ folderId, q: search.qf, color: search.qc, sort: search.sort, dir: search.dir })}`),
    enabled: !!drawerId && !!folderId,
  });
  const view = search.view ?? me.data?.preferences.viewMode ?? "grid";
  const zoom = me.data?.preferences.zoom ?? 2;
  const writesEnabled = listing.data ? listing.data.drawer.healthOk !== false && !listing.data.stale : drawers.data?.find((drawer) => drawer.id === drawerId)?.healthOk !== false;
  const activeDrawer = drawers.data?.find((drawer) => drawer.id === drawerId) ?? listing.data?.drawer ?? null;
  const portalGrants = useQuery({
    queryKey: ["grants", activeDrawer?.rootFolderId],
    enabled: !!activeDrawer?.rootFolderId,
    queryFn: () => api<GrantView[]>(`/nodes/${activeDrawer?.rootFolderId}/grants`),
  });
  const portalSlug = portalGrants.data?.find((grant) => grant.portalSlug)?.portalSlug ?? null;

  useEffect(() => {
    if (tree.data?.root.id) setExpanded((current) => new Set(current).add(tree.data.root.id));
  }, [tree.data?.root.id]);

  useEffect(() => {
    if (projectId || !projects.data?.length) return;
    const preferred = me.data?.preferences.defaultProjectId || me.data?.preferences.lastProjectId;
    const next = projects.data.find((item) => item.id === preferred)?.id ?? projects.data[0]?.id;
    if (next) void navigate({ to: "/app/p/$projectId", params: { projectId: next }, replace: true });
  }, [projectId, projects.data, me.data, navigate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    tabsRef.current = cabinetTabs(me.data?.preferences.locationTabs ?? []);
  }, [me.data?.preferences.locationTabs]);

  function rememberTabs(next: LocationTab[], lastProjectId?: string | null) {
    const ticket = ++prefWrite.current;
    tabsRef.current = next;
    queryClient.setQueryData<Me>(["me"], (current) =>
      current
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              locationTabs: next,
              lastProjectId: lastProjectId === undefined ? current.preferences.lastProjectId : lastProjectId,
            },
          }
        : current,
    );
    const body = lastProjectId === undefined ? { locationTabs: next } : { locationTabs: next, lastProjectId };
    void api<Preferences>("/me/preferences", { method: "PATCH", body: JSON.stringify(body) }).then((saved) => {
      if (ticket !== prefWrite.current) return;
      queryClient.setQueryData<Me>(["me"], (current) => (current ? { ...current, preferences: saved } : current));
    });
  }

  function followTab(tab: LocationTab) {
    const parsed = parseLocationUrl(tab.url);
    const nextSearch = validateExplorerSearch(parsed.search);
    if (tab.select) nextSearch.select = tab.select;
    const targetProject = parsed.projectId || tab.projectId || "";
    if (!targetProject) return;
    if (parsed.drawerId && parsed.folderId) {
      void navigate({
        to: "/app/p/$projectId/d/$drawerId/f/$folderId",
        params: { projectId: targetProject, drawerId: parsed.drawerId, folderId: parsed.folderId },
        search: nextSearch,
      });
      return;
    }
    void navigate({ to: "/app/p/$projectId", params: { projectId: targetProject }, search: nextSearch });
  }

  function openCabinet(item: Project) {
    suppressProject.current = null;
    const closed = closedTabs.current.get(item.id);
    const { tabs, target } = openOrRestoreCabinet(tabsRef.current, closed, item.id);
    if (target) {
      if (!tabsRef.current.some((tab) => tab.projectId === item.id)) {
        closedTabs.current.delete(item.id);
        rememberTabs(tabs, item.id);
      }
      followTab(target);
      return;
    }
    void navigate({ to: "/app/p/$projectId", params: { projectId: item.id }, search: validateExplorerSearch({}) });
  }

  function closeTab(id: string) {
    const existing = tabsRef.current.find((tab) => tab.projectId === id);
    if (existing) closedTabs.current.set(id, existing);
    const neighbor = neighborAfterClose(tabsRef.current, id);
    const next = closeCabinetTab(tabsRef.current, id);
    if (id === projectId) suppressProject.current = id;
    rememberTabs(next, id === projectId ? null : undefined);
    if (id !== projectId) return;
    if (neighbor) followTab(neighbor);
    else void navigate({ to: "/app" });
  }

  const searchKey = JSON.stringify(search);
  useEffect(() => {
    const routedProjectId = projectIdFromUrl(pathname);
    if (!projectId || !me.data) return;
    if (routedProjectId && routedProjectId !== projectId) return;
    if (suppressProject.current === projectId) return;
    const url = buildLocationUrl(pathname, search);
    const title = project?.name || tabsRef.current.find((tab) => tab.projectId === projectId)?.title || "Cabinet";
    const next = upsertCabinetTab(tabsRef.current, { id: projectId, projectId, url, title, select: search.select });
    const previous = cabinetTabs(tabsRef.current);
    const stored = me.data.preferences.locationTabs;
    const same =
      next.length === previous.length &&
      next.every((tab, index) => {
        const prior = previous[index];
        const saved = stored.find((item) => (item.projectId || projectIdFromUrl(item.url) || item.id) === tab.projectId);
        return (
          prior?.projectId === tab.projectId &&
          prior.url === tab.url &&
          prior.title === tab.title &&
          (prior.select ?? "") === (tab.select ?? "") &&
          saved?.url === tab.url &&
          saved.title === tab.title &&
          (saved.select ?? "") === (tab.select ?? "")
        );
      }) &&
      stored.length === next.length &&
      me.data.preferences.lastProjectId === projectId;
    if (same) return;
    rememberTabs(next, projectId);
  }, [pathname, projectId, project?.name, searchKey, me.data]);

  useEffect(() => {
    const id = search.select;
    if (!id) return;
    setSelected((current) => {
      if (drawers.data?.some((drawer) => drawer.id === id)) {
        if (current.drawers.length === 1 && current.drawers[0] === id) return current;
        return { ...current, drawers: [id] };
      }
      if (tree.data && (tree.data.root.id === id || tree.data.folders.some((folder) => folder.id === id))) {
        if (current.folders.length === 1 && current.folders[0] === id) return current;
        return { ...current, folders: [id] };
      }
      const listedFiles = listing.data?.files ?? [];
      const listedFolders = listing.data?.folders ?? [];
      if (listedFiles.some((file) => file.id === id) || listedFolders.some((folder) => folder.id === id)) {
        if (current.files.length === 1 && current.files[0] === id) return current;
        return { ...current, files: [id] };
      }
      return current;
    });
  }, [search.select, drawers.data, tree.data, listing.data]);

  function patchSearch(patch: Partial<ExplorerSearch>) {
    const next = { ...search, ...patch };
    if (drawerId && folderId) {
      void navigate({ to: "/app/p/$projectId/d/$drawerId/f/$folderId", params: { projectId, drawerId, folderId }, search: next });
    } else if (projectId) {
      void navigate({ to: "/app/p/$projectId", params: { projectId }, search: next });
    }
  }

  function openDrawer(drawer: Drawer) {
    if (!drawer.rootFolderId) return;
    setFocus("folders");
    setStep("folders");
    void navigate({
      to: "/app/p/$projectId/d/$drawerId/f/$folderId",
      params: { projectId, drawerId: drawer.id, folderId: drawer.rootFolderId },
      search: { ...search, select: drawer.id },
    });
  }

  function openFolder(id: string) {
    if (!drawerId) return;
    setStep("files");
    void navigate({
      to: "/app/p/$projectId/d/$drawerId/f/$folderId",
      params: { projectId, drawerId, folderId: id },
      search: { ...search, select: id },
    });
  }

  function choose(pane: Pane, id: string, ids: string[], event: MouseEvent, open?: () => void) {
    setFocus(pane);
    setSelected((current) => {
      if (event.metaKey || event.ctrlKey) {
        const next = current[pane].includes(id) ? current[pane].filter((item) => item !== id) : [...current[pane], id];
        return { ...current, [pane]: next };
      }
      if (event.shiftKey && current[pane][0]) {
        const anchor = ids.indexOf(current[pane][0]);
        const index = ids.indexOf(id);
        const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
        return { ...current, [pane]: ids.slice(Math.max(0, start), end + 1) };
      }
      return { ...current, [pane]: [id] };
    });
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) open?.();
  }

  async function savePrefs(patch: Partial<Preferences>) {
    await api("/me/preferences", { method: "PATCH", body: JSON.stringify(patch) });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  async function uploadList(list: FileList | File[]) {
    const targetFolder = uploadParent.current || folderId;
    if (!drawerId || !targetFolder) return;
    for (const file of [...list]) {
      const id = crypto.randomUUID();
      uploads.add({ id, name: file.name, folderId: targetFolder, progress: 0, status: "uploading", file });
      try {
        const ticket = await api<{ uploadId: string; transport: "presigned" | "proxy"; url?: string }>(`/drawers/${drawerId}/uploads`, {
          method: "POST",
          body: JSON.stringify({ folderId: targetFolder, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        await sendFile(ticket, file, (progress) => uploads.update(id, { progress }));
        await api(`/uploads/${ticket.uploadId}/complete`, { method: "POST", body: "{}" });
        uploads.update(id, { status: "done", progress: 1 });
        toast.success(`${file.name} uploaded`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        uploads.update(id, { status: "error", error: message });
        toast.error(message);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["listing", drawerId] });
  }

  async function rename(node: Node) {
    const message = objectNameError(renameValue);
    if (message) {
      toast.error(message);
      return;
    }
    try {
      await api(`/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ name: renameValue.trim() }) });
      setRenameId(null);
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Rename failed");
    }
  }

  function remove(ids: string[]) {
    const nodes = [...(listing.data?.files ?? []), ...(listing.data?.folders ?? []), ...(tree.data?.folders ?? [])].filter((node) => ids.includes(node.id));
    const label = ids.length === 1 ? nodes[0]?.name ?? "this item" : `${ids.length} items`;
    if (ids.length === 0) return;
    setDeleteRequest({ kind: "nodes", ids, label });
  }

  async function confirmDelete() {
    if (!deleteRequest) return;
    try {
      if (deleteRequest.kind === "drawer") {
        await api(`/drawers/${deleteRequest.ids[0]}`, { method: "DELETE" });
      } else {
        await api("/nodes/delete", { method: "POST", body: JSON.stringify({ nodeIds: deleteRequest.ids }) });
      }
      setDeleteRequest(null);
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
      await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (palette) return;
      if (event.key === "Escape") {
        setSelected({ drawers: [], folders: [], files: [] });
        setPreview(null);
        if (search.select) patchSearch({ select: "" });
      }
      if (event.key === "F2" && focus === "files" && selected.files[0]) {
        const node = listing.data?.files.find((file) => file.id === selected.files[0]);
        if (node) {
          setRenameId(node.id);
          setRenameValue(node.name);
        }
      }
      if (event.key === "Delete" && focus === "files") void remove(selected.files);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (focus === "files") setSelected((current) => ({ ...current, files: listing.data?.files.map((file) => file.id) ?? [] }));
        if (focus === "drawers") setSelected((current) => ({ ...current, drawers: drawers.data?.map((drawer) => drawer.id) ?? [] }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const visibleDrawers = useMemo(() => {
    let rows = drawers.data ?? [];
    if (me.data?.preferences.favoritesOnly) rows = rows.filter((drawer) => drawer.starred);
    if (search.df) rows = rows.filter((drawer) => drawer.name.toLowerCase().includes(search.df.toLowerCase()));
    if (search.dc) rows = rows.filter((drawer) => drawer.color === search.dc);
    if (me.data?.preferences.starredFirst) rows = [...rows.filter((drawer) => drawer.starred), ...rows.filter((drawer) => !drawer.starred)];
    return rows;
  }, [drawers.data, me.data?.preferences.favoritesOnly, me.data?.preferences.starredFirst, search.df, search.dc]);

  const folderRows = useMemo(() => {
    if (!tree.data) return [];
    const filtered = tree.data.folders.filter((folder) => {
      if (search.ff && !folder.name.toLowerCase().includes(search.ff.toLowerCase())) return false;
      if (search.fc && folder.color !== search.fc) return false;
      return true;
    });
    return flattenTree(buildTree(filtered, tree.data.root.id), expanded, (folder) => folder.id);
  }, [tree.data, expanded, search.ff, search.fc]);

  async function onDragEnd(event: DragEndEvent) {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : "";
    if (!over || active === over) return;
    if (active.startsWith("node:") && over.startsWith("folder:")) {
      try {
        await api("/nodes/move", { method: "POST", body: JSON.stringify({ nodeIds: [active.slice(5)], destinationFolderId: over.slice(7) }) });
        await queryClient.invalidateQueries({ queryKey: ["listing"] });
        await queryClient.invalidateQueries({ queryKey: ["tree"] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Move failed");
      }
      return;
    }
    const ids = visibleDrawers.map((drawer) => drawer.id);
    const oldIndex = ids.indexOf(active);
    const newIndex = ids.indexOf(over);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    await Promise.all(next.map((id, index) => api(`/drawers/${id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: index + 1 }) })));
    await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
  }

  const files = listing.data?.files ?? [];
  const publishName = files.find((file) => file.id === publishId)?.name ?? "";
  const uploadTasks = useUploads().filter((task) => task.folderId === folderId && task.status !== "done");

  const renameTarget = files.find((file) => file.id === selected.files[0]) ?? tree.data?.folders.find((folder) => folder.id === selected.folders[0]);
  function beginRename() {
    if (!renameTarget || !renameTarget.parentId) return;
    setRenameId(renameTarget.id);
    setRenameValue(renameTarget.name);
  }
  function beginShare() {
    setShareId(selected.files[0] || selected.folders[0] || folderId || activeDrawer?.rootFolderId || null);
  }
  function beginDelete() {
    if (selected.files.length) remove(selected.files);
    else if (selected.folders[0] && selected.folders[0] !== tree.data?.root.id) remove(selected.folders.filter((id) => id !== tree.data?.root.id));
    else if (selected.drawers[0]) {
      const drawer = visibleDrawers.find((item) => item.id === selected.drawers[0]);
      if (drawer) setDeleteRequest({ kind: "drawer", ids: [drawer.id], label: drawer.name });
    }
  }

  function createParent(): string {
    return selected.folders[0] || folderId || tree.data?.root.id || "";
  }

  function scopeName(parentId: string): string {
    if (tree.data?.root.id === parentId) return activeDrawer?.name || "this drawer";
    const folder = tree.data?.folders.find((item) => item.id === parentId);
    if (folder) return folder.name;
    if (listing.data?.folder.id === parentId) return listing.data.folder.name;
    return activeDrawer?.name || "the selected folder";
  }

  function openFolderDialog(parentId: string) {
    setCreateParentId(parentId);
    setFolderDialog(true);
  }

  function openFileDialog(parentId: string) {
    setCreateParentId(parentId);
    setFileDialog(true);
  }

  function beginUpload(parentId: string) {
    uploadParent.current = parentId;
    fileInput.current?.click();
  }

  const ribbonSelection: RibbonSelection = {
    projectId,
    drawerId,
    folderId,
    rootFolderId: activeDrawer?.rootFolderId ?? tree.data?.root.id ?? "",
    writesEnabled: !!writesEnabled,
    portalSlug,
    drawerIds: selected.drawers,
    folderIds: selected.folders,
    fileIds: selected.files,
  };
  const moveDestinations = useMemo(() => {
    if (!tree.data) return [];
    const moving = new Set([...selected.files, ...selected.folders]);
    return [tree.data.root, ...tree.data.folders].filter((node) => !moving.has(node.id)).map((node) => ({ id: node.id, label: node.name }));
  }, [tree.data, selected.files, selected.folders]);
  const crumbs = listing.data?.breadcrumb.length
    ? listing.data.breadcrumb
    : [
        ...(project ? [{ id: project.id, name: project.name, kind: "project" as const }] : []),
        ...(activeDrawer ? [{ id: activeDrawer.id, name: activeDrawer.name, kind: "drawer" as const }] : []),
      ];

  function openCrumb(crumb: (typeof crumbs)[number]) {
    if (crumb.kind === "project") {
      void navigate({ to: "/app/p/$projectId", params: { projectId: crumb.id }, search });
      return;
    }
    if (crumb.kind === "drawer") {
      const drawer = drawers.data?.find((item) => item.id === crumb.id) ?? activeDrawer;
      if (drawer) openDrawer(drawer);
      return;
    }
    openFolder(crumb.id);
  }

  function goUp() {
    const target = parentCrumb(crumbs, activeDrawer?.rootFolderId ?? "");
    if (!target) return;
    if (target.kind === "project") {
      void navigate({ to: "/app/p/$projectId", params: { projectId }, search });
      return;
    }
    openFolder(target.id);
  }

  function beginMove() {
    setMoveDestination(moveDestinations[0]?.id ?? "");
    setMoveOpen(true);
  }

  async function confirmMove() {
    const nodeIds = [...selected.files, ...selected.folders.filter((id) => id !== tree.data?.root.id)];
    if (!moveDestination || nodeIds.length === 0) return;
    try {
      await api("/nodes/move", { method: "POST", body: JSON.stringify({ nodeIds, destinationFolderId: moveDestination }) });
      setMoveOpen(false);
      toast.success("Moved");
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Move failed");
    }
  }

  async function runNameSearch() {
    if (!projectId) return;
    setNameSearching(true);
    try {
      const found = await api<SearchHit[]>(`/projects/${projectId}/search?q=${encodeURIComponent(nameQuery)}`);
      setNameHits(found);
    } catch (error) {
      setNameHits([]);
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setNameSearching(false);
    }
  }

  function openHit(hit: SearchHit) {
    const parent = hit.node.kind === "folder" ? hit.node.id : hit.parentId;
    if (!parent) return;
    void navigate({
      to: "/app/p/$projectId/d/$drawerId/f/$folderId",
      params: { projectId, drawerId: hit.drawerId, folderId: parent },
      search: { ...search, select: hit.node.id },
    });
  }

  function runRibbon(id: RibbonActionId) {
    if (id === "cabinets") {
      document.querySelector<HTMLButtonElement>('header [role="combobox"]')?.click();
      return;
    }
    if (id === "open") {
      if (selected.files.length === 1) {
        const file = files.find((item) => item.id === selected.files[0]);
        if (file) setPreview(file);
        return;
      }
      if (selected.folders.length === 1) {
        openFolder(selected.folders[0]);
        return;
      }
      const drawer = visibleDrawers.find((item) => item.id === selected.drawers[0]);
      if (drawer) openDrawer(drawer);
      return;
    }
    if (id === "portal" && portalSlug) {
      window.location.assign(`/portal/${portalSlug}`);
      return;
    }
    if (id === "preview") {
      const file = files.find((item) => item.id === selected.files[0]);
      if (file) setPreview(file);
      return;
    }
    if (id === "move") beginMove();
    if (id === "settings" && projectId) {
      void navigate({ to: "/app/p/$projectId/settings", params: { projectId } });
      return;
    }
    if (id === "new-folder") openFolderDialog(createParent());
    if (id === "new-file") openFileDialog(createParent());
    if (id === "upload") beginUpload(createParent());
    if (id === "rename") beginRename();
    if (id === "delete") beginDelete();
    if (id === "share") beginShare();
    if (id === "download") selected.files.forEach((nodeId) => window.open(`/api/nodes/${nodeId}/content?download=1`));
    if (id === "publish" && selected.files[0]) setPublishId(selected.files[0]);
  }

  const signedInName = me.data?.user.name || me.data?.user.email || "";

  function showNodeProperties(node: Node) {
    setPropertiesTarget({
      kind: node.kind,
      id: node.id,
      name: node.name,
      path: activeDrawer ? backendDisplayPath(activeDrawer.bucket, node.backendKey) : node.backendKey,
      size: node.size,
      itemType: node.kind === "folder" ? "Folder" : typeLabel(node.name),
      createdAt: node.cachedAt,
      modifiedAt: node.modifiedAt,
      owner: signedInName,
      color: node.color,
      starred: node.starred,
      shareNodeId: node.id,
    });
    setPropertiesOpen(true);
  }

  function showDrawerProperties(drawer: Drawer) {
    setPropertiesTarget({
      kind: "drawer",
      id: drawer.id,
      name: drawer.name,
      path: backendDisplayPath(drawer.bucket, drawer.prefix),
      size: null,
      itemType: "Drawer",
      createdAt: drawer.createdAt,
      modifiedAt: drawer.healthCheckedAt,
      owner: signedInName,
      color: drawer.color,
      starred: drawer.starred,
      shareNodeId: drawer.rootFolderId,
    });
    setPropertiesOpen(true);
  }

  function showSelectionProperties() {
    const file = files.find((item) => item.id === selected.files[0]);
    if (file) {
      showNodeProperties(file);
      return;
    }
    const folder =
      tree.data?.folders.find((item) => item.id === selected.folders[0]) ??
      (tree.data?.root.id === selected.folders[0] ? tree.data.root : null) ??
      (listing.data?.folder.id === folderId ? listing.data.folder : null);
    if (selected.folders[0] && folder) {
      showNodeProperties(folder);
      return;
    }
    const drawer = visibleDrawers.find((item) => item.id === selected.drawers[0]);
    if (drawer) {
      showDrawerProperties(drawer);
      return;
    }
    setPropertiesTarget(null);
    setPropertiesOpen(true);
  }

  async function patchNodeMeta(node: Node, body: { starred?: boolean; color?: LabelColor | null }) {
    try {
      await api(`/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the item");
    }
  }

  async function patchDrawerMeta(drawer: Drawer, body: { starred?: boolean; color?: LabelColor | null }) {
    try {
      await api(`/drawers/${drawer.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the drawer");
    }
  }

  async function renameDrawer(drawer: Drawer) {
    const message = objectNameError(renameValue);
    if (message) {
      toast.error(message);
      return;
    }
    try {
      await api(`/drawers/${drawer.id}`, { method: "PATCH", body: JSON.stringify({ name: renameValue.trim() }) });
      setRenameDrawerId(null);
      await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Rename failed");
    }
  }

  async function reorderDrawer(drawer: Drawer, direction: -1 | 1) {
    const ids = visibleDrawers.map((item) => item.id);
    const index = ids.indexOf(drawer.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const ordered = arrayMove(ids, index, next);
    try {
      await Promise.all(ordered.map((id, order) => api(`/drawers/${id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: order + 1 }) })));
      await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder");
    }
  }

  async function reorderNode(node: Node, siblings: Node[], direction: -1 | 1) {
    if (!node.parentId) return;
    const ids = siblings.map((item) => item.id);
    const index = ids.indexOf(node.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    try {
      await api("/nodes/reorder", { method: "POST", body: JSON.stringify({ parentId: node.parentId, ids: arrayMove(ids, index, next) }) });
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder");
    }
  }

  const menuActions: MenuActions = {
    writesEnabled: !!writesEnabled,
    openNewFolder: () => openFolderDialog(createParent()),
    openNewFile: () => openFileDialog(createParent()),
    openUpload: () => beginUpload(createParent()),
    openProperties: () => showSelectionProperties(),
    drawer(drawer, index, count) {
      return {
        starred: drawer.starred,
        writesEnabled: !!writesEnabled,
        canRename: true,
        canDelete: true,
        canMoveUp: index > 0,
        canMoveDown: index < count - 1,
        canCreate: !!drawer.rootFolderId,
        onStar: () => void patchDrawerMeta(drawer, { starred: !drawer.starred }),
        onColor: (color) => void patchDrawerMeta(drawer, { color }),
        onRename: () => {
          setRenameDrawerId(drawer.id);
          setRenameValue(drawer.name);
        },
        onMoveUp: () => void reorderDrawer(drawer, -1),
        onMoveDown: () => void reorderDrawer(drawer, 1),
        onDelete: () => setDeleteRequest({ kind: "drawer", ids: [drawer.id], label: drawer.name }),
        onNewFolder: () => drawer.rootFolderId && openFolderDialog(drawer.rootFolderId),
        onNewFile: () => drawer.rootFolderId && openFileDialog(drawer.rootFolderId),
        onUpload: () => drawer.rootFolderId && beginUpload(drawer.rootFolderId),
        onProperties: () => showDrawerProperties(drawer),
      };
    },
    folder(node, siblings) {
      const index = siblings.findIndex((item) => item.id === node.id);
      const root = node.parentId == null;
      return {
        starred: node.starred,
        writesEnabled: !!writesEnabled,
        canRename: !root,
        canDelete: !root,
        canMoveUp: !root && index > 0,
        canMoveDown: !root && index >= 0 && index < siblings.length - 1,
        canCreate: true,
        onStar: () => void patchNodeMeta(node, { starred: !node.starred }),
        onColor: (color) => void patchNodeMeta(node, { color }),
        onRename: () => {
          setRenameId(node.id);
          setRenameValue(node.name);
        },
        onMoveUp: () => void reorderNode(node, siblings, -1),
        onMoveDown: () => void reorderNode(node, siblings, 1),
        onDelete: () => setDeleteRequest({ kind: "nodes", ids: [node.id], label: node.name }),
        onNewFolder: () => openFolderDialog(node.id),
        onNewFile: () => openFileDialog(node.id),
        onUpload: () => beginUpload(node.id),
        onProperties: () => showNodeProperties(node),
      };
    },
    file(node, index, count) {
      const parent = node.parentId || folderId;
      return {
        starred: node.starred,
        writesEnabled: !!writesEnabled,
        canRename: !!node.parentId,
        canDelete: true,
        canMoveUp: index > 0,
        canMoveDown: index < count - 1,
        canCreate: !!parent,
        onPreview: () => setPreview(node),
        onStar: () => void patchNodeMeta(node, { starred: !node.starred }),
        onColor: (color) => void patchNodeMeta(node, { color }),
        onRename: () => {
          setRenameId(node.id);
          setRenameValue(node.name);
        },
        onMoveUp: () => void reorderNode(node, files, -1),
        onMoveDown: () => void reorderNode(node, files, 1),
        onDelete: () => setDeleteRequest({ kind: "nodes", ids: [node.id], label: node.name }),
        onNewFolder: () => parent && openFolderDialog(parent),
        onNewFile: () => parent && openFileDialog(parent),
        onUpload: () => parent && beginUpload(parent),
        onProperties: () => showNodeProperties(node),
      };
    },
  };

  const drawerPane = (
    <DrawerPane
      drawers={visibleDrawers}
      selected={selected.drawers}
      activeId={drawerId}
      search={search}
      onSearch={patchSearch}
      onAdd={() => setWizard(true)}
      onChoose={(id, ids, event) => choose("drawers", id, ids, event, () => { const drawer = visibleDrawers.find((item) => item.id === id); if (drawer) openDrawer(drawer); })}
      favorites={!!me.data?.preferences.favoritesOnly}
      starredFirst={!!me.data?.preferences.starredFirst}
      onToggle={(patch) => void savePrefs(patch)}
      renameId={renameDrawerId}
      renameValue={renameValue}
      setRenameValue={setRenameValue}
      onRename={(drawer) => void renameDrawer(drawer)}
    />
  );
  const folderPane = (
    <FolderPane
      root={tree.data?.root ?? null}
      rows={folderRows}
      expanded={expanded}
      selected={selected.folders}
      openId={folderId}
      filter={search.ff}
      onFilter={(ff) => patchSearch({ ff })}
      onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
      onChoose={(id, ids, event) => choose("folders", id, ids, event, () => openFolder(id))}
      emptyFilter={!!search.ff && folderRows.length === 0}
      renameId={renameId}
      renameValue={renameValue}
      setRenameValue={setRenameValue}
      onRename={(node) => void rename(node)}
    />
  );
  const filePane = (
    <FilePane
      listing={listing.data}
      files={files}
      view={view}
      zoom={zoom}
      selected={selected.files}
      writesEnabled={!!writesEnabled}
      filter={search.qf}
      onFilter={(qf) => patchSearch({ qf })}
      onSort={(sort) => patchSearch({ sort, dir: search.sort === sort && search.dir === "asc" ? "desc" : "asc" })}
      onView={(next) => { patchSearch({ view: next }); void savePrefs({ viewMode: next }); }}
      onZoom={(next) => void savePrefs({ zoom: next })}
      onChoose={(id, ids, event) => choose("files", id, ids, event, () => patchSearch({ select: id }))}
      onOpen={(node) => setPreview(node)}
      renameId={renameId}
      renameValue={renameValue}
      setRenameValue={setRenameValue}
      onRename={(node) => void rename(node)}
      tasks={uploadTasks}
      onRetry={(task) => void uploadList([task.file])}
      onUpload={() => fileInput.current?.click()}
    />
  );

  return (
    <AppShell project={project} onOpenCabinet={openCabinet} createOpen={createProject} onCreateOpenChange={setCreateProject} portalSlug={portalSlug}>
      {!projectId && <EmptyProjects onCreate={() => setCreateProject(true)} />}
      {projectId && (
        <>
          <CabinetTabs
            tabs={
              project && !cabinetTabs(me.data?.preferences.locationTabs ?? []).some((tab) => tab.projectId === projectId)
                ? upsertCabinetTab(me.data?.preferences.locationTabs ?? [], { id: projectId, projectId, url: buildLocationUrl(pathname, search), title: project.name, select: search.select })
                : cabinetTabs(me.data?.preferences.locationTabs ?? [])
            }
            activeId={projectId}
            onActivate={followTab}
            onClose={closeTab}
            onReorder={(activeId, overId) => rememberTabs(reorderCabinetTabs(tabsRef.current, activeId, overId))}
          />
          <div className="sheet">
            <MenuContext.Provider value={menuActions}>
            <FileCenterRibbon
              tab={ribbonTab}
              onTabChange={setRibbonTab}
              selection={ribbonSelection}
              onAction={runRibbon}
              searchValue={nameQuery}
              onSearchValue={setNameQuery}
              onSearch={() => void runNameSearch()}
              hits={nameHits}
              searching={nameSearching}
              onOpenHit={openHit}
            />
            <LocationBar
              crumbs={crumbs}
              rootFolderId={activeDrawer?.rootFolderId ?? ""}
              backendPath={listing.data?.backendPath ?? ""}
              onOpen={openCrumb}
              onUp={goUp}
            />
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
              <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {narrow ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
                    {step !== "drawers" && <Button size="sm" variant="ghost" onClick={() => setStep(step === "files" ? "folders" : "drawers")}>Back</Button>}
                    <span className="pane-label">{step}</span>
                  </div>
                  {step === "drawers" && drawerPane}
                  {step === "folders" && folderPane}
                  {step === "files" && filePane}
                </div>
              ) : (
                <PanelGroup
                  direction="horizontal"
                  className="min-h-0 flex-1"
                  onLayout={(sizes) => {
                    window.clearTimeout(paneTimer.current);
                    paneTimer.current = window.setTimeout(() => {
                      void api("/me/preferences", { method: "PATCH", body: JSON.stringify({ paneSizes: { drawers: sizes[0] ?? 22, folders: sizes[1] ?? 26, files: sizes[2] ?? 52 } }) });
                    }, 400);
                  }}
                >
                  <Panel defaultSize={me.data?.preferences.paneSizes.drawers ?? 22} minSize={16}>{drawerPane}</Panel>
                  <PanelResizeHandle className="w-px bg-[var(--line)]" />
                  <Panel defaultSize={me.data?.preferences.paneSizes.folders ?? 26} minSize={16}>{folderPane}</Panel>
                  <PanelResizeHandle className="w-px bg-[var(--line)]" />
                  <Panel defaultSize={me.data?.preferences.paneSizes.files ?? 52} minSize={24}>{filePane}</Panel>
                </PanelGroup>
              )}
              </div>
              {propertiesOpen && <PropertiesPane target={propertiesTarget} onClose={() => setPropertiesOpen(false)} />}
              </div>
            </DndContext>
            <footer className="flex h-10 shrink-0 items-center border-t border-[var(--line)] px-4">
              <StatusCounts
                selected={selected.drawers.length + selected.folders.length + selected.files.length}
                folders={listing.data ? listing.data.folders.length : (tree.data?.folders.length ?? 0)}
                files={listing.data?.totalFiles ?? 0}
              />
            </footer>
            </MenuContext.Provider>
          </div>
        </>
      )}
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadList(event.target.files); event.target.value = ""; }} />
      <DrawerWizard open={wizard} onOpenChange={setWizard} projectId={projectId} projects={projects.data ?? []} />
      <FolderDialog open={folderDialog} onOpenChange={setFolderDialog} drawerId={drawerId} parentId={createParentId || selected.folders[0] || folderId || tree.data?.root.id || ""} scopeLabel={scopeName(createParentId || selected.folders[0] || folderId || tree.data?.root.id || "")} />
      <FileDialog open={fileDialog} onOpenChange={setFileDialog} drawerId={drawerId} folderId={createParentId || folderId || tree.data?.root.id || ""} scopeLabel={scopeName(createParentId || folderId || tree.data?.root.id || "")} />
      <ShareDialog nodeId={shareId} open={!!shareId} onOpenChange={(open) => !open && setShareId(null)} />
      <PublishDialog fileId={publishId} fileName={publishName} open={!!publishId} onOpenChange={(open) => !open && setPublishId(null)} />
      <PreviewSheet node={preview} onOpenChange={(open) => !open && setPreview(null)} />
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move</DialogTitle>
            <DialogDescription>Choose a folder in this drawer. The move is saved with the cabinet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="move-destination">Destination</Label>
            {moveDestinations.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">Open a drawer with a folder before moving.</p>
            ) : (
              <Select value={moveDestination} onValueChange={setMoveDestination}>
                <SelectTrigger id="move-destination" aria-label="Destination folder">
                  <SelectValue placeholder="Choose a folder" />
                </SelectTrigger>
                <SelectContent>
                  {moveDestinations.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button disabled={!moveDestination} onClick={() => void confirmMove()}>Move</Button>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteConfirm
        open={!!deleteRequest}
        title={deleteRequest ? `Delete ${deleteRequest.label}?` : "Delete?"}
        description={deleteRequest?.kind === "drawer" ? "Delete removes this drawer from the cabinet." : "Delete removes the selection on the backend, including everything inside a folder."}
        onOpenChange={(open) => !open && setDeleteRequest(null)}
        onConfirm={() => void confirmDelete()}
      />
      <CommandDialog open={palette} onOpenChange={setPalette}>
        <CommandInput placeholder="Jump or run a command" />
        <CommandList>
          <CommandEmpty>No names match</CommandEmpty>
          <CommandGroup heading="Commands">
            <CommandItem onSelect={() => { setPalette(false); setWizard(true); }}>New drawer</CommandItem>
            <CommandItem onSelect={() => { setPalette(false); setFolderDialog(true); }}>New folder</CommandItem>
            <CommandItem onSelect={() => { setPalette(false); fileInput.current?.click(); }}>Upload</CommandItem>
            <CommandItem onSelect={() => { setPalette(false); setShareId(folderId || activeDrawer?.rootFolderId || null); }}>Share</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Cabinets">
            {projects.data?.map((item) => (
              <CommandItem key={item.id} onSelect={() => { setPalette(false); openCabinet(item); }}>{item.name}</CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Drawers">
            {visibleDrawers.map((drawer) => (
              <CommandItem key={drawer.id} onSelect={() => { setPalette(false); openDrawer(drawer); }}>{drawer.name}</CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </AppShell>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function create(kind: Project["kind"], name: string) {
    const project = await api<Project>("/projects", { method: "POST", body: JSON.stringify({ name, kind }) });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    void navigate({ to: "/app/p/$projectId", params: { projectId: project.id } });
  }
  return (
    <div className="m-4 rounded-xl border border-[var(--line)] bg-white p-8 shadow-sm">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-xl font-semibold">No cabinet yet</h1>
        <p className="text-[var(--ink-soft)]">Create Work, Personal, School, or Sports, or type a name.</p>
        <div className="flex flex-wrap gap-2">
          {(["work", "personal", "school", "sports"] as const).map((kind) => (
            <Button key={kind} variant="outline" onClick={() => void create(kind, kind[0].toUpperCase() + kind.slice(1))}>
              {kind[0].toUpperCase() + kind.slice(1)}
            </Button>
          ))}
        </div>
        <Button onClick={onCreate}>Custom name</Button>
      </div>
    </div>
  );
}

function DrawerPane({ drawers, selected, activeId, search, onSearch, onChoose, onAdd, favorites, starredFirst, onToggle, renameId, renameValue, setRenameValue, onRename }: { drawers: Drawer[]; selected: string[]; activeId: string; search: ExplorerSearch; onSearch: (patch: Partial<ExplorerSearch>) => void; onChoose: (id: string, ids: string[], event: MouseEvent) => void; onAdd: () => void; favorites: boolean; starredFirst: boolean; onToggle: (patch: Partial<Preferences>) => void; renameId: string | null; renameValue: string; setRenameValue: (value: string) => void; onRename: (drawer: Drawer) => void }) {
  const ids = drawers.map((drawer) => drawer.id);
  return (
    <section className="flex h-full min-h-0 flex-col border-r border-[var(--line)]">
      <PaneHeader title="Drawers" filter={search.df} onFilter={(df) => onSearch({ df })} />
      <div className="flex items-center gap-1 px-3 pb-2">
        <Button size="sm" variant={favorites ? "secondary" : "ghost"} onClick={() => onToggle({ favoritesOnly: !favorites })}>Favorites</Button>
        <Button size="sm" variant={starredFirst ? "secondary" : "ghost"} onClick={() => onToggle({ starredFirst: !starredFirst })}>Starred first</Button>
        {LABEL_COLORS.map((color) => (
          <button key={color} aria-label={color} className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[color]} ${search.dc === color ? "ring-2 ring-[#1d4ed8] ring-offset-1" : ""}`} onClick={() => onSearch({ dc: search.dc === color ? "" : color })} />
        ))}
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="min-h-0 flex-1 overflow-auto px-2">
          {drawers.length === 0 && search.df && <p className="px-2 py-6 text-center text-sm text-[var(--ink-soft)]">No names match <button className="text-[#1d4ed8]" onClick={() => onSearch({ df: "" })}>Clear</button></p>}
          {drawers.length === 0 && !search.df && (
            <EmptyPane icon={<Folder className="h-5 w-5" />} title="No drawers yet" detail="A linked drawer uses your bucket. A hosted drawer uses the StorageFlow plan." />
          )}
          {drawers.map((drawer, index) => (
            <DrawerRow key={drawer.id} drawer={drawer} index={index} count={drawers.length} selected={selected.includes(drawer.id) || drawer.id === activeId} onClick={(event) => onChoose(drawer.id, ids, event)} rename={renameId === drawer.id} renameValue={renameValue} setRenameValue={setRenameValue} onRename={() => onRename(drawer)} />
          ))}
        </div>
      </SortableContext>
      <button className="m-3 flex h-9 items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--line)] text-sm text-[var(--ink-soft)] hover:bg-[#f8fafc] hover:text-[var(--ink)]" onClick={onAdd}>
        + Add drawer
      </button>
    </section>
  );
}

function DrawerRow({ drawer, index, count, selected, onClick, rename, renameValue, setRenameValue, onRename }: { drawer: Drawer; index: number; count: number; selected: boolean; onClick: (event: MouseEvent) => void; rename: boolean; renameValue: string; setRenameValue: (value: string) => void; onRename: () => void }) {
  const menus = useMenus();
  const sortable = useSortable({ id: drawer.id });
  const row = (
    <button
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="cabinet-row"
      data-selected={selected}
      data-kind="drawer"
      onClick={onClick}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${drawer.color ? TINT[drawer.color] : "bg-amber-50 text-amber-600"}`}>
        <Folder className="h-4 w-4" />
      </span>
      {rename ? (
        <input className="h-7 flex-1 rounded-md border px-2" aria-label={`Rename ${drawer.name}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onRename()} onClick={(event) => event.stopPropagation()} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{drawer.name}</span>
      )}
      {drawer.starred && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
      <span className={`h-2 w-2 rounded-full ${drawer.healthOk === false ? "bg-red-500" : "bg-emerald-500"}`} title={drawer.healthMessage ?? "Reachable"} />
      {drawer.jobs[0] && <span className="text-xs text-[var(--ink-soft)]">{drawer.jobs[0].status}</span>}
    </button>
  );
  if (!menus) return row;
  return <ItemMenu {...menus.drawer(drawer, index, count)}>{row}</ItemMenu>;
}

function FolderPane({ root, rows, expanded, selected, openId, filter, onFilter, onToggle, onChoose, emptyFilter, renameId, renameValue, setRenameValue, onRename }: { root: Node | null; rows: Node[]; expanded: Set<string>; selected: string[]; openId: string; filter: string; onFilter: (value: string) => void; onToggle: (id: string) => void; onChoose: (id: string, ids: string[], event: MouseEvent) => void; emptyFilter: boolean; renameId: string | null; renameValue: string; setRenameValue: (value: string) => void; onRename: (node: Node) => void }) {
  const ids = [root?.id ?? "", ...rows.map((row) => row.id)].filter(Boolean);
  const depthOf = (folder: Node) => {
    let depth = 1;
    let parent = folder.parentId;
    const byId = new Map(rows.map((row) => [row.id, row]));
    while (parent && parent !== root?.id) {
      depth += 1;
      parent = byId.get(parent)?.parentId ?? null;
      if (depth > 12) break;
    }
    return depth;
  };
  return (
    <section className="flex h-full min-h-0 flex-col border-r border-[var(--line)]">
      <PaneHeader title="Folders" filter={filter} onFilter={onFilter} />
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {!root && <EmptyPane icon={<FolderOpen className="h-5 w-5" />} title="No drawer selected" detail="Select a drawer from the left panel." />}
        {emptyFilter && <p className="px-2 py-6 text-center text-sm text-[var(--ink-soft)]">No names match <button className="text-[#1d4ed8]" onClick={() => onFilter("")}>Clear</button></p>}
        {root && <FolderRow node={root} siblings={rows.filter((folder) => folder.parentId === root.id)} depth={0} expanded={expanded.has(root.id)} selected={selected.includes(root.id) || openId === root.id} onToggle={() => onToggle(root.id)} onClick={(event) => onChoose(root.id, ids, event)} rename={false} renameValue="" setRenameValue={setRenameValue} onRename={() => undefined} />}
        {rows.map((folder) => (
          <FolderRow key={folder.id} node={folder} siblings={rows.filter((item) => item.parentId === folder.parentId)} depth={depthOf(folder)} expanded={expanded.has(folder.id)} selected={selected.includes(folder.id) || openId === folder.id} onToggle={() => onToggle(folder.id)} onClick={(event) => onChoose(folder.id, ids, event)} rename={renameId === folder.id} renameValue={renameValue} setRenameValue={setRenameValue} onRename={() => onRename(folder)} />
        ))}
      </div>
    </section>
  );
}

function FolderRow({ node, siblings, depth, expanded, selected, onToggle, onClick, rename, renameValue, setRenameValue, onRename }: { node: Node; siblings: Node[]; depth: number; expanded: boolean; selected: boolean; onToggle: () => void; onClick: (event: MouseEvent) => void; rename: boolean; renameValue: string; setRenameValue: (value: string) => void; onRename: () => void }) {
  const menus = useMenus();
  const drop = useDroppable({ id: `folder:${node.id}` });
  const row = (
    <div ref={drop.setNodeRef} className="flex items-center" style={{ paddingLeft: depth * 14 }} data-kind="folder">
      <button aria-label={expanded ? "Collapse" : "Expand"} className="grid h-8 w-5 place-items-center text-[var(--ink-soft)]" onClick={onToggle}>
        <ChevronRight className={`h-3.5 w-3.5 ${expanded ? "rotate-90" : ""}`} />
      </button>
      <button className="cabinet-row" data-selected={selected || drop.isOver} onClick={onClick}>
        <Folder className={`h-4 w-4 shrink-0 ${node.color ? "text-current" : "text-amber-500"}`} />
        {rename ? (
          <input className="h-7 flex-1 rounded-md border px-2" aria-label={`Rename ${node.name}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onRename()} onClick={(event) => event.stopPropagation()} />
        ) : (
          <span className="truncate text-sm">{node.name}</span>
        )}
      </button>
    </div>
  );
  if (!menus) return row;
  return <ItemMenu {...menus.folder(node, siblings)}>{row}</ItemMenu>;
}

function FilePane(props: {
  listing?: Listing;
  files: Node[];
  view: "grid" | "list" | "details";
  zoom: number;
  selected: string[];
  writesEnabled: boolean;
  filter: string;
  onFilter: (value: string) => void;
  onSort: (sort: string) => void;
  onView: (view: "grid" | "list" | "details") => void;
  onZoom: (zoom: number) => void;
  onChoose: (id: string, ids: string[], event: MouseEvent) => void;
  onOpen: (node: Node) => void;
  renameId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onRename: (node: Node) => void;
  tasks: { id: string; name: string; progress: number; status: string; error?: string; file: File }[];
  onRetry: (task: { file: File }) => void;
  onUpload: () => void;
}) {
  const menus = useMenus();
  const ids = props.files.map((file) => file.id);
  const filteredEmpty = !!props.filter && props.files.length === 0;
  const canCreate = props.writesEnabled && !!props.listing;
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="pane-label">Files</span>
        <Input aria-label="Filter files" value={props.filter} onChange={(event) => props.onFilter(event.target.value)} className="h-8 max-w-44" placeholder="Filter files" />
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="outline" disabled={!canCreate} onClick={() => menus?.openNewFolder()}>New folder</Button>
          <Button size="sm" variant="outline" disabled={!canCreate} onClick={() => menus?.openNewFile()}>New file</Button>
          <Button size="sm" variant="outline" disabled={!canCreate} onClick={() => menus?.openUpload()}>Upload</Button>
          <Button size="sm" variant="outline" onClick={() => menus?.openProperties()}>Properties</Button>
          <Button size="sm" variant={props.view === "grid" ? "secondary" : "ghost"} aria-label="Grid" onClick={() => props.onView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="sm" variant={props.view === "list" ? "secondary" : "ghost"} aria-label="List" onClick={() => props.onView("list")}><List className="h-4 w-4" /></Button>
          <Button size="sm" variant={props.view === "details" ? "secondary" : "ghost"} aria-label="Details" onClick={() => props.onView("details")}><Table2 className="h-4 w-4" /></Button>
          {props.view === "grid" && (
            <>
              <Button size="sm" variant="ghost" onClick={() => props.onZoom(Math.max(1, props.zoom - 1))}>-</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onZoom(Math.min(4, props.zoom + 1))}>+</Button>
            </>
          )}
        </div>
      </div>
      {props.listing?.stale && (
        <p className="border-b border-[var(--line)] bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Showing the cached listing from {formatWhen(props.listing.listedAt)}. {props.listing.error} Writes stay hidden until the backend answers.
        </p>
      )}
      {props.listing?.drawer.healthOk === false && <p className="px-4 py-2 text-sm text-destructive">{props.listing.drawer.healthMessage}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        {!props.listing && <EmptyPane icon={<File className="h-5 w-5" />} title="No drawer selected" detail="Select a drawer from the left panel." />}
        {filteredEmpty && (
          <EmptyPane icon={<File className="h-5 w-5" />} title="No names match" detail="Clear the filter to see the files in this folder." action={<Button size="sm" variant="outline" onClick={() => props.onFilter("")}>Clear</Button>} />
        )}
        {props.listing && !filteredEmpty && props.files.length === 0 && (
          <EmptyPane
            icon={<FileText className="h-5 w-5" />}
            title="This folder is empty"
            detail="Upload is the way to put files here."
            action={props.writesEnabled ? <Button type="button" onClick={props.onUpload}><Upload className="h-4 w-4" /> Upload</Button> : undefined}
          />
        )}
        {props.files.length > 0 && (props.view === "details" ? (
          <DetailsTable files={props.files} selected={props.selected} onChoose={props.onChoose} onSort={props.onSort} />
        ) : props.view === "list" ? (
          <div className="px-2 py-1">
            {props.files.map((file, index) => (
              <FileRow key={file.id} file={file} index={index} count={props.files.length} selected={props.selected.includes(file.id)} onClick={(event) => props.onChoose(file.id, ids, event)} onOpen={() => props.onOpen(file)} rename={props.renameId === file.id} renameValue={props.renameValue} setRenameValue={props.setRenameValue} onRename={() => props.onRename(file)} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: `repeat(${[6, 5, 4, 3][props.zoom - 1] ?? 4}, minmax(0, 1fr))` }}>
            {props.files.map((file, index) => (
              <FileCard key={file.id} file={file} index={index} count={props.files.length} selected={props.selected.includes(file.id)} onClick={(event) => props.onChoose(file.id, ids, event)} onOpen={() => props.onOpen(file)} />
            ))}
          </div>
        ))}
        {props.tasks.map((task) => (
          <div key={task.id} className="mt-2 text-xs">
            {task.name} {Math.round(task.progress * 100)}% {task.status}
            {task.status === "error" && <Button size="sm" variant="ghost" onClick={() => props.onRetry(task)}>Retry</Button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FileRow({ file, index, count, selected, onClick, onOpen, rename, renameValue, setRenameValue, onRename }: { file: Node; index: number; count: number; selected: boolean; onClick: (event: MouseEvent) => void; onOpen: () => void; rename: boolean; renameValue: string; setRenameValue: (value: string) => void; onRename: () => void }) {
  const menus = useMenus();
  const drag = useDraggable({ id: `node:${file.id}` });
  const row = (
    <button ref={drag.setNodeRef} className="cabinet-row" data-selected={selected} data-kind="file" onClick={onClick} onDoubleClick={onOpen} {...drag.listeners} {...drag.attributes}>
      <FileGlyph name={file.name} />
      {rename ? (
        <input className="h-7 flex-1 rounded-md border px-2" aria-label={`Rename ${file.name}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onRename()} onClick={(event) => event.stopPropagation()} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{file.incomplete ? "Incomplete · " : ""}{file.name}</span>
      )}
      <span className="text-xs text-[var(--ink-soft)]">{formatBytes(file.size)}</span>
      {file.starred && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
    </button>
  );
  if (!menus) return row;
  return <ItemMenu {...menus.file(file, index, count)}>{row}</ItemMenu>;
}

function FileCard({ file, index, count, selected, onClick, onOpen }: { file: Node; index: number; count: number; selected: boolean; onClick: (event: MouseEvent) => void; onOpen: () => void }) {
  const menus = useMenus();
  const drag = useDraggable({ id: `node:${file.id}` });
  const card = (
    <button ref={drag.setNodeRef} className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-white p-3 text-center hover:border-[#cdd5e0] data-[selected=true]:border-[#93c5fd] data-[selected=true]:bg-[#eef4ff]" data-selected={selected} data-kind="file" onClick={onClick} onDoubleClick={onOpen} {...drag.listeners} {...drag.attributes}>
      <FileGlyph name={file.name} large />
      <span className="w-full truncate text-sm">{file.name}</span>
      <span className="text-xs text-[var(--ink-soft)]">{typeLabel(file.name)}</span>
    </button>
  );
  if (!menus) return card;
  return <ItemMenu {...menus.file(file, index, count)}>{card}</ItemMenu>;
}

const columnHelper = createColumnHelper<Node>();
const columns = [
  columnHelper.accessor("name", {
    header: DETAIL_COLUMN_HEADERS[0],
    cell: (info) => (
      <span className="flex items-center gap-2">
        <FileGlyph name={info.getValue()} />
        <span className="truncate">{info.getValue()}</span>
      </span>
    ),
  }),
  columnHelper.accessor("size", { header: DETAIL_COLUMN_HEADERS[1], cell: (info) => formatBytes(info.getValue()) }),
  columnHelper.accessor((row) => typeLabel(row.name), { id: "type", header: DETAIL_COLUMN_HEADERS[2] }),
  columnHelper.accessor("modifiedAt", { header: DETAIL_COLUMN_HEADERS[3], cell: (info) => formatWhen(info.getValue()) }),
  columnHelper.accessor("color", { header: DETAIL_COLUMN_HEADERS[4], cell: (info) => info.getValue() ?? "none" }),
  columnHelper.accessor("starred", { header: DETAIL_COLUMN_HEADERS[5], cell: (info) => (info.getValue() ? "Yes" : "") }),
];

export function DetailsTable({ files, selected, onChoose, onSort }: { files: Node[]; selected: string[]; onChoose: (id: string, ids: string[], event: MouseEvent) => void; onSort: (sort: string) => void }) {
  const menus = useMenus();
  const table = useReactTable({ data: files, columns, getCoreRowModel: getCoreRowModel() });
  const ids = files.map((file) => file.id);
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="border-b border-[var(--line)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                <button onClick={() => onSort(header.column.id === "modifiedAt" ? "modified" : header.column.id)}>{flexRender(header.column.columnDef.header, header.getContext())}</button>
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row, index) => {
          const line = (
            <tr key={row.id} data-selected={selected.includes(row.original.id)} data-kind="file" className="h-12 hover:bg-[#f8fafc] data-[selected=true]:bg-[#eef4ff]" onClick={(event) => onChoose(row.original.id, ids, event)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border-b border-[var(--line)] px-4">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          );
          if (!menus) return line;
          return (
            <ItemMenu key={row.id} {...menus.file(row.original, index, files.length)}>
              {line}
            </ItemMenu>
          );
        })}
      </tbody>
    </table>
  );
}

function PaneHeader({ title, filter, onFilter }: { title: string; filter: string; onFilter: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <span className="pane-label">{title}</span>
      <Input aria-label={`Filter ${title.toLowerCase()}`} value={filter} onChange={(event) => onFilter(event.target.value)} className="h-8" placeholder={`Filter ${title.toLowerCase()}`} />
    </div>
  );
}

function EmptyPane({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty-pane">
      <div className="max-w-xs">
        <div className="empty-mark">{icon}</div>
        <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">{detail}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

const TINT: Record<string, string> = {
  red: "bg-red-50 text-red-600",
  orange: "bg-orange-50 text-orange-600",
  yellow: "bg-yellow-50 text-yellow-700",
  green: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  purple: "bg-violet-50 text-violet-600",
  pink: "bg-pink-50 text-pink-600",
  gray: "bg-neutral-100 text-neutral-600",
};

function FileGlyph({ name, large }: { name: string; large?: boolean }) {
  const extension = extensionOf(name);
  const image = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension);
  const Icon = image ? ImageIcon : extension === "pdf" || extension === "txt" || extension === "md" ? FileText : File;
  const tone = image ? "bg-rose-50 text-rose-600" : extension === "pdf" ? "bg-red-50 text-red-600" : "bg-sky-50 text-sky-700";
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg ${tone} ${large ? "h-12 w-12" : "h-8 w-8"}`}>
      <Icon className={large ? "h-5 w-5" : "h-4 w-4"} />
    </span>
  );
}

function PreviewSheet({ node, onOpenChange }: { node: Node | null; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!node) return;
    const kind = fileKind(node.name, node.contentType);
    let objectUrl = "";
    if (kind === "text") {
      void fetch(`/api/nodes/${node.id}/content`, { credentials: "include" }).then((response) => response.text()).then(setText);
    } else if (kind !== "other") {
      void fetch(`/api/nodes/${node.id}/content`, { credentials: "include" }).then((response) => response.blob()).then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      });
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setText("");
      setUrl("");
    };
  }, [node]);
  const kind = node ? fileKind(node.name, node.contentType) : "other";
  return (
    <Sheet open={!!node} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle className="border-b px-4 py-3 pr-10 text-sm font-medium">{node?.name}</SheetTitle>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {kind === "image" && url && <img src={url} alt={node?.name ?? ""} className="max-w-full" />}
          {kind === "pdf" && url && <iframe title={node?.name} src={url} className="h-[70vh] w-full" />}
          {kind === "text" && <pre className="whitespace-pre-wrap text-sm">{text}</pre>}
          {kind === "audio" && url && <audio controls src={url} />}
          {kind === "video" && url && <video controls src={url} className="max-w-full" />}
          {kind === "other" && node && (
            <p className="text-sm">
              Unknown file. <a className="underline" href={`/api/nodes/${node.id}/content?download=1`}>Download</a>
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function sendFile(ticket: { uploadId: string; transport: string; url?: string }, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.transport === "presigned" && ticket.url ? ticket.url : `/api/uploads/${ticket.uploadId}/body`);
    xhr.withCredentials = ticket.transport !== "presigned";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}
