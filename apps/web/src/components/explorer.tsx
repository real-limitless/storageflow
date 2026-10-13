import { closestCenter, DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  buildTree,
  flattenTree,
  LABEL_COLORS,
  typeLabel,
  type Drawer,
  type FolderTree,
  type Listing,
  type Me,
  type Node,
  type Preferences,
  type Project,
  type SearchHit,
} from "@storageflow/domain";
import { ChevronRight, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { DrawerWizard, FolderDialog, ProjectCreateDialog, PublishDialog, ShareDialog } from "@/components/dialogs";
import { WorkspaceHeader } from "@/components/header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { COLOR_CLASS, fileKind, formatBytes, formatWhen } from "@/lib/format";
import { validateExplorerSearch, type ExplorerSearch } from "@/lib/search";
import { uploads, useUploads } from "@/lib/uploads";

type Pane = "drawers" | "folders" | "files";

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
  const [createProject, setCreateProject] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const paneTimer = useRef<number | undefined>(undefined);
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
  const hits = useQuery({
    queryKey: ["search", projectId, ""],
    queryFn: () => api<SearchHit[]>(`/projects/${projectId}/search?q=`),
    enabled: false,
  });
  const view = search.view ?? me.data?.preferences.viewMode ?? "grid";
  const zoom = me.data?.preferences.zoom ?? 2;
  const writesEnabled = listing.data ? listing.data.drawer.healthOk !== false && !listing.data.stale : drawers.data?.find((drawer) => drawer.id === drawerId)?.healthOk !== false;
  const activeDrawer = drawers.data?.find((drawer) => drawer.id === drawerId) ?? listing.data?.drawer ?? null;

  useEffect(() => {
    if (tree.data?.root.id) setExpanded((current) => new Set(current).add(tree.data.root.id));
  }, [tree.data?.root.id]);

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
    if (!projectId || !me.data) return;
    const title = [project?.name, activeDrawer?.name, listing.data?.folder.name].filter(Boolean).join(" / ");
    const tabs = me.data.preferences.locationTabs.filter((tab) => tab.url !== pathname);
    const next = [{ id: pathname, url: pathname, title: title || "Cabinet" }, ...tabs].slice(0, 12);
    const same = JSON.stringify(next) === JSON.stringify(me.data.preferences.locationTabs) && me.data.preferences.lastProjectId === projectId;
    if (same) return;
    void api("/me/preferences", { method: "PATCH", body: JSON.stringify({ locationTabs: next, lastProjectId: projectId }) });
  }, [pathname, projectId, project?.name, activeDrawer?.name, listing.data?.folder.name, me.data]);

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
    void navigate({ to: "/app/p/$projectId/d/$drawerId/f/$folderId", params: { projectId, drawerId: drawer.id, folderId: drawer.rootFolderId }, search });
  }

  function openFolder(id: string) {
    if (!drawerId) return;
    setStep("files");
    void navigate({ to: "/app/p/$projectId/d/$drawerId/f/$folderId", params: { projectId, drawerId, folderId: id }, search });
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
    if (!drawerId || !folderId) return;
    for (const file of [...list]) {
      const id = crypto.randomUUID();
      uploads.add({ id, name: file.name, folderId, progress: 0, status: "uploading", file });
      try {
        const ticket = await api<{ uploadId: string; transport: "presigned" | "proxy"; url?: string }>(`/drawers/${drawerId}/uploads`, {
          method: "POST",
          body: JSON.stringify({ folderId, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
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
    await queryClient.invalidateQueries({ queryKey: ["listing", drawerId, folderId] });
  }

  async function rename(node: Node) {
    try {
      await api(`/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ name: renameValue }) });
      setRenameId(null);
      await queryClient.invalidateQueries({ queryKey: ["listing"] });
      await queryClient.invalidateQueries({ queryKey: ["tree"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Rename failed");
    }
  }

  async function remove(ids: string[]) {
    const nodes = [...(listing.data?.files ?? []), ...(listing.data?.folders ?? []), ...(tree.data?.folders ?? [])].filter((node) => ids.includes(node.id));
    const needsConfirm = ids.length > 1 || nodes.some((node) => node.kind === "folder");
    if (needsConfirm) {
      setDeleteIds(ids);
      return;
    }
    await confirmDelete(ids);
  }

  async function confirmDelete(ids: string[]) {
    try {
      await api("/nodes/delete", { method: "POST", body: JSON.stringify({ nodeIds: ids }) });
      setDeleteIds([]);
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

  const actions = [
    focus === "files" ? { id: "upload", label: "Upload", run: () => fileInput.current?.click(), disabled: !writesEnabled } : { id: "new", label: focus === "folders" ? "New folder" : "New drawer", run: () => (focus === "folders" ? setFolderDialog(true) : setWizard(true)), disabled: focus !== "drawers" && !writesEnabled },
    { id: "share", label: "Share", run: () => setShareId(focus === "drawers" ? activeDrawer?.rootFolderId ?? null : focus === "folders" ? selected.folders[0] ?? folderId : selected.files[0] ?? null), disabled: false },
    { id: "download", label: "Download", run: () => selected.files.forEach((id) => window.open(`/api/nodes/${id}/content?download=1`)), disabled: focus !== "files" || selected.files.length === 0 },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-density="compact" onKeyDown={() => undefined}>
      <WorkspaceHeader
        project={project}
        onCreateProject={() => setCreateProject(true)}
        actions={
          <>
            <Input
              aria-label="Search this project"
              placeholder="Search cached names"
              className="max-w-xs"
              onKeyDown={async (event) => {
                if (event.key !== "Enter" || !projectId) return;
                const found = await api<SearchHit[]>(`/projects/${projectId}/search?q=${encodeURIComponent(event.currentTarget.value)}`);
                const hit = found[0];
                if (!hit) {
                  toast("No names match");
                  return;
                }
                const parent = hit.node.kind === "folder" ? hit.node.id : hit.parentId;
                if (parent) void navigate({ to: "/app/p/$projectId/d/$drawerId/f/$folderId", params: { projectId, drawerId: hit.drawerId, folderId: parent }, search: { ...search, select: hit.node.id } });
              }}
            />
            {actions.slice(0, 3).map((action) => (
              <Button key={action.id} size="sm" variant="outline" disabled={action.disabled} onClick={action.run}>
                {action.label}
              </Button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setPalette(true)}>Command palette</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => selected.files[0] && setPublishId(selected.files[0])}>Publish</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void remove(selected.files)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {(me.data?.preferences.locationTabs ?? []).map((tab) => (
          <button key={tab.id} className={`rounded-md px-2 py-1 text-xs ${tab.url === pathname ? "bg-accent" : ""}`} onClick={() => window.location.assign(tab.url)}>
            {tab.title}
          </button>
        ))}
      </div>
      {!projectId && <EmptyProjects onCreate={() => setCreateProject(true)} />}
      {projectId && !drawerId && (drawers.data?.length ?? 0) === 0 && (
        <div className="mx-auto max-w-xl space-y-3 p-8">
          <h1 className="text-lg font-semibold">{project?.name} has no drawers</h1>
          <p>A linked drawer uses a bucket or server you already run. A hosted drawer stores bytes on the StorageFlow plan. The drawer name is not the backend.</p>
          <Button onClick={() => setWizard(true)}>New drawer</Button>
        </div>
      )}
      {projectId && (drawerId || (drawers.data?.length ?? 0) > 0) && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
          {narrow ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b px-2 py-1">
                {step !== "drawers" && (
                  <Button size="sm" variant="ghost" onClick={() => setStep(step === "files" ? "folders" : "drawers")}>
                    Back
                  </Button>
                )}
                <span className="text-sm capitalize">{step}</span>
              </div>
              {step === "drawers" && <DrawerPane drawers={visibleDrawers} selected={selected.drawers} activeId={drawerId} search={search} onSearch={patchSearch} onChoose={(id, ids, event) => choose("drawers", id, ids, event, () => { const drawer = visibleDrawers.find((item) => item.id === id); if (drawer) openDrawer(drawer); })} favorites={!!me.data?.preferences.favoritesOnly} starredFirst={!!me.data?.preferences.starredFirst} onToggle={(patch) => void savePrefs(patch)} />}
              {step === "folders" && <FolderPane root={tree.data?.root ?? null} rows={folderRows} expanded={expanded} selected={selected.folders} openId={folderId} filter={search.ff} onFilter={(ff) => patchSearch({ ff })} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onChoose={(id, ids, event) => choose("folders", id, ids, event, () => openFolder(id))} emptyFilter={!!search.ff && folderRows.length === 0} />}
              {step === "files" && <FilePane listing={listing.data} files={files} view={view} zoom={zoom} selected={selected.files} writesEnabled={!!writesEnabled} filter={search.qf} onFilter={(qf) => patchSearch({ qf })} onSort={(sort) => patchSearch({ sort, dir: search.sort === sort && search.dir === "asc" ? "desc" : "asc" })} onView={(next) => { patchSearch({ view: next }); void savePrefs({ viewMode: next }); }} onZoom={(next) => void savePrefs({ zoom: next })} onChoose={(id, ids, event) => choose("files", id, ids, event)} onOpen={(node) => setPreview(node)} renameId={renameId} renameValue={renameValue} setRenameValue={setRenameValue} onRename={(node) => void rename(node)} tasks={uploadTasks} onRetry={(task) => void uploadList([task.file])} onUpload={() => fileInput.current?.click()} />}
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
              <Panel defaultSize={me.data?.preferences.paneSizes.drawers ?? 22} minSize={14}>
                <DrawerPane drawers={visibleDrawers} selected={selected.drawers} activeId={drawerId} search={search} onSearch={patchSearch} onChoose={(id, ids, event) => choose("drawers", id, ids, event, () => { const drawer = visibleDrawers.find((item) => item.id === id); if (drawer) openDrawer(drawer); })} favorites={!!me.data?.preferences.favoritesOnly} starredFirst={!!me.data?.preferences.starredFirst} onToggle={(patch) => void savePrefs(patch)} />
              </Panel>
              <PanelResizeHandle className="w-px bg-border" />
              <Panel defaultSize={me.data?.preferences.paneSizes.folders ?? 26} minSize={14}>
                <FolderPane root={tree.data?.root ?? null} rows={folderRows} expanded={expanded} selected={selected.folders} openId={folderId} filter={search.ff} onFilter={(ff) => patchSearch({ ff })} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onChoose={(id, ids, event) => choose("folders", id, ids, event, () => openFolder(id))} emptyFilter={!!search.ff && folderRows.length === 0} />
              </Panel>
              <PanelResizeHandle className="w-px bg-border" />
              <Panel defaultSize={me.data?.preferences.paneSizes.files ?? 52} minSize={20}>
                <FilePane listing={listing.data} files={files} view={view} zoom={zoom} selected={selected.files} writesEnabled={!!writesEnabled} filter={search.qf} onFilter={(qf) => patchSearch({ qf })} onSort={(sort) => patchSearch({ sort, dir: search.sort === sort && search.dir === "asc" ? "desc" : "asc" })} onView={(next) => { patchSearch({ view: next }); void savePrefs({ viewMode: next }); }} onZoom={(next) => void savePrefs({ zoom: next })} onChoose={(id, ids, event) => choose("files", id, ids, event)} onOpen={(node) => setPreview(node)} renameId={renameId} renameValue={renameValue} setRenameValue={setRenameValue} onRename={(node) => void rename(node)} tasks={uploadTasks} onRetry={(task) => void uploadList([task.file])} onUpload={() => fileInput.current?.click()} />
              </Panel>
            </PanelGroup>
          )}
        </DndContext>
      )}
      <footer className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        {listing.data?.breadcrumb.map((segment, index) => (
          <span key={segment.id} className="flex items-center gap-2">
            {index > 0 && <span>/</span>}
            <button className="text-foreground" onClick={() => segment.kind === "folder" && openFolder(segment.id)}>
              {segment.name}
            </button>
          </span>
        ))}
        {listing.data && <span className="ml-auto">{listing.data.backendPath} · {listing.data.totalFiles} items</span>}
      </footer>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadList(event.target.files); event.target.value = ""; }} />
      <DrawerWizard open={wizard} onOpenChange={setWizard} projectId={projectId} projects={projects.data ?? []} />
      <FolderDialog open={folderDialog} onOpenChange={setFolderDialog} drawerId={drawerId} parentId={selected.folders[0] || folderId || tree.data?.root.id || ""} />
      <ShareDialog nodeId={shareId} open={!!shareId} onOpenChange={(open) => !open && setShareId(null)} />
      <PublishDialog fileId={publishId} fileName={publishName} open={!!publishId} onOpenChange={(open) => !open && setPublishId(null)} />
      <ProjectCreateDialog open={createProject} onOpenChange={setCreateProject} onCreated={(created) => void navigate({ to: "/app/p/$projectId", params: { projectId: created.id } })} />
      <PreviewSheet node={preview} onOpenChange={(open) => !open && setPreview(null)} />
      <AlertDialog open={deleteIds.length > 0} onOpenChange={(open) => !open && setDeleteIds([])}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete {deleteIds.length} items?</AlertDialogTitle>
          <AlertDialogDescription>Delete removes the selection on the backend, including everything inside a folder.</AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button variant="destructive" onClick={() => void confirmDelete(deleteIds)}>Delete</Button></AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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
          <CommandGroup heading="Projects">
            {projects.data?.map((item) => (
              <CommandItem key={item.id} onSelect={() => { setPalette(false); void navigate({ to: "/app/p/$projectId", params: { projectId: item.id } }); }}>{item.name}</CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Drawers">
            {visibleDrawers.map((drawer) => (
              <CommandItem key={drawer.id} onSelect={() => { setPalette(false); openDrawer(drawer); }}>{drawer.name}</CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <span className="hidden">{hits.status}</span>
    </div>
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
    <div className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-lg font-semibold">No project yet</h1>
      <p>Create Work, Personal, School, or Sports, or type a name.</p>
      <div className="flex flex-wrap gap-2">
        {(["work", "personal", "school", "sports"] as const).map((kind) => (
          <Button key={kind} variant="outline" onClick={() => void create(kind, kind[0].toUpperCase() + kind.slice(1))}>
            {kind[0].toUpperCase() + kind.slice(1)}
          </Button>
        ))}
      </div>
      <Button onClick={onCreate}>Custom name</Button>
    </div>
  );
}

function DrawerPane({ drawers, selected, activeId, search, onSearch, onChoose, favorites, starredFirst, onToggle }: { drawers: Drawer[]; selected: string[]; activeId: string; search: ExplorerSearch; onSearch: (patch: Partial<ExplorerSearch>) => void; onChoose: (id: string, ids: string[], event: MouseEvent) => void; favorites: boolean; starredFirst: boolean; onToggle: (patch: Partial<Preferences>) => void }) {
  const ids = drawers.map((drawer) => drawer.id);
  return (
    <section className="flex h-full min-h-0 flex-col" onMouseDown={() => undefined}>
      <PaneHeader title="Drawers" filter={search.df} onFilter={(df) => onSearch({ df })} />
      <div className="flex gap-1 px-2 pb-1">
        <Button size="sm" variant={favorites ? "default" : "ghost"} onClick={() => onToggle({ favoritesOnly: !favorites })}>Favorites</Button>
        <Button size="sm" variant={starredFirst ? "default" : "ghost"} onClick={() => onToggle({ starredFirst: !starredFirst })}>Starred first</Button>
        {LABEL_COLORS.map((color) => (
          <button key={color} aria-label={color} className={`h-3 w-3 rounded-full ${COLOR_CLASS[color]} ${search.dc === color ? "ring-2 ring-foreground" : ""}`} onClick={() => onSearch({ dc: search.dc === color ? "" : color })} />
        ))}
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {drawers.length === 0 && search.df && <p className="px-2 py-4 text-sm">No names match <button className="underline" onClick={() => onSearch({ df: "" })}>Clear</button></p>}
          {drawers.map((drawer) => (
            <DrawerRow key={drawer.id} drawer={drawer} selected={selected.includes(drawer.id) || drawer.id === activeId} onClick={(event) => onChoose(drawer.id, ids, event)} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function DrawerRow({ drawer, selected, onClick }: { drawer: Drawer; selected: boolean; onClick: (event: MouseEvent) => void }) {
  const sortable = useSortable({ id: drawer.id });
  return (
    <button
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="cabinet-row"
      data-selected={selected}
      onClick={onClick}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className={`h-2 w-2 rounded-full ${drawer.healthOk === false ? "bg-red-600" : "bg-green-600"}`} />
      {drawer.color && <span className={`h-2 w-2 rounded-full ${COLOR_CLASS[drawer.color]}`} />}
      <span className="min-w-0 flex-1 truncate">{drawer.starred ? "★ " : ""}{drawer.name}</span>
      {drawer.jobs[0] && <span className="text-xs text-muted-foreground">{drawer.jobs[0].status}</span>}
    </button>
  );
}

function FolderPane({ root, rows, expanded, selected, openId, filter, onFilter, onToggle, onChoose, emptyFilter }: { root: Node | null; rows: Node[]; expanded: Set<string>; selected: string[]; openId: string; filter: string; onFilter: (value: string) => void; onToggle: (id: string) => void; onChoose: (id: string, ids: string[], event: MouseEvent) => void; emptyFilter: boolean }) {
  const ids = [root?.id ?? "", ...rows.map((row) => row.id)].filter(Boolean);
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PaneHeader title="Folders" filter={filter} onFilter={onFilter} />
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {emptyFilter && <p className="px-2 py-4 text-sm">No names match <button className="underline" onClick={() => onFilter("")}>Clear</button></p>}
        {root && <FolderRow node={root} depth={0} expanded={expanded.has(root.id)} selected={selected.includes(root.id) || openId === root.id} onToggle={() => onToggle(root.id)} onClick={(event) => onChoose(root.id, ids, event)} />}
        {rows.map((folder) => (
          <FolderRow key={folder.id} node={folder} depth={1} expanded={expanded.has(folder.id)} selected={selected.includes(folder.id) || openId === folder.id} onToggle={() => onToggle(folder.id)} onClick={(event) => onChoose(folder.id, ids, event)} />
        ))}
      </div>
    </section>
  );
}

function FolderRow({ node, depth, expanded, selected, onToggle, onClick }: { node: Node; depth: number; expanded: boolean; selected: boolean; onToggle: () => void; onClick: (event: MouseEvent) => void }) {
  const drop = useDroppable({ id: `folder:${node.id}` });
  return (
    <div ref={drop.setNodeRef} className="flex items-center" style={{ paddingLeft: depth * 12 }}>
      <button aria-label={expanded ? "Collapse" : "Expand"} className="grid h-7 w-5 place-items-center" onClick={onToggle}>
        <ChevronRight className={`h-3 w-3 ${expanded ? "rotate-90" : ""}`} />
      </button>
      <button className="cabinet-row" data-selected={selected || drop.isOver} onClick={onClick}>
        {node.color && <span className={`h-2 w-2 rounded-full ${COLOR_CLASS[node.color]}`} />}
        <span className="truncate">{node.name}</span>
      </button>
    </div>
  );
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
  const ids = props.files.map((file) => file.id);
  const filteredEmpty = !!props.filter && props.files.length === 0;
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <span className="font-medium">Files</span>
        <Input aria-label="Filter files" value={props.filter} onChange={(event) => props.onFilter(event.target.value)} className="h-7 max-w-40" />
        <div className="ml-auto flex gap-1">
          {(["grid", "list", "details"] as const).map((mode) => (
            <Button key={mode} size="sm" variant={props.view === mode ? "secondary" : "ghost"} onClick={() => props.onView(mode)}>
              {mode}
            </Button>
          ))}
          {props.view === "grid" && (
            <>
              <Button size="sm" variant="ghost" onClick={() => props.onZoom(Math.max(1, props.zoom - 1))}>-</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onZoom(Math.min(4, props.zoom + 1))}>+</Button>
            </>
          )}
        </div>
      </div>
      {props.listing?.stale && (
        <p className="border-b px-3 py-2 text-sm">
          Showing the cached listing from {formatWhen(props.listing.listedAt)}. {props.listing.error} Writes are hidden until the backend answers.
        </p>
      )}
      {props.listing?.drawer.healthOk === false && <p className="px-3 py-2 text-sm text-destructive">{props.listing.drawer.healthMessage}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!props.listing && <p className="text-sm text-muted-foreground">Select a drawer. Files on the drawer root appear here without a dummy folder.</p>}
        {filteredEmpty && <p className="text-sm">No names match <button className="underline" onClick={() => props.onFilter("")}>Clear</button></p>}
        {props.listing && !filteredEmpty && props.files.length === 0 && (
          <div className="space-y-2">
            <p>This folder is empty.</p>
            {props.writesEnabled && (
              <Button type="button" onClick={props.onUpload}>
                Upload
              </Button>
            )}
          </div>
        )}
        {props.view === "details" ? (
          <DetailsTable files={props.files} selected={props.selected} onChoose={props.onChoose} onSort={props.onSort} />
        ) : props.view === "list" ? (
          <div>
            {props.files.map((file) => (
              <FileRow key={file.id} file={file} selected={props.selected.includes(file.id)} onClick={(event) => props.onChoose(file.id, ids, event)} onOpen={() => props.onOpen(file)} rename={props.renameId === file.id} renameValue={props.renameValue} setRenameValue={props.setRenameValue} onRename={() => props.onRename(file)} />
            ))}
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${[8, 6, 4, 3][props.zoom - 1] ?? 4}, minmax(0, 1fr))` }}>
            {props.files.map((file) => (
              <FileCard key={file.id} file={file} selected={props.selected.includes(file.id)} onClick={(event) => props.onChoose(file.id, ids, event)} onOpen={() => props.onOpen(file)} />
            ))}
          </div>
        )}
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

function FileRow({ file, selected, onClick, onOpen, rename, renameValue, setRenameValue, onRename }: { file: Node; selected: boolean; onClick: (event: MouseEvent) => void; onOpen: () => void; rename: boolean; renameValue: string; setRenameValue: (value: string) => void; onRename: () => void }) {
  const drag = useDraggable({ id: `node:${file.id}` });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button ref={drag.setNodeRef} className="cabinet-row" data-selected={selected} onClick={onClick} onDoubleClick={onOpen} {...drag.listeners} {...drag.attributes}>
          {file.color && <span className={`h-2 w-2 rounded-full ${COLOR_CLASS[file.color]}`} />}
          {rename ? (
            <input className="h-6 flex-1 border px-1" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onRename()} onClick={(event) => event.stopPropagation()} />
          ) : (
            <span className="min-w-0 flex-1 truncate">{file.incomplete ? "Incomplete · " : ""}{file.name}</span>
          )}
          <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          {file.starred && <Star className="h-3 w-3 fill-current" />}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Preview</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileCard({ file, selected, onClick, onOpen }: { file: Node; selected: boolean; onClick: (event: MouseEvent) => void; onOpen: () => void }) {
  const drag = useDraggable({ id: `node:${file.id}` });
  return (
    <button ref={drag.setNodeRef} className="flex flex-col items-center gap-1 rounded-md border p-2 text-center" data-selected={selected} onClick={onClick} onDoubleClick={onOpen} {...drag.listeners} {...drag.attributes}>
      <span className="grid h-12 w-12 place-items-center rounded-md bg-muted text-xs">{typeLabel(file.name).slice(0, 4)}</span>
      <span className="w-full truncate text-xs">{file.name}</span>
    </button>
  );
}

const columnHelper = createColumnHelper<Node>();
const columns = [
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("size", { header: "Size", cell: (info) => formatBytes(info.getValue()) }),
  columnHelper.accessor((row) => typeLabel(row.name), { id: "type", header: "Type" }),
  columnHelper.accessor("modifiedAt", { header: "Modified", cell: (info) => formatWhen(info.getValue()) }),
  columnHelper.accessor("color", { header: "Color", cell: (info) => info.getValue() ?? "none" }),
  columnHelper.accessor("starred", { header: "Star", cell: (info) => (info.getValue() ? "Yes" : "") }),
];

function DetailsTable({ files, selected, onChoose, onSort }: { files: Node[]; selected: string[]; onChoose: (id: string, ids: string[], event: MouseEvent) => void; onSort: (sort: string) => void }) {
  const table = useReactTable({ data: files, columns, getCoreRowModel: getCoreRowModel() });
  const ids = files.map((file) => file.id);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="border-b px-2 py-1 font-medium">
                <button onClick={() => onSort(header.column.id === "modifiedAt" ? "modified" : header.column.id)}>{flexRender(header.column.columnDef.header, header.getContext())}</button>
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} data-selected={selected.includes(row.original.id)} className="data-[selected=true]:bg-accent" onClick={(event) => onChoose(row.original.id, ids, event)}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="border-b px-2 py-1">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaneHeader({ title, filter, onFilter }: { title: string; filter: string; onFilter: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1">
      <span className="font-medium">{title}</span>
      <Input aria-label={`Filter ${title.toLowerCase()}`} value={filter} onChange={(event) => onFilter(event.target.value)} className="h-7" />
    </div>
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
