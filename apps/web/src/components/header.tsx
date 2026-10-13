import type { Me, Project } from "@storageflow/domain";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";

export function WorkspaceHeader({ project, actions, onCreateProject }: { project?: Project | null; actions?: ReactNode; onCreateProject?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects"), enabled: !!me.data?.activeTenant });
  const memberships = me.data?.memberships ?? [];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <Link to="/app" className="flex items-center gap-2 font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-sm bg-primary text-[10px] text-primary-foreground">SF</span>
        StorageFlow
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Project: {project?.name ?? "Choose"}
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
                  navigate({ to: "/app" });
                }}
              >
                Workspace: {membership.tenantName}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex min-w-0 flex-1 items-center gap-2">{actions}</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            {me.data?.user.email ?? "Account"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => navigate({ to: "/app/account" })}>Account</DropdownMenuItem>
          {project && <DropdownMenuItem onSelect={() => navigate({ to: "/app/p/$projectId/settings", params: { projectId: project.id } })}>Project settings</DropdownMenuItem>}
          <DropdownMenuItem
            onSelect={async () => {
              await api("/sessions/current", { method: "DELETE" });
              navigate({ to: "/sign-in" });
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
