import type { Listing, PortalRoot } from "@storageflow/domain";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Button, Input } from "@/components/ui";

interface PortalHome {
  portal: { slug: string; name: string; projectName: string };
  email: string | null;
  roots: PortalRoot[];
}

export function PortalPage() {
  const { slug, folderId } = useParams({ strict: false }) as { slug: string; folderId?: string };
  const search = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [ready, setReady] = useState(!search.token);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!search.token) return;
    void api(`/portal/${slug}/sessions`, { method: "POST", body: JSON.stringify({ token: search.token }) })
      .then(() => {
        setReady(true);
        void navigate({ to: "/portal/$slug", params: { slug }, search: {}, replace: true });
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.code === "password_required") {
          setReady(false);
          setError("Password required");
          return;
        }
        setError(cause instanceof Error ? cause.message : "This link is not valid");
      });
  }, [search.token, slug, navigate]);

  const home = useQuery({ queryKey: ["portal", slug], queryFn: () => api<PortalHome>(`/portal/${slug}`), enabled: ready && !search.token });
  const open = folderId ? home.data?.roots.find((root) => root.node.id === folderId) ?? home.data?.roots[0] : home.data?.roots[0];
  const listing = useQuery({
    queryKey: ["portal-list", slug, open?.node.id],
    enabled: !!open && !open.dropFolder,
    queryFn: () => api<Listing>(`/portal/${slug}/list?drawerId=${open?.drawerId}&folderId=${folderId || open?.node.id}`),
  });
  const activity = useQuery({
    queryKey: ["portal-activity", slug],
    queryFn: () => api<{ id: string; kind: string; createdAt: string }[]>(`/portal/${slug}/activity`),
    enabled: ready,
  });
  const [tab, setTab] = useState<"files" | "upload" | "activity">("files");

  if (!ready) {
    return (
      <main className="mx-auto max-w-md space-y-3 bg-[var(--page)] p-8" data-density="comfortable">
        <h1 className="text-xl font-semibold">Portal</h1>
        <p>{error || "Opening the link…"}</p>
        {error === "Password required" && (
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await api(`/portal/${slug}/sessions`, { method: "POST", body: JSON.stringify({ token: search.token, password }) });
              setReady(true);
              void navigate({ to: "/portal/$slug", params: { slug }, search: {}, replace: true });
            }}
          >
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="Portal password" />
            <Button type="submit">Continue</Button>
          </form>
        )}
      </main>
    );
  }

  const canUpload = home.data?.roots.some((root) => root.verbs.includes("upload"));
  return (
    <div className="flex min-h-full flex-col bg-[var(--page)]" data-density="comfortable">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white px-6 py-4">
        <div>
          <p className="text-xs text-muted-foreground">Portal</p>
          <h1 className="text-xl font-semibold">{home.data?.portal.projectName ?? "Portal"}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>{home.data?.email}</span>
          <Button
            variant="outline"
            onClick={async () => {
              await api(`/portal/${slug}/sessions`, { method: "DELETE" });
              window.location.assign("/sign-in");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 border-r border-[var(--line)] bg-white p-4">
          <p className="mb-2 text-sm text-muted-foreground">Shared with you</p>
          <ul className="space-y-1">
            {home.data?.roots.map((root) => (
              <li key={root.node.id}>
                <button className="w-full rounded-md px-2 py-2 text-left hover:bg-accent" onClick={() => void navigate({ to: "/portal/$slug/f/$folderId", params: { slug, folderId: root.node.id } })}>
                  {root.node.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0 flex-1 p-6">
          <div className="mb-4 flex gap-2">
            <Button variant={tab === "files" ? "secondary" : "ghost"} onClick={() => setTab("files")}>Files</Button>
            {canUpload && <Button variant={tab === "upload" ? "secondary" : "ghost"} onClick={() => setTab("upload")}>Upload</Button>}
            <Button variant={tab === "activity" ? "secondary" : "ghost"} onClick={() => setTab("activity")}>Activity</Button>
          </div>
          {tab === "activity" && (
            <ul className="space-y-1 text-sm">
              {activity.data?.map((event) => (
                <li key={event.id}>{event.kind}</li>
              ))}
            </ul>
          )}
          {tab === "upload" && open && <PortalUpload slug={slug} drawerId={open.drawerId} folderId={open.node.id} onDone={() => void queryClient.invalidateQueries({ queryKey: ["portal-list", slug] })} />}
          {tab === "files" && open?.dropFolder && <p>This is a drop folder. Use Upload. The other files stay hidden.</p>}
          {tab === "files" && open && !open.dropFolder && (
            <div className="grid gap-3 sm:grid-cols-2">
              {listing.data?.files.map((file) => (
                <div key={file.id} className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{formatBytes(file.size)}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => window.open(`/api/portal/${slug}/nodes/${file.id}/content?download=1`)}>Download</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api(`/portal/${slug}/nodes/${file.id}`, { method: "PATCH", body: JSON.stringify({ name: `${file.name}-renamed` }) });
                          await queryClient.invalidateQueries({ queryKey: ["portal-list", slug] });
                        } catch (cause) {
                          toast.error(cause instanceof ApiError ? "Permission denied" : "Rename failed");
                        }
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api(`/portal/${slug}/nodes/delete`, { method: "POST", body: JSON.stringify({ nodeIds: [file.id] }) });
                          await queryClient.invalidateQueries({ queryKey: ["portal-list", slug] });
                        } catch (cause) {
                          toast.error(cause instanceof ApiError ? "Permission denied" : "Delete failed");
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function PortalUpload({ slug, drawerId, folderId, onDone }: { slug: string; drawerId: string; folderId: string; onDone: () => void }) {
  return (
    <input
      type="file"
      multiple
      aria-label="Upload files"
      onChange={async (event) => {
        const files = [...(event.target.files ?? [])];
        for (const file of files) {
          const ticket = await api<{ uploadId: string }>(`/portal/${slug}/uploads`, {
            method: "POST",
            body: JSON.stringify({ drawerId, folderId, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
          });
          await fetch(`/api/uploads/${ticket.uploadId}/body`, { method: "PUT", body: file, credentials: "include" });
          await api(`/uploads/${ticket.uploadId}/complete`, { method: "POST", body: "{}" });
          toast.success(`${file.name} uploaded`);
        }
        onDone();
      }}
    />
  );
}
