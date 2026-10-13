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

## Modes

Write-through (`s3-through`) waits for the backend. Write-back (`s3-cache`, `s3-acme`) lands in a local VFS cache, then flushes.

The example backend is local files so `docker compose up` does not need a remote host. An SFTP backend is a config change. See [add-tenant.md](add-tenant.md).

## Secrets

Plain config is mounted at `/config` and copied to tmpfs at start. Encrypted config is optional: `SOPS_AGE_KEY` plus `/encrypted/*.sops`. Neither path is baked into the image.
