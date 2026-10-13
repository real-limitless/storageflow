import type { Me, TransferPlan } from "@storageflow/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { AppShell } from "@/components/header";
import { Button, Card, Input, Label } from "@/components/ui";

export function AccountPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  if (!me.data) return <p className="p-6">Loading…</p>;
  const data = me.data;
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
        <h1 className="text-lg font-semibold">Account</h1>
        <Card className="space-y-3 p-4">
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get("name");
              await api("/me", { method: "PATCH", body: JSON.stringify({ name }) });
              await queryClient.invalidateQueries({ queryKey: ["me"] });
            }}
          >
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" name="name" defaultValue={data.user.name} />
            <p className="text-sm text-muted-foreground">{data.user.email}</p>
            <Button type="submit" size="sm">Save profile</Button>
          </form>
          <p className="text-sm">Active workspace: {data.activeTenant?.name ?? "None"}</p>
          <p className="text-sm">Transfer plan: {data.user.transferPlan}. This only changes public transfer tickets.</p>
          {data.canSetPlan && (
            <div className="flex gap-2">
              {(["free", "paid"] as TransferPlan[]).map((plan) => (
                <Button
                  key={plan}
                  size="sm"
                  variant={data.user.transferPlan === plan ? "default" : "outline"}
                  onClick={async () => {
                    await api("/me/transfer-plan", { method: "POST", body: JSON.stringify({ plan }) });
                    await queryClient.invalidateQueries({ queryKey: ["me"] });
                  }}
                >
                  {plan}
                </Button>
              ))}
            </div>
          )}
          <p className="text-sm">Hosted storage {formatBytes(data.hostedUsageBytes)} of {formatBytes(data.hostedQuotaBytes)}. Linked drawers are estimated at {formatBytes(data.linkedUsageBytes)} and do not count against the plan.</p>
          <Button
            variant="outline"
            onClick={async () => {
              await api("/sessions", { method: "DELETE" });
              void navigate({ to: "/sign-in" });
            }}
          >
            Sign out everywhere
          </Button>
        </Card>
        {data.transferSettings && (
          <Card className="space-y-2 p-4">
            <h2 className="font-medium">Free and paid ticket limits</h2>
            <TransferForm settings={data.transferSettings} />
          </Card>
        )}
      </main>
    </AppShell>
  );
}

function TransferForm({ settings }: { settings: Me["transferSettings"] }) {
  if (!settings) return null;
  return (
    <form
      className="grid gap-2 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = Object.fromEntries([...form.entries()].map(([key, value]) => [key, Number(value)]));
        await api("/transfer-settings", { method: "PATCH", body: JSON.stringify(body) });
      }}
    >
      <Label htmlFor="freeWaitSeconds">Free wait seconds</Label>
      <Input id="freeWaitSeconds" name="freeWaitSeconds" defaultValue={settings.freeWaitSeconds} />
      <Label htmlFor="freeBytesPerSecond">Free bytes per second</Label>
      <Input id="freeBytesPerSecond" name="freeBytesPerSecond" defaultValue={settings.freeBytesPerSecond} />
      <Label htmlFor="freeDailyBytes">Free daily bytes</Label>
      <Input id="freeDailyBytes" name="freeDailyBytes" defaultValue={settings.freeDailyBytes} />
      <Label htmlFor="freeCooldownSeconds">Free cooldown seconds</Label>
      <Input id="freeCooldownSeconds" name="freeCooldownSeconds" defaultValue={settings.freeCooldownSeconds} />
      <Button type="submit" size="sm">Save limits</Button>
    </form>
  );
}
