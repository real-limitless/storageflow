# storageflow

**One S3 and SFTP front. Tenants get their own gateway. Secrets stay on the plane.**

This branch (`CORE`) is documentation only: why the storage plane exists, campaign frames, and the marketing site. The runnable plane lives on [`DEVELOPMENT`](https://github.com/real-limitless/storageflow/tree/DEVELOPMENT).

| | |
|---|---|
| **License** | [Apache-2.0](LICENSE) |
| **Install / code** | [`DEVELOPMENT`](https://github.com/real-limitless/storageflow/tree/DEVELOPMENT) |
| **Marketing site** | [site/](site/) |
| **Campaign** | [docs/campaign/](docs/campaign/) |
| **Branches** | [BRANCHES.md](BRANCHES.md) |
| **Species** | [SPECIES.md](SPECIES.md) |
| **Install** | [INSTALLATION.md](INSTALLATION.md) |
| **Voice** | [VOICE.md](VOICE.md) |
| **Plan** | [PLAN.md](PLAN.md) |
| **Legal** | [LEGAL.md](LEGAL.md) |

Clients should not each grow a disk. Bytes belong on backends you already operate.

## Visual tour

Screenshots are not shot yet. Frames live in [`docs/campaign/`](docs/campaign/). Re-shoot into [`docs/images/`](docs/images/) with `./capture.sh`.

| Frame | Story |
| --- | --- |
| Hero | One front door. Keep the bytes. |
| Why | Every app should not grow its own disk. |
| Tenants | One gateway process per tenant. |
| Doors | S3 and SFTP, same bytes. |
| Modes | Write-through and write-back cache. |

## What storageflow is

storageflow is the **storage plane**. Clients speak S3 or SFTP. Bytes live on remotes you already run. Each tenant gets its own gateway process. Optional crypt and chunking sit in front of plain files. Write-through and write-back cache are modes of the same plane.

It does not vendor a distributed object cluster. It is not a public file host.

### Core ideas

1. **Two doors, one plane.** S3 (path-style) and SFTP see the same tenant bytes.
2. **Isolation is a process.** One gateway per tenant. Not a shared auth proxy.
3. **Plain files underneath.** Crypt and chunking are optional layers. The backing store is files on a remote you already operate.
4. **Secrets stay sealed.** Upstream credentials live on the plane. Clients get a tenant key, not the backend password.
5. **Compose is the run path.** Clone DEVELOPMENT. A host install is not the product.

### Typical flow

```text
S3 client or SFTP client
  → tenant gateway (one process)
      → optional crypt / chunker
          → backend remote (SFTP or local files)
```

Cache mode writes back from a local cache. Write-through does not.

## Get the software

```sh
git clone -b DEVELOPMENT https://github.com/real-limitless/storageflow.git
cd storageflow
./scripts/init-secrets.sh
docker compose up -d --build
```

| Surface | URL |
| --- | --- |
| SFTPGo UI | http://127.0.0.1:5179/ |
| Admin S3 | http://127.0.0.1:8794/ |
| Tenant `acme` S3 | http://127.0.0.1:8795/ |
| SFTP | `127.0.0.1:2022` |

## Family

Written standard: private TheFLOW.

- mcp-flow: MCP gateway. Agents call tools. This plane holds bytes.
- OpenFlow: workflows may read and write objects later
- roster-flow: seats may need a volume later
- skill-flow: Agent Skills
- ansible-flow-mcp: Ansible for agents
- wiki-flow: wiki workspace
- sandbox-flow: guest fabric
- qa-flow: testing plane
- CleanFlow: clean-room dock
- ProjectEverflow: governance platform

## Who made it

Chen Chiu, creator, [@real-limitless](https://github.com/real-limitless)

Independent project under the real-limitless account. Not an official Amazon S3, SFTP, or MinIO product.
