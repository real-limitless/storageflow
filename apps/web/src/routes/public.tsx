import type { CatalogEntry, PublicPublication, TicketView } from "@storageflow/domain";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatBytes, formatWhen } from "@/lib/format";
import { Button, Card, Input, Label } from "@/components/ui";

export function DownloadPage() {
  const { publicId } = useParams({ strict: false }) as { publicId: string };
  const file = useQuery({ queryKey: ["publication", publicId], queryFn: () => api<PublicPublication>(`/publications/${publicId}`) });
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const ready = ticket ? Date.parse(ticket.readyAt) <= now : false;
  useEffect(() => {
    if (!ticket || Date.parse(ticket.readyAt) <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [ticket]);
  return (
    <main className="mx-auto grid max-w-4xl gap-6 p-6 md:grid-cols-2" data-density="comfortable">
      <Card className="space-y-2 p-6">
        <p className="text-sm text-muted-foreground">StorageFlow</p>
        {file.isError && <p>This file is not published.</p>}
        {file.data && (
          <>
            <h1 className="text-2xl font-semibold">{file.data.title}</h1>
            <p>{file.data.fileName}</p>
            <p className="text-sm text-muted-foreground">{formatBytes(file.data.size)} · published {formatWhen(file.data.publishedAt)} · {file.data.downloadCount} downloads</p>
            {file.data.note && <p>{file.data.note}</p>}
          </>
        )}
      </Card>
      <Card className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">Download</h2>
        <p className="text-sm text-muted-foreground">The server creates the ticket. Waiting and speed limits come from the plan, not from this page.</p>
        <Button
          onClick={async () => {
            setError("");
            try {
              const created = await api<TicketView>(`/publications/${publicId}/tickets`, { method: "POST", body: "{}" });
              setTicket(created);
              setNow(Date.now());
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not start a ticket");
            }
          }}
        >
          Start download
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {ticket && !ready && <p>Free download starts in {Math.max(0, Math.ceil((Date.parse(ticket.readyAt) - now) / 1000))} seconds.</p>}
        {ticket && ready && (
          <a className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground" href={`/api/tickets/${ticket.id}/stream`}>
            Download file
          </a>
        )}
        <form
          className="space-y-2 pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await api(`/publications/${publicId}/abuse`, { method: "POST", body: JSON.stringify({ note }) });
            setNote("");
          }}
        >
          <Label htmlFor="abuse">Report abuse</Label>
          <Input id="abuse" value={note} onChange={(event) => setNote(event.target.value)} />
          <Button type="submit" variant="outline" size="sm">Send report</Button>
        </form>
      </Card>
    </main>
  );
}

export function CatalogPage() {
  const { tenantSlug } = useParams({ strict: false }) as { tenantSlug: string };
  const catalog = useQuery({
    queryKey: ["catalog", tenantSlug],
    queryFn: () => api<{ tenant: { name: string }; files: CatalogEntry[] }>(`/catalog/${tenantSlug}`),
  });
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">{catalog.data?.tenant.name ?? "Catalog"}</h1>
      <ul className="space-y-2">
        {catalog.data?.files.map((file) => (
          <li key={file.publicId}>
            <Link to="/d/$publicId" params={{ publicId: file.publicId }} className="underline">
              {file.title}
            </Link>
            <span className="text-sm text-muted-foreground"> · {formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
