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
| Ports | SFTPGo UI **5179**, admin S3 **8794**, tenant S3 **8795**, SFTP **2022**. |
| Run path | Compose on DEVELOPMENT. |

## Phases

| Phase | Status |
| --- | --- |
| P0 CORE concept + campaign + site | this branch |
| P1 DEVELOPMENT compose stack | shipped (example local backend) |
| P2 Per-tenant S3 gateway | example tenant `acme` |
| P3 SFTP door | SFTPGo shipped. SFTP backend is optional, not the example. |
| P4 Crypt, chunker, cache modes | write-back cache shipped. Crypt and chunker documented, not in the example. |

## Non-goals (v1)

- Public multi-tenant SaaS
- Vendoring MinIO or another distributed object store
- Putting backend passwords in client config
- Claiming affiliation with Amazon S3, rclone, or SFTPGo
