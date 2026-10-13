# Installation

Source: private kit TheFLOW. Family ritual: clone DEVELOPMENT, then Compose.

This CORE branch is documentation only. The example stack is on DEVELOPMENT.

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

The example backend is a local volume. It is not a remote host. Host Node is not the supported run path.

`init-secrets.sh` writes gitignored `.env` and `secrets/tenants.json`. Do not commit them.
