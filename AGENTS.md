# storageflow (DEVELOPMENT)

Compose is the supported run path. Example tenant is `acme`. Example backend is a local volume.

- Do not commit `secrets/*.json`, `.env`, `known_hosts`, or `*.sops`.
- Do not import live hostnames, tailnet addresses, usernames, or credentials from other repos.
- Isolation is one `serve s3` process per tenant. Do not switch the example to `serve s3 --auth-proxy`.
- Do not add a Dokploy network to the default compose file.

## Cloud Agent

`bash scripts/cloud-agent-install.sh` installs Node 22 (if needed), Docker with `fuse-overlayfs` and `iptables-legacy`, and `npm ci`. `bash scripts/cloud-agent-start.sh` strips Cursor commit attribution, starts the Docker daemon, runs `./scripts/init-secrets.sh`, and brings Compose up. Cabinet is http://127.0.0.1:5173/. Sign in with `SEED_EMAIL` and `SEED_PASSWORD` from `.env`. `npm test` and `npm run typecheck` do not need Compose.
