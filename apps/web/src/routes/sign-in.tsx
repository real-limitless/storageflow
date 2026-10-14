import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Me } from "@storageflow/domain";
import { TeamOnboarding } from "@/components/team-onboarding";
import { api } from "@/lib/api";
import { MfaChallenge } from "@/components/mfa";
import { Button, Card, Input, Label } from "@/components/ui";

export function SignInPage() {
  const navigate = useNavigate();
  const [needsTeam, setNeedsTeam] = useState(false);
  const [mode, setMode] = useState<"password" | "magic" | "create">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);

  async function enter(me: Me) {
    if (me.activeTenant == null) {
      setNeedsTeam(true);
      return;
    }
    await navigate({ to: "/app" });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      if (mode === "create") {
        const me = await api<Me>("/users", { method: "POST", body: JSON.stringify({ email, password, name }) });
        await enter(me);
        return;
      }
      if (mode === "magic") {
        const result = await api<{ sent: boolean; devToken?: string }>("/sessions/magic", { method: "POST", body: JSON.stringify({ email }) });
        if (result.devToken) {
          const consumed = await api<Me & { mfaRequired?: boolean; challenge?: string }>("/sessions/magic/consume", {
            method: "POST",
            body: JSON.stringify({ token: result.devToken }),
          });
          if (consumed.mfaRequired && consumed.challenge) {
            setChallenge(consumed.challenge);
            return;
          }
          await enter(consumed);
          return;
        }
        setMessage("If that email can sign in, a link is on its way.");
        return;
      }
      const signedIn = await api<Me & { mfaRequired?: boolean; challenge?: string }>("/sessions", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (signedIn.mfaRequired && signedIn.challenge) {
        setChallenge(signedIn.challenge);
        return;
      }
      await enter(signedIn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
    }
  }

  if (challenge) {
    return (
      <main className="grid min-h-full place-items-center bg-[var(--page)] p-6">
        <Card className="w-full max-w-sm space-y-4 border-[var(--line)] p-8 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-semibold text-white">SF</span>
            <h1 className="text-lg font-semibold">StorageFlow</h1>
          </div>
          <MfaChallenge
            challenge={challenge}
            onSuccess={(me) => {
              setChallenge(null);
              void enter(me);
            }}
          />
        </Card>
      </main>
    );
  }

  if (needsTeam) return <TeamOnboarding onCreated={() => void navigate({ to: "/app" })} />;

  return (
    <main className="grid min-h-full place-items-center bg-[var(--page)] p-6">
      <Card className="w-full max-w-sm space-y-4 border-[var(--line)] p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-semibold text-white">SF</span>
          <h1 className="text-lg font-semibold">StorageFlow</h1>
        </div>
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          {mode === "create" && (
            <>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
            </>
          )}
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          {mode !== "magic" && (
            <>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm">{message}</p>}
          <Button type="submit" className="w-full">
            {mode === "create" ? "Create account" : mode === "magic" ? "Send magic link" : "Sign in"}
          </Button>
        </form>
        <div className="flex justify-between text-sm">
          <button className="underline" onClick={() => setMode(mode === "magic" ? "password" : "magic")}>
            {mode === "magic" ? "Use a password" : "Email me a link"}
          </button>
          <button className="underline" onClick={() => setMode("create")}>
            Transfer account
          </button>
        </div>
      </Card>
    </main>
  );
}
