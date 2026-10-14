import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GRANT_VERBS, PROJECT_KINDS, type Drawer, type GrantView, type GrantVerb, type Project, type TestResult } from "@storageflow/domain";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, Textarea } from "@/components/ui";

const wizardSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  mode: z.enum(["hosted", "linked"]),
  endpoint: z.string().optional(),
  region: z.string().optional(),
  bucket: z.string().optional(),
  prefix: z.string().optional(),
  pathStyle: z.boolean(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  notes: z.string().optional(),
});

type WizardValues = z.infer<typeof wizardSchema>;

export function DrawerWizard({
  open,
  onOpenChange,
  projectId,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projects: Project[];
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [test, setTest] = useState<TestResult | null>(null);
  const form = useForm<WizardValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: { name: "", mode: "hosted", region: "us-east-1", pathStyle: true, prefix: "", endpoint: "", bucket: "", accessKey: "", secretKey: "", notes: "" },
  });
  const mode = form.watch("mode");
  const steps = mode === "hosted" ? ["Name", "Backend", "Test", "Create"] : ["Name", "Backend", "Binding", "Test", "Create"];

  const create = useMutation({
    mutationFn: (values: WizardValues) =>
      api<Drawer>(`/projects/${projectId}/drawers`, {
        method: "POST",
        body: JSON.stringify({ ...values, projectId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["drawers", projectId] });
      onOpenChange(false);
      setStep(0);
      setTest(null);
      form.reset();
    },
  });

  async function runTest() {
    const values = form.getValues();
    const result = await api<TestResult>(`/projects/${projectId}/drawers/test`, { method: "POST", body: JSON.stringify(values) });
    setTest(result);
  }

  function next() {
    if (step === 0 && !form.getValues("name").trim()) {
      form.setError("name", { message: "Name is required" });
      return;
    }
    setStep((value) => Math.min(value + 1, steps.length - 1));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New drawer</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {steps.length}: {steps[step]}. A drawer is one storage root. Linked storage stays in your bucket. Hosted storage counts against the StorageFlow plan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            if (steps[step] !== "Create") {
              event.preventDefault();
              next();
              return;
            }
            void form.handleSubmit((values) => create.mutate(values))(event);
          }}
        >
          {steps[step] === "Name" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="drawer-name">Name</Label>
                <Input id="drawer-name" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Project</Label>
                <p className="text-sm">{projects.find((project) => project.id === projectId)?.name}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={mode === "hosted" ? "default" : "outline"} onClick={() => form.setValue("mode", "hosted")}>
                  Hosted
                </Button>
                <Button type="button" variant={mode === "linked" ? "default" : "outline"} onClick={() => form.setValue("mode", "linked")}>
                  Linked
                </Button>
              </div>
              <Textarea placeholder="Notes" {...form.register("notes")} />
            </div>
          )}
          {steps[step] === "Backend" && (
            <div className="space-y-2 text-sm">
              {mode === "hosted" ? (
                <p>Hosted drawers use this tenant’s StorageFlow volume. The browser does not pick a laptop folder, and SFTP appears when that adapter exists.</p>
              ) : (
                <p>S3-compatible storage. Path-style works with the StorageFlow rclone gateway. SFTP is not offered until that adapter exists.</p>
              )}
            </div>
          )}
          {steps[step] === "Binding" && (
            <div className="grid gap-2">
              <Label htmlFor="endpoint">Endpoint</Label>
              <Input id="endpoint" placeholder="http://127.0.0.1:8795" {...form.register("endpoint")} />
              <Label htmlFor="region">Region</Label>
              <Input id="region" {...form.register("region")} />
              <Label htmlFor="bucket">Bucket</Label>
              <Input id="bucket" {...form.register("bucket")} />
              <Label htmlFor="prefix">Prefix</Label>
              <Input id="prefix" {...form.register("prefix")} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.watch("pathStyle")} onCheckedChange={(checked) => form.setValue("pathStyle", checked === true)} />
                Path-style URLs
              </label>
              <Label htmlFor="accessKey">Access key</Label>
              <Input id="accessKey" {...form.register("accessKey")} />
              <Label htmlFor="secretKey">Secret</Label>
              <Input id="secretKey" type="password" autoComplete="new-password" {...form.register("secretKey")} />
            </div>
          )}
          {steps[step] === "Test" && (
            <div className="space-y-2 text-sm">
              <Button type="button" variant="secondary" onClick={() => void runTest()}>
                Test connection
              </Button>
              {test && test.ok && <p>Reachable. First names: {test.names.length ? test.names.join(", ") : "the prefix is empty."}</p>}
              {test && !test.ok && <p className="text-destructive">{test.message}</p>}
              {!test && <p className="text-muted-foreground">List the prefix before creating the drawer. You can still create it if the list is empty or the test fails.</p>}
            </div>
          )}
          {steps[step] === "Create" && <p className="text-sm">The drawer joins {projects.find((project) => project.id === projectId)?.name}. An empty first list is fine.</p>}
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
              Back
            </Button>
            {steps[step] === "Create" ? (
              <Button type="submit" disabled={create.isPending}>
                Create drawer
              </Button>
            ) : (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const folderSchema = z.object({ name: z.string().min(1).max(200) });

export function FolderDialog({ open, onOpenChange, drawerId, parentId }: { open: boolean; onOpenChange: (open: boolean) => void; drawerId: string; parentId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<{ name: string }>({ resolver: zodResolver(folderSchema), defaultValues: { name: "" } });
  const create = useMutation({
    mutationFn: (values: { name: string }) => api(`/drawers/${drawerId}/folders`, { method: "POST", body: JSON.stringify({ parentId, name: values.name }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tree", drawerId] });
      await queryClient.invalidateQueries({ queryKey: ["listing", drawerId] });
      onOpenChange(false);
      form.reset();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>The folder is created on the drawer’s backend, under the current selection.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <Label htmlFor="folder-name">Name</Label>
          <Input id="folder-name" {...form.register("name")} />
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <Button type="submit">Create folder</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShareDialog({ nodeId, open, onOpenChange }: { nodeId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryKey: ["grants", nodeId],
    enabled: open && !!nodeId,
    queryFn: () => api<GrantView[]>(`/nodes/${nodeId}/grants`),
  });
  const [email, setEmail] = useState("");
  const [anyone, setAnyone] = useState(false);
  const [verbs, setVerbs] = useState<GrantVerb[]>(["list", "download"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [password, setPassword] = useState("");
  const [downloadCap, setDownloadCap] = useState("");
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<GrantView>(`/nodes/${nodeId}/grants`, {
        method: "POST",
        body: JSON.stringify({
          email: anyone ? undefined : email,
          anyoneWithLink: anyone,
          verbs,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          password: password || undefined,
          downloadCap: downloadCap ? Number(downloadCap) : undefined,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["grants", nodeId] });
      setEmail("");
      setPassword("");
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Could not share"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>Guests enter through the portal. Upload without list is a drop folder. This is not a public transfer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="share-email">Email</Label>
          <Input id="share-email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={anyone} placeholder="guest@example.com" />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={anyone} onCheckedChange={(checked) => setAnyone(checked === true)} />
            Anyone with the link
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            {GRANT_VERBS.map((verb) => (
              <label key={verb} className="flex items-center gap-1.5">
                <Checkbox
                  checked={verbs.includes(verb)}
                  onCheckedChange={(checked) => setVerbs((current) => (checked ? [...current, verb] : current.filter((item) => item !== verb)))}
                />
                {verb}
              </label>
            ))}
          </div>
          <Label htmlFor="share-expires">Expiry</Label>
          <Input id="share-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          <Label htmlFor="share-password">Password</Label>
          <Input id="share-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          <Label htmlFor="share-cap">Download cap</Label>
          <Input id="share-cap" value={downloadCap} onChange={(event) => setDownloadCap(event.target.value)} inputMode="numeric" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={() => create.mutate()} disabled={!nodeId || create.isPending}>
            Create link
          </Button>
          <ul className="space-y-2 text-sm">
            {grants.data?.map((grant) => (
              <li key={grant.id} className="rounded-md border p-2">
                <p>{grant.anyoneWithLink ? "Anyone with the link" : grant.granteeEmail}</p>
                <p className="text-muted-foreground">{grant.verbs.join(", ")}</p>
                {grant.link && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(grant.link ?? "")}>
                    Copy link
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await api(`/grants/${grant.id}`, { method: "DELETE" });
                    await queryClient.invalidateQueries({ queryKey: ["grants", nodeId] });
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const publishSchema = z.object({
  title: z.string().min(1),
  visibility: z.enum(["unlisted", "public"]),
  note: z.string().optional(),
});

export function PublishDialog({ fileId, fileName, open, onOpenChange }: { fileId: string | null; fileName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const form = useForm<z.infer<typeof publishSchema>>({
    resolver: zodResolver(publishSchema),
    values: { title: fileName, visibility: "unlisted", note: "" },
  });
  const existing = useQuery({
    queryKey: ["publication", fileId],
    enabled: open && !!fileId,
    queryFn: () => api<{ id: string; publicId: string; title: string } | null>(`/files/${fileId}/publication`),
  });
  const publish = useMutation({
    mutationFn: (values: z.infer<typeof publishSchema>) => api(`/files/${fileId}/publication`, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
          <DialogDescription>A transfer record is separate from a portal share. Free and paid download rules apply only here.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={form.handleSubmit((values) => publish.mutate(values))}>
          <Label htmlFor="publish-title">Title</Label>
          <Input id="publish-title" {...form.register("title")} />
          <Label>Catalog</Label>
          <Select value={form.watch("visibility")} onValueChange={(value) => form.setValue("visibility", value === "public" ? "public" : "unlisted")}>
            <SelectTrigger />
            <SelectContent>
              <SelectItem value="unlisted">Unlisted link</SelectItem>
              <SelectItem value="public">Public catalog</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Note" {...form.register("note")} />
          {publish.error && <p className="text-sm text-destructive">{publish.error.message}</p>}
          <div className="flex gap-2">
            <Button type="submit">Publish</Button>
            {existing.data?.id && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await api(`/publications/${existing.data?.id}`, { method: "DELETE" });
                  onOpenChange(false);
                }}
              >
                Unpublish
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectCreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof PROJECT_KINDS)[number]>("custom");
  const [error, setError] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>A project is Work, Personal, School, Sports, or a name you type. It is not a folder.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const project = await api<Project>("/projects", { method: "POST", body: JSON.stringify({ name, kind }) });
              onCreated(project);
              onOpenChange(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not create the project");
            }
          }}
        >
          <Label htmlFor="project-name">Name</Label>
          <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as (typeof PROJECT_KINDS)[number])}>
            <SelectTrigger />
            <SelectContent>
              {PROJECT_KINDS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit">Create project</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
