import type { Me, Project } from "@storageflow/domain";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Files, FolderKanban, Home, LogOut, Settings, Users } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { filterCabinets, projectIdFromUrl } from "@/lib/cabinets";
import { cn } from "@/lib/utils";
import { ProjectCreateDialog } from "@/components/dialogs";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui";

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

type ComboboxOption =
  | { kind: "cabinet"; project: Project }
  | { kind: "create" }
  | { kind: "workspace"; tenantId: string; tenantName: string };

export function CabinetCombobox({
  cabinets,
  currentId,
  workspaces = [],
  onOpen,
  onCreate,
  onWorkspace,
}: {
  cabinets: Project[];
  currentId?: string | null;
  workspaces?: { tenantId: string; tenantName: string }[];
  onOpen: (project: Project) => void;
  onCreate: () => void;
  onWorkspace?: (tenantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = cabinets.find((item) => item.id === currentId) ?? null;
  const filtered = filterCabinets(cabinets, query);
  const options: ComboboxOption[] = [
    ...filtered.map((project) => ({ kind: "cabinet" as const, project })),
    { kind: "create" },
    ...workspaces.map((workspace) => ({ kind: "workspace" as const, ...workspace })),
  ];

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function reveal() {
    const index = Math.max(0, cabinets.findIndex((item) => item.id === currentId));
    setActiveIndex(index);
    setOpen(true);
  }

  function choose(option: ComboboxOption | undefined) {
    if (!option) return;
    if (option.kind === "create") onCreate();
    else if (option.kind === "cabinet") onOpen(option.project);
    else onWorkspace?.(option.tenantId);
    close();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={current ? `Cabinets, ${current.name}` : "Choose a cabinet"}
        className="max-w-56"
        onClick={() => (open ? close() : reveal())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            reveal();
          }
        }}
      >
        <span className="truncate">{current?.name ?? "Choose a cabinet"}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <input
            ref={searchRef}
            className="mb-1 h-9 w-full rounded-[10px] border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search cabinets"
            aria-controls={listId}
            aria-activedescendant={options[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
            placeholder="Search cabinets"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onSearchKey}
          />
          <ul id={listId} role="listbox" aria-label="Cabinets" className="max-h-72 overflow-auto">
            {filtered.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">No cabinets match</li>}
            {options.map((option, index) => {
              if (option.kind === "create") {
                return (
                  <li key="create" role="presentation">
                    <div className="my-1 h-px bg-border" role="separator" />
                    <button
                      type="button"
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={false}
                      data-active={index === activeIndex}
                      className={cn("flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none", index === activeIndex && "bg-accent")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option)}
                    >
                      New cabinet…
                    </button>
                  </li>
                );
              }
              if (option.kind === "workspace") {
                return (
                  <li key={option.tenantId} role="presentation">
                    <button
                      type="button"
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={false}
                      data-active={index === activeIndex}
                      className={cn("flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none", index === activeIndex && "bg-accent")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option)}
                    >
                      Workspace: {option.tenantName}
                    </button>
                  </li>
                );
              }
              const marked = option.project.id === currentId;
              return (
                <li key={option.project.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={marked}
                    data-current={marked || undefined}
                    data-active={index === activeIndex}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                      marked && "bg-[#eef4ff] text-[#1d4ed8]",
                      index === activeIndex && !marked && "bg-accent",
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.project.starred ? "★ " : ""}
                      {option.project.name}
                    </span>
                    {marked && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Current
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  project,
  onOpenCabinet,
  onCreateOpenChange,
  createOpen,
  portalSlug,
  toolbar,
  children,
}: {
  project?: Project | null;
  onOpenCabinet?: (project: Project) => void;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  portalSlug?: string | null;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const narrow = useNarrow();
  const [uncontrolledCreate, setUncontrolledCreate] = useState(false);
  const dialogOpen = createOpen ?? uncontrolledCreate;
  function setDialogOpen(open: boolean) {
    onCreateOpenChange?.(open);
    if (createOpen === undefined) setUncontrolledCreate(open);
  }
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects"), enabled: !!me.data?.activeTenant });
  const memberships = me.data?.memberships ?? [];

  async function signOut() {
    await api("/sessions/current", { method: "DELETE" });
    void navigate({ to: "/sign-in" });
  }

  function openCabinet(item: Project) {
    if (onOpenCabinet) {
      onOpenCabinet(item);
      return;
    }
    const tab = me.data?.preferences.locationTabs.find((entry) => (entry.projectId || projectIdFromUrl(entry.url)) === item.id);
    if (tab?.url) {
      window.location.assign(tab.url);
      return;
    }
    void navigate({ to: "/app/p/$projectId", params: { projectId: item.id } });
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--page)]">
      {!narrow && (
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--line)] bg-white">
          <div className="flex h-14 items-center gap-2 px-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-[11px] font-semibold text-white">SF</span>
            <span className="font-semibold tracking-tight">StorageFlow</span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
            <p className="pane-label px-2 pb-1 pt-2">Main</p>
            <RailLink to="/app" active={pathname === "/app"} icon={<Home className="h-4 w-4" />}>Home</RailLink>
            {project ? (
              <Link
                to="/app/p/$projectId"
                params={{ projectId: project.id }}
                className={cn("cabinet-row text-sm", pathname.startsWith("/app/p/") && !pathname.endsWith("/settings") && "bg-[#eef4ff] text-[#1d4ed8]")}
              >
                <Files className={cn("h-4 w-4", pathname.startsWith("/app/p/") && !pathname.endsWith("/settings") ? "text-[#1d4ed8]" : "text-[var(--ink-soft)]")} />
                Files
              </Link>
            ) : (
              <RailLink to="/app" active={false} icon={<Files className="h-4 w-4" />}>Files</RailLink>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="cabinet-row text-sm text-[var(--ink)]">
                  <FolderKanban className="h-4 w-4 text-[var(--ink-soft)]" />
                  Cabinets
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {projects.data?.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => openCabinet(item)}>
                    {item.id === project?.id ? "● " : ""}
                    {item.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => setDialogOpen(true)}>New cabinet…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="pane-label px-2 pb-1 pt-4">Workspace</p>
            {me.data?.activeTenant?.role === "owner" && (
              <RailLink to="/app/admin" active={pathname === "/app/admin"} icon={<Users className="h-4 w-4" />}>
                Accounts
              </RailLink>
            )}
            {project ? (
              <Link
                to="/app/p/$projectId/settings"
                params={{ projectId: project.id }}
                className={cn("cabinet-row text-sm", pathname.endsWith("/settings") && "bg-[#eef4ff] text-[#1d4ed8]")}
              >
                <Settings className={cn("h-4 w-4", pathname.endsWith("/settings") ? "text-[#1d4ed8]" : "text-[var(--ink-soft)]")} />
                Settings
              </Link>
            ) : (
              <RailLink to="/app/account" active={pathname === "/app/account"} icon={<Settings className="h-4 w-4" />}>Settings</RailLink>
            )}
          </nav>
          <div className="border-t border-[var(--line)] p-2">
            <button className="cabinet-row w-full text-sm" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4 text-[var(--ink-soft)]" />
              Sign out
            </button>
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-white px-4">
          {narrow && <span className="font-semibold">StorageFlow</span>}
          <CabinetCombobox
            cabinets={projects.data ?? []}
            currentId={project?.id}
            workspaces={memberships.length > 1 ? memberships : []}
            onOpen={openCabinet}
            onCreate={() => setDialogOpen(true)}
            onWorkspace={async (tenantId) => {
              await api("/sessions/tenant", { method: "POST", body: JSON.stringify({ tenantId }) });
              await queryClient.invalidateQueries();
              void navigate({ to: "/app" });
            }}
          />
          <div className="ml-auto flex items-center gap-2">
            {portalSlug && (
              <a className="rounded-[10px] px-2.5 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-accent hover:text-[var(--ink)]" href={`/portal/${portalSlug}`}>
                Portal
              </a>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {me.data?.user.name ?? me.data?.user.email ?? "Account"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => navigate({ to: "/app/account" })}>Account</DropdownMenuItem>
                {me.data?.activeTenant?.role === "owner" && (
                  <DropdownMenuItem onSelect={() => navigate({ to: "/app/admin" })}>Accounts</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => navigate({ to: "/app/security" })}>Security</DropdownMenuItem>
                {project && <DropdownMenuItem onSelect={() => navigate({ to: "/app/p/$projectId/settings", params: { projectId: project.id } })}>Cabinet settings</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {toolbar}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
      <ProjectCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects.data ?? []}
        loading={projects.isLoading}
        currentId={project?.id}
        onSwitch={(item) => {
          setDialogOpen(false);
          openCabinet(item);
        }}
        onCreated={(created) => {
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          setDialogOpen(false);
          openCabinet(created);
        }}
      />
    </div>
  );
}

function RailLink({ to, active, icon, children }: { to: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className={cn("cabinet-row text-sm", active && "bg-[#eef4ff] text-[#1d4ed8]")}>
      <span className={active ? "text-[#1d4ed8]" : "text-[var(--ink-soft)]"}>{icon}</span>
      {children}
    </Link>
  );
}
