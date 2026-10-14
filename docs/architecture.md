# Architecture

No distributed object cluster on the data path. Objects on disk are normal files. Crypt and chunker are optional layers.

```text
S3 client     → rclone serve s3
                 ├ s3-through   vfs-cache-mode off   (admin)
                 ├ s3-cache     vfs-cache-mode full  (admin)
                 └ s3-acme      one process, tenant acme
SFTP client   → SFTPGo → http://s3-<tenant>:8080
FUSE          → media-mount profile → acme-plain
backend       → local volume ./data/backend
                 optional SFTP remote you already operate
```

## Isolation

`rclone serve s3 --auth-proxy` has no VFS. This stack runs one `serve s3` process per tenant. Each process has its own combine remote and `--auth-key`.

Admin processes use the `gateway` remote and the `admin` key. `s3-acme` uses `gateway-acme` and the `acme` key.

## Cabinet

The operator console, guest portal, and public transfer service sit on this plane. Postgres holds tenants, projects, drawers, grants, and the listing cache. Bytes stay on the drawer backend. Hosted drawers for tenant `acme` use `s3-acme` and the `acme-plain` bucket. The API streams a linked or hosted object to a guest or a transfer ticket so the backend credential is not handed out. One `serve s3` process per tenant stays the isolation rule.

Team, cabinet, drawer, folder, and file routes are in [cabinet-rest.md](cabinet-rest.md). Port 8794 is admin S3. Port 5179 is SFTPGo.

## Team

The tenant is the team. `memberships.role` is `owner` or `member`. There is no second team table. Cabinets are `projects` rows inside the tenant, and drawers belong to a cabinet. `access.ts` loads drawers and nodes with `tenant_id`, so one team cannot read another team's drawers.

## Modes

Write-through (`s3-through`) waits for the backend. Write-back (`s3-cache`, `s3-acme`) lands in a local VFS cache, then flushes.

The example backend is local files so `docker compose up` does not need a remote host. An SFTP backend is a config change. See [add-tenant.md](add-tenant.md).

## Secrets

Plain config is mounted at `/config` and copied to tmpfs at start. Encrypted config is optional: `SOPS_AGE_KEY` plus `/encrypted/*.sops`. Neither path is baked into the image.
