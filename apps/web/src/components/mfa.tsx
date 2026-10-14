import type { Me } from "@storageflow/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Input, Label } from "@/components/ui";

export function MfaChallenge({ challenge, onSuccess }: { challenge: string; onSuccess: (me: Me) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const me = await api<Me>("/sessions/mfa", { method: "POST", body: JSON.stringify({ challenge, code }) });
      onSuccess(me);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code was not accepted");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Check your authenticator</h2>
        <p className="text-sm text-muted-foreground">Enter the 6-digit code, or one of your recovery codes.</p>
      </div>
      <Label htmlFor="mfa-code">Code</Label>
      <Input
        id="mfa-code"
        autoComplete="one-time-code"
        inputMode="text"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        Verify
      </Button>
    </form>
  );
}

export function MfaEnroll({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth: string; recoveryCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [turnedOn, setTurnedOn] = useState(false);
  const [pending, setPending] = useState(false);

  async function start() {
    setError("");
    setPending(true);
    try {
      const next = await api<{ secret: string; otpauth: string; recoveryCodes: string[] }>("/me/mfa/enroll", { method: "POST" });
      setEnrollment(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup failed");
    } finally {
      setPending(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/me/mfa/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setTurnedOn(true);
      setEnrollment(null);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code was not accepted");
    } finally {
      setPending(false);
    }
  }

  if (enabled || turnedOn) {
    return <p className="text-sm">Authenticator is on. The next sign-in asks for a code from the app, or a recovery code.</p>;
  }

  if (!enrollment) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Add a time-based code from an authenticator app. Recovery codes are shown once, when you turn it on.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" onClick={() => void start()} disabled={pending}>
          Set up authenticator
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void confirm(event)}>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Enter this key in your authenticator app.</p>
        <p className="break-all rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2 font-mono text-sm tracking-wide">{enrollment.secret}</p>
        <p className="break-all text-xs text-muted-foreground">{enrollment.otpauth}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Recovery codes</p>
        <p className="text-sm text-muted-foreground">Save these now. Each code works once.</p>
        <ul className="grid grid-cols-2 gap-2">
          {enrollment.recoveryCodes.map((recovery) => (
            <li key={recovery} className="rounded-lg border border-[var(--line)] bg-[var(--page)] px-2 py-1.5 text-center font-mono text-sm">
              {recovery}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <Label htmlFor="mfa-confirm-code">Authenticator code</Label>
        <Input id="mfa-confirm-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        Turn on authenticator
      </Button>
    </form>
  );
}
