import { GRANT_VERBS, type GrantVerb, type IssuedApiKey, type Me, type MemberRole, type TeamUser } from "@storageflow/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { AppShell } from "@/components/header";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, Button, Card, Input, Label } from "@/components/ui";

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: MemberRole;
}

export interface CreateServiceInput {
  name: string;
  email: string;
  keyName: string;
  scopes: GrantVerb[];
}

function failureMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError || cause instanceof Error) return cause.message;
  return fallback;
}

export function CreateUserForm({ onSubmit }: { onSubmit: (input: CreateUserInput) => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const role = data.get("role") === "owner" ? "owner" : "member";
    setError("");
    setBusy(true);
    try {
      await onSubmit({
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        role,
      });
      form.reset();
    } catch (cause) {
      setError(failureMessage(cause, "Could not create the user"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={(event) => void submit(event)} aria-label="Create user">
      <Label htmlFor="person-name">Name</Label>
      <Input id="person-name" name="name" autoComplete="off" required />
      <Label htmlFor="person-email">Email</Label>
      <Input id="person-email" name="email" type="email" autoComplete="off" required />
      <Label htmlFor="person-password">Password</Label>
      <Input id="person-password" name="password" type="password" autoComplete="new-password" required />
      <Label htmlFor="person-role">Role</Label>
      <select id="person-role" name="role" defaultValue="member" className="h-9 rounded-[10px] border border-input bg-white px-3 text-sm">
        <option value="member">member</option>
        <option value="owner">owner</option>
      </select>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" size="sm" disabled={busy} className="mt-1 justify-self-start">
        Create user
      </Button>
    </form>
  );
}

export function CreateServiceForm({ onSubmit }: { onSubmit: (input: CreateServiceInput) => Promise<void> }) {
  const [scopes, setScopes] = useState<GrantVerb[]>(["list"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (scopes.length === 0) {
      setError("Choose at least one scope");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onSubmit({
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        keyName: String(data.get("keyName") ?? "").trim(),
        scopes,
      });
      form.reset();
      setScopes(["list"]);
    } catch (cause) {
      setError(failureMessage(cause, "Could not create the service account"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={(event) => void submit(event)} aria-label="Create service account">
      <Label htmlFor="service-name">Name</Label>
      <Input id="service-name" name="name" autoComplete="off" required />
      <Label htmlFor="service-email">Email</Label>
      <Input id="service-email" name="email" type="email" autoComplete="off" required />
      <Label htmlFor="key-name">Key name</Label>
      <Input id="key-name" name="keyName" autoComplete="off" required />
      <fieldset className="grid gap-1">
        <legend className="text-sm font-medium">Scopes</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {GRANT_VERBS.map((verb) => (
            <label key={verb} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="scopes"
                value={verb}
                checked={scopes.includes(verb)}
                onChange={(event) => {
                  setScopes((current) => (event.target.checked ? [...current, verb] : current.filter((item) => item !== verb)));
                }}
              />
              {verb}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" size="sm" disabled={busy} className="mt-1 justify-self-start">
        Create service account
      </Button>
    </form>
  );
}

export function DisableAccountForm({
  account,
  onDisable,
}: {
  account: Pick<TeamUser, "id" | "name" | "disabledAt">;
  onDisable: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (account.disabledAt) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onDisable(account.id);
    } catch (cause) {
      setError(failureMessage(cause, "Could not disable this account"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex items-center gap-2" aria-label={`Disable ${account.name}`} onSubmit={(event) => void submit(event)}>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" size="sm" variant="outline" disabled={busy}>
        Disable
      </Button>
    </form>
  );
}

function FormAlert({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-[10px] border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

function KeySlip({ name, token, onDismiss }: { name: string; token: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-[12px] border border-dashed border-primary/50 bg-accent px-4 py-3" role="status" aria-label="One-time key">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1d4ed8]">Shown once</p>
      <p className="mt-1 text-sm">Copy the key for {name}. StorageFlow will not show it again.</p>
      <p className="mt-2 break-all rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm">{token}</p>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(token).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy key"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const owner = me.data?.activeTenant?.role === "owner";
  const accounts = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<TeamUser[]>("/admin/users"),
    enabled: owner,
  });
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TeamUser | null>(null);
  const [listError, setListError] = useState("");

  async function createUser(input: CreateUserInput) {
    await api<TeamUser>("/admin/users", {
      method: "POST",
      body: JSON.stringify({ ...input, kind: "user" }),
    });
    setNotice(`Created ${input.name}.`);
    setIssued(null);
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function createService(input: CreateServiceInput) {
    const created = await api<TeamUser>("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: input.email, name: input.name, kind: "service" }),
    });
    try {
      const key = await api<IssuedApiKey>(`/admin/users/${created.id}/keys`, {
        method: "POST",
        body: JSON.stringify({ name: input.keyName, scopes: input.scopes }),
      });
      setIssued({ name: created.name, token: key.token });
      setNotice(`Created ${created.name}.`);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  }

  async function disableAccount(id: string) {
    const account = accounts.data?.find((item) => item.id === id);
    await api(`/admin/users/${id}/disable`, { method: "POST" });
    setNotice(`Disabled ${account?.name ?? "the account"}.`);
    setListError("");
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await api(`/admin/users/${target.id}`, { method: "DELETE" });
      setNotice(`Deleted ${target.name}.`);
      setListError("");
      if (issued?.name === target.name) setIssued(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (cause) {
      setListError(failureMessage(cause, "Could not delete this account"));
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-4 overflow-auto p-6">
        <div>
          <h1 className="text-lg font-semibold">Accounts</h1>
          <p className="text-sm text-[var(--ink-soft)]">Create people and service accounts for this team. A key is shown once.</p>
        </div>
        {!me.data && <p className="text-sm">Loading…</p>}
        {me.data && !owner && <FormAlert>Only an owner can manage accounts.</FormAlert>}
        {owner && (
          <>
            {notice && (
              <p role="status" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm">
                {notice}
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-3 border-[var(--line)] p-4 shadow-sm">
                <h2 className="font-medium">Person</h2>
                <CreateUserForm onSubmit={createUser} />
              </Card>
              <Card className="space-y-3 border-[var(--line)] p-4 shadow-sm">
                <h2 className="font-medium">Service account</h2>
                <CreateServiceForm onSubmit={createService} />
                {issued && <KeySlip name={issued.name} token={issued.token} onDismiss={() => setIssued(null)} />}
              </Card>
            </div>
            <Card className="border-[var(--line)] p-4 shadow-sm">
              <h2 className="font-medium">Team</h2>
              {accounts.isLoading && <p className="mt-2 text-sm">Loading accounts…</p>}
              {accounts.error instanceof Error && <div className="mt-2"><FormAlert>{accounts.error.message}</FormAlert></div>}
              {listError && <div className="mt-2"><FormAlert>{listError}</FormAlert></div>}
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {accounts.data?.map((account) => {
                  const self = account.id === me.data?.user.id;
                  return (
                    <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{account.name}</p>
                        <p className="text-sm text-[var(--ink-soft)]">
                          {account.email} · {account.kind === "service" ? "service account" : "person"} · {account.role}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={account.disabledAt ? "text-sm text-destructive" : "text-sm text-[var(--ink-soft)]"}>
                          {account.disabledAt ? "Disabled" : "Active"}
                        </span>
                        {self ? (
                          <span className="text-sm text-[var(--ink-soft)]">You</span>
                        ) : (
                          <>
                            <DisableAccountForm account={account} onDisable={disableAccount} />
                            <Button type="button" size="sm" variant="destructive" onClick={() => setPendingDelete(account)}>
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </>
        )}
      </main>
      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle className="text-base font-semibold">Delete {pendingDelete?.name}?</AlertDialogTitle>
          <AlertDialogDescription className="mt-1 text-sm text-[var(--ink-soft)]">
            This removes {pendingDelete?.email} from the team.
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
