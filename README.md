# storageflow

This is the **DEVELOPMENT** branch. The runnable storage plane is **not shipped** yet.

CORE is the front door: concept, campaign, and GitHub Pages.

→ https://github.com/real-limitless/storageflow/tree/CORE

Clients speak S3 or SFTP. Bytes live on backends you already operate. One gateway process per tenant.

When the app exists, Compose will be the supported run path. Reserved ports: API 8794, UI 5179.

Do not add `src/` here until the plane is real.
