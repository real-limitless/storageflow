import type { Me, Project } from "@storageflow/domain";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Files, FolderKanban, Home, LogOut, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";

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

export function AppShell({
  project,
  onCreateProject,
  portalSlug,
  toolbar,
  children,
}: {
  project?: Project | null;
  onCreateProject?: () => void;
  portalSlug?: string | null;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const narrow = useNarrow();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects"), enabled: !!me.data?.activeTenant });
  const memberships = me.data?.memberships ?? [];
  async function signOut() {
    await api("/sessions/current", { method: "DELETE" });
    void navigate({ to: "/sign-in" });
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
                  Projects
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {projects.data?.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => navigate({ to: "/app/p/$projectId", params: { projectId: item.id } })}>
                    {item.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="my-1 h-px bg-border" />
                <DropdownMenuItem onSelect={() => onCreateProject?.()}>New project</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="pane-label px-2 pb-1 pt-4">Workspace</p>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {project?.name ?? "Choose a project"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {projects.data?.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => navigate({ to: "/app/p/$projectId", params: { projectId: item.id } })}>
                  {item.starred ? "★ " : ""}
                  {item.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="my-1 h-px bg-border" />
              <DropdownMenuItem onSelect={() => onCreateProject?.()}>New project</DropdownMenuItem>
              {memberships.length > 1 &&
                memberships.map((membership) => (
                  <DropdownMenuItem
                    key={membership.tenantId}
                    onSelect={async () => {
                      await api("/sessions/tenant", { method: "POST", body: JSON.stringify({ tenantId: membership.tenantId }) });
                      await queryClient.invalidateQueries();
                      void navigate({ to: "/app" });
                    }}
                  >
                    Workspace: {membership.tenantName}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
                {project && <DropdownMenuItem onSelect={() => navigate({ to: "/app/p/$projectId/settings", params: { projectId: project.id } })}>Project settings</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {toolbar}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
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

