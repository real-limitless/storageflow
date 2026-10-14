import { LABEL_COLORS, PROJECT_KINDS, type ActivityEvent, type Project, type ProjectMember } from "@storageflow/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { AppShell } from "@/components/header";
import { Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui";

export function SettingsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects") });
  const project = projects.data?.find((item) => item.id === projectId);
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => api<ProjectMember[]>(`/projects/${projectId}/members`) });
  const activity = useQuery({ queryKey: ["activity", projectId], queryFn: () => api<ActivityEvent[]>(`/activity?projectId=${projectId}`) });
  if (!project) return <p className="p-6">Loading…</p>;
  return (
    <AppShell project={project}>
      <main className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
        <h1 className="text-lg font-semibold">Project settings</h1>
        <Card className="space-y-3 p-4">
          <form
            className="grid gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await api(`/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: form.get("name"),
                  kind: form.get("kind"),
                  description: form.get("description"),
                  color: form.get("color") === "none" ? null : form.get("color"),
                  defaultProject: form.get("defaultProject") === "on",
                }),
              });
              await queryClient.invalidateQueries({ queryKey: ["projects"] });
            }}
          >
            <Label htmlFor="settings-name">Name</Label>
            <Input id="settings-name" name="name" defaultValue={project.name} />
            <Label>Kind</Label>
            <Select name="kind" defaultValue={project.kind}>
              <SelectTrigger />
              <SelectContent>
                {PROJECT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>{kind}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="kind" value={project.kind} />
            <Label htmlFor="settings-description">Description</Label>
            <Input id="settings-description" name="description" defaultValue={project.description} />
            <Label>Color</Label>
            <Select name="color" defaultValue={project.color ?? "none"}>
              <SelectTrigger />
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                {LABEL_COLORS.map((color) => (
                  <SelectItem key={color} value={color}>{color}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="defaultProject" /> Default project after sign-in
            </label>
            <Button type="submit" size="sm">Save project</Button>
          </form>
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Members</h2>
          <ul className="text-sm">
            {members.data?.map((member) => (
              <li key={member.userId}>{member.email} · {member.role}</li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const email = new FormData(event.currentTarget).get("email");
              await api(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ email, role: "member" }) });
              await queryClient.invalidateQueries({ queryKey: ["members", projectId] });
              event.currentTarget.reset();
            }}
          >
            <Input name="email" type="email" placeholder="member@example.com" aria-label="Invite email" />
            <Button type="submit" size="sm">Invite</Button>
          </form>
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Activity</h2>
          <ul className="space-y-1 text-sm">
            {activity.data?.map((event) => (
              <li key={event.id}>
                {formatWhen(event.createdAt)} · {event.kind} · {event.actorEmail ?? "system"}
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </AppShell>
  );
}
