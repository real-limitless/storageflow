# Installation

Source: private kit TheFLOW. Family ritual: clone DEVELOPMENT, then Compose.

This CORE branch is documentation only. The storage plane is **not shipped** on DEVELOPMENT yet. Do not expect `docker compose up` to bring up gateways.

When DEVELOPMENT ships:

```sh
git clone -b DEVELOPMENT https://github.com/real-limitless/storageflow.git
cd storageflow
cp .env.example .env
docker compose up -d --build
```

Reserved ports:

| Surface | Port |
| --- | --- |
| Control API | http://127.0.0.1:8794/ |
| UI | http://127.0.0.1:5179/ |

Data-plane ports (S3, SFTP) are chosen on DEVELOPMENT. They are not part of this docs branch.

Host installs are for contributors. They are not the supported run path.

Until DEVELOPMENT ships, stay on CORE: read the concept, campaign, and site.
