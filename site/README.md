# storageflow marketing site

Static campaign shell for GitHub Pages. Same family chrome as mcp-flow, skill-flow, ansible-flow-mcp, and OpenFlow. **Not** the storage plane.

Design source of truth: [`docs/campaign/`](../docs/campaign/) (1440×900 frames + capture). This `site/` is the fluid Pages version of that chrome. Orange accent. Pentagon mark. Volume rail.

## Pages

| File | Story |
| --- | --- |
| `index.html` | Hero · two doors · volume rail |
| `why.html` | Act I: every app should not grow a disk |
| `how.html` | Act II: tenant process, S3 and SFTP, cache modes |
| `start.html` | Act III: DEVELOPMENT not shipped yet |
| `404.html` | Empty volume |

## Local preview

```bash
./scripts/site_preview.sh
# http://127.0.0.1:8768/
```

## Deploy

GitHub Actions workflow `.github/workflows/pages.yml` publishes `site/` to GitHub Pages. Enable **Settings → Pages → Source: GitHub Actions**.

Project URL: `https://real-limitless.github.io/storageflow/`.
