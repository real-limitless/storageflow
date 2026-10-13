import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";

export function SignInPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"password" | "magic" | "create">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      if (mode === "create") {
        await api("/users", { method: "POST", body: JSON.stringify({ email, password, name }) });
        await navigate({ to: "/app" });
        return;
      }
      if (mode === "magic") {
        const result = await api<{ sent: boolean; devToken?: string }>("/sessions/magic", { method: "POST", body: JSON.stringify({ email }) });
        if (result.devToken) {
          await api("/sessions/magic/consume", { method: "POST", body: JSON.stringify({ token: result.devToken }) });
          await navigate({ to: "/app" });
          return;
        }
        setMessage("If that email can sign in, a link is on its way.");
        return;
      }
      await api("/sessions", { method: "POST", body: JSON.stringify({ email, password }) });
      await navigate({ to: "/app" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
    }
  }

  return (
    <main className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-semibold">StorageFlow</h1>
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
