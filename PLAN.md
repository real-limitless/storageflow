# [PLAN] storageflow: one front door

## Summary

**storageflow** is the storage plane. Clients speak S3 or SFTP. Bytes live on backends you already operate. Each tenant gets its own gateway process. Not a second object cluster. Not a public file host.

## Locked decisions

| Concern | Choice |
| --- | --- |
| Name | storageflow |
| Doors | S3 path-style and SFTP. Same tenant bytes. |
| Isolation | One gateway process per tenant. Not a shared auth proxy. |
| Backing store | Remotes you already operate (SFTP or local files). |
| Layers | Plain files. Optional crypt. Optional chunker. |
| Modes | Write-through and write-back cache. Same plane. |
| Secrets | Sealed on the plane. Clients get a tenant key. |
| Ports | API **8794**, UI **5179**. Data-plane ports decided later. |
| Run path | Compose, when DEVELOPMENT ships. |

## Phases

| Phase | Status |
| --- | --- |
| P0 CORE concept + campaign + site | this branch |
| P1 DEVELOPMENT control plane | not shipped |
| P2 Per-tenant S3 gateway | not shipped |
| P3 SFTP door on the same bytes | not shipped |
| P4 Crypt, chunker, cache modes | not shipped |

## Non-goals (v1)

- Public multi-tenant SaaS
- Vendoring MinIO or another distributed object store
- Putting backend passwords in client config
- Claiming affiliation with Amazon S3, rclone, or SFTPGo
