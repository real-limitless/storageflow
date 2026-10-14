import type { AuditEvent, Me } from "@storageflow/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { AppShell } from "@/components/header";
import { MfaEnroll } from "@/components/mfa";
import { Card } from "@/components/ui";

const ACTION_LABELS: Record<string, string> = {
  "sign-in": "Sign-in",
  "user.create": "User created",
  "user.disable": "User disabled",
  "user.delete": "User deleted",
  "api_key.issue": "API key issued",
  "version.restore": "Version restored",
  "mfa.enroll": "Authenticator enrolled",
  "mfa.reject": "Rejected code",
  "mfa.recovery": "Recovery code used",
};

function detailText(event: AuditEvent): string {
  const detail = event.detail;
  const parts: string[] = [];
  if (typeof detail.email === "string") parts.push(detail.email);
  if (typeof detail.name === "string") parts.push(detail.name);
  if (typeof detail.method === "string") parts.push(detail.method);
  if (typeof detail.stage === "string") parts.push(detail.stage);
  return parts.join(" · ") || "—";
}

function AuditLog() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<AuditEvent[]>("/audit") });
  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="font-medium">Audit log</h2>
        <p className="text-sm text-muted-foreground">Sign-in, user changes, issued keys, and restored versions.</p>
      </div>
      {audit.isLoading && <p className="text-sm">Loading audit log…</p>}
      {audit.error && <p className="text-sm text-destructive">{audit.error instanceof Error ? audit.error.message : "Could not load the audit log"}</p>}
      {audit.data && audit.data.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-sm">
          <p className="font-medium">No audit events yet</p>
          <p className="text-muted-foreground">Sign-in, user changes, issued keys, and restored versions will show up here.</p>
        </div>
      )}
      {audit.data && audit.data.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">Action</th>
              <th className="py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.map((event) => (
              <tr key={event.id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-2 pr-3 align-top text-muted-foreground">{formatWhen(event.createdAt)}</td>
                <td className="py-2 pr-3 align-top">{ACTION_LABELS[event.action] ?? event.action}</td>
                <td className="py-2 align-top">{detailText(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function SecurityPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  if (!me.data) return <p className="p-6">Loading…</p>;
  const owner = me.data.activeTenant?.role === "owner";
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
        <h1 className="text-lg font-semibold">Security</h1>
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Authenticator</h2>
          <MfaEnroll enabled={me.data.user.mfaEnabled} />
        </Card>
        {owner ? <AuditLog /> : <p className="text-sm text-muted-foreground">The audit log is available to workspace owners.</p>}
      </main>
    </AppShell>
  );
}
