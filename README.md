# storageflow

Runnable storage plane. Compose is the supported run path.

CORE is the concept: https://github.com/real-limitless/storageflow/tree/CORE

## Stand up

```sh
git clone -b DEVELOPMENT https://github.com/real-limitless/storageflow.git
cd storageflow
./scripts/init-secrets.sh
docker compose up -d --build
```

| Surface | URL |
| --- | --- |
| SFTPGo UI | http://127.0.0.1:5179/ |
| Admin S3 (write-back) | http://127.0.0.1:8794/ |
| Tenant `acme` S3 | http://127.0.0.1:8795/ |
| SFTP | `127.0.0.1:2022` |

`init-secrets.sh` writes `.env` and `secrets/tenants.json`. Both are gitignored. SFTPGo admin password is in `.env`. S3 keys are in `secrets/tenants.json`.

S3 clients need path-style. Example backend is a local volume at `./data/backend`. Not a remote server. Not MinIO.

## What runs

| Service | Role |
| --- | --- |
| `s3-through` | Admin gateway, write-through. Not published. |
| `s3-cache` | Admin gateway, write-back cache. Port 8794. |
| `s3-acme` | One process for tenant `acme`. Port 8795. |
| `sftpgo` | SFTP door and admin UI. |
| `media-mount` | Optional FUSE profile. |

Isolation is one `rclone serve s3` process per tenant. Do not switch this stack to `serve s3 --auth-proxy`. That mode has no VFS.

SFTPGo does not import tenants by itself. In the UI, add an S3 user aimed at `http://s3-acme:8080` with the `acme` key from `secrets/tenants.json`. Force path style.

## Optional

```sh
docker compose --profile fuse up -d --build
docker compose -f docker-compose.yml -f docker-compose.dokploy.yml up -d --build
```

The fuse profile mounts `acme-plain` at `${MEDIA_MOUNT:-./data/media}`. It needs `/dev/fuse`. The Dokploy file only attaches an external network named `dokploy-network`. It does not start without that network.

## Add a tenant

[docs/add-tenant.md](docs/add-tenant.md)

## Secrets

Commit `secrets/*.example` only. Do not commit `secrets/*.json`, `.env`, `known_hosts`, or `*.sops`.

If you later encrypt config, mount it at `/encrypted` and set `SOPS_AGE_KEY`. The image does not bake secrets or host keys. `.sops.yaml.example` is a blank recipient. Generate your own age key. Do not reuse a key from another repo.
