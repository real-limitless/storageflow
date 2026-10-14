import { useState } from "react";
import type { Me } from "@storageflow/domain";
import { api } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";

export function TeamOnboarding({ onCreated }: { onCreated: (me: Me) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a team name.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const me = await api<Me>("/tenants", { method: "POST", body: JSON.stringify({ name: trimmed }) });
      onCreated(me);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the team");
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-full place-items-center bg-[var(--page)] p-6">
      <Card className="w-full max-w-sm space-y-4 border-[var(--line)] p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-semibold text-white">SF</span>
          <h1 className="text-lg font-semibold">Name your team</h1>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">You are the owner. The cabinet opens after the team exists.</p>
        <form className="space-y-3" aria-label="Name your team" onSubmit={(event) => void submit(event)}>
          <Label htmlFor="team-name">Team name</Label>
          <Input id="team-name" value={name} autoComplete="organization" onChange={(event) => setName(event.target.value)} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            Create team
          </Button>
        </form>
      </Card>
    </main>
  );
}
