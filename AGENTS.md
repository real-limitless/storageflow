# storageflow (DEVELOPMENT)

Compose is the supported run path. Example tenant is `acme`. Example backend is a local volume.

- Do not commit `secrets/*.json`, `.env`, `known_hosts`, or `*.sops`.
- Do not import live hostnames, tailnet addresses, usernames, or credentials from other repos.
- Isolation is one `serve s3` process per tenant. Do not switch the example to `serve s3 --auth-proxy`.
- Do not add a Dokploy network to the default compose file.
