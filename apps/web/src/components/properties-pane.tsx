import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FileVersionView, GrantView } from "@storageflow/domain";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Input, Label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatBytes, formatWhen } from "@/lib/format";

export interface PropertiesTarget {
  kind: "drawer" | "folder" | "file";
  id: string;
  name: string;
  path: string;
  size: number | null;
  itemType: string;
  createdAt: string | null;
  modifiedAt: string | null;
  owner: string;
  color: string | null;
  starred: boolean;
  shareNodeId: string | null;
}

export function PropertiesPane({ target, onClose }: { target: PropertiesTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ["versions", target?.kind === "file" ? target.id : ""],
    enabled: target?.kind === "file",
    retry: false,
    queryFn: () => api<FileVersionView[]>(`/nodes/${target?.id}/versions`),
  });
  const grants = useQuery({
    queryKey: ["grants", target?.shareNodeId ?? ""],
    enabled: !!target?.shareNodeId,
    retry: false,
    queryFn: () => api<GrantView[]>(`/nodes/${target?.shareNodeId}/grants`),
  });
  const retention = useQuery({
    queryKey: ["retention"],
    retry: false,
    queryFn: () => api<{ count: number }>("/admin/retention"),
  });
  const [count, setCount] = useState("");
  const [retentionError, setRetentionError] = useState("");

  useEffect(() => {
    if (retention.data) setCount(String(retention.data.count));
  }, [retention.data]);

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    const next = Number(count);
    if (!Number.isInteger(next) || next < 1 || next > 1000) {
      setRetentionError("Keep a whole number of versions from 1 to 1000");
      return;
    }
    setRetentionError("");
    try {
      const saved = await api<{ count: number }>("/admin/retention", { method: "PATCH", body: JSON.stringify({ count: next }) });
      setCount(String(saved.count));
      await queryClient.invalidateQueries({ queryKey: ["retention"] });
      toast.success(`Keeping ${saved.count} versions`);
    } catch (error) {
      setRetentionError(error instanceof ApiError ? error.message : "Could not save retention");
    }
  }

  async function restore(version: number) {
    if (!target || target.kind !== "file") return;
    await api(`/nodes/${target.id}/versions/${version}/restore`, { method: "POST", body: "{}" });
    await queryClient.invalidateQueries({ queryKey: ["versions", target.id] });
    await queryClient.invalidateQueries({ queryKey: ["listing"] });
    toast.success(`Restored version ${version}`);
  }

  return (
    <aside className="properties-pane" data-testid="properties-pane" aria-label="Properties">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-3">
        <span className="pane-label">Properties</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {!target && (
          <div className="properties-empty" data-testid="properties-empty">
            <p className="text-sm font-semibold text-[var(--ink)]">Nothing selected</p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">Select a drawer, folder, or file to see its properties.</p>
          </div>
        )}
        {target && (
          <dl className="space-y-2 text-sm">
            <Field label="Name" value={target.name} />
            <Field label="Path" value={target.path || "—"} />
            <Field label="Size" value={target.kind === "file" ? formatBytes(target.size) : "—"} />
            <Field label="Type" value={target.itemType} />
            <Field label="Created" value={formatWhen(target.createdAt)} />
            <Field label="Modified" value={formatWhen(target.modifiedAt)} />
            <Field label="Owner" value={target.owner || "—"} />
            <Field label="Color label" value={target.color ?? "None"} />
            <Field label="Tags" value={tagsFor(target)} />
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Sharing</dt>
              <dd className="mt-1">
                {!target.shareNodeId && "—"}
                {target.shareNodeId && grants.isLoading && "Loading sharing"}
                {target.shareNodeId && grants.data && grants.data.length === 0 && "Not shared"}
                {target.shareNodeId && grants.data && grants.data.length > 0 && (
                  <ul className="space-y-1">
                    {grants.data.map((grant) => (
                      <li key={grant.id}>{shareLabel(grant)}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div data-testid="version-list">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Versions</dt>
              <dd className="mt-1 space-y-2">
                {target.kind !== "file" && <p className="text-[var(--ink-soft)]">Versions are kept for files.</p>}
                {target.kind === "file" && versions.isLoading && <p className="text-[var(--ink-soft)]">Loading versions</p>}
                {target.kind === "file" && versions.data && versions.data.length === 0 && <p className="text-[var(--ink-soft)]">No versions yet</p>}
                {target.kind === "file" &&
                  versions.data?.map((version) => (
                    <div key={version.id} className="rounded-lg border border-[var(--line)] bg-white px-2 py-2">
                      <p>
                        Version {version.version} · {formatBytes(version.size)} · {formatWhen(version.createdAt)}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <a className="text-sm text-[#1d4ed8] underline" href={`/api/nodes/${target.id}/versions/${version.version}/content`}>
                          Download
                        </a>
                        <Button size="sm" variant="outline" aria-label={`Restore version ${version.version}`} onClick={() => void restore(version.version)}>
                          Restore
                        </Button>
                      </div>
                    </div>
                  ))}
              </dd>
            </div>
          </dl>
        )}
        <form className="mt-4 space-y-2 border-t border-[var(--line)] pt-3" onSubmit={(event) => void saveRetention(event)}>
          <Label htmlFor="version-retention">Retention</Label>
          {retention.isError && <p className="text-sm text-[var(--ink-soft)]">Retention is set by the team owner.</p>}
          {retention.data && (
            <div className="flex items-center gap-2">
              <span className="text-sm">Keep</span>
              <Input id="version-retention" aria-label="Version retention" className="h-8 w-20" value={count} onChange={(event) => setCount(event.target.value)} />
              <span className="text-sm">versions</span>
              <Button size="sm" type="submit">
                Save
              </Button>
            </div>
          )}
          {retentionError && (
            <p className="text-sm text-destructive" role="alert">
              {retentionError}
            </p>
          )}
        </form>
      </div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{label}</dt>
      <dd className="mt-0.5 break-all">{value}</dd>
    </div>
  );
}

function tagsFor(target: PropertiesTarget): string {
  const tags = [target.starred ? "Starred" : "", target.color ?? ""].filter(Boolean);
  return tags.length ? tags.join(", ") : "None";
}

function shareLabel(grant: GrantView): string {
  const who = grant.anyoneWithLink ? "Anyone with the link" : grant.granteeEmail || "A person";
  return `${who} · ${grant.verbs.join(", ") || "no verbs"}`;
}
