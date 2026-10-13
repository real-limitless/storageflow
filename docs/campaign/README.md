# Campaign storyboard

Static HTML frames used to produce README marketing screenshots.

## Frames

| File | Output PNG |
| --- | --- |
| `frames/hero.html` | `docs/images/campaign-hero.png` |
| `frames/why.html` | `docs/images/campaign-why.png` |
| `frames/tenants.html` | `docs/images/campaign-tenants.png` |
| `frames/doors.html` | `docs/images/campaign-doors.png` |
| `frames/modes.html` | `docs/images/campaign-modes.png` |

Orange accent `#f97316`. Volume rail. Same chassis, pentagon mark, and vault extras as mcp-flow / ansible-flow-mcp / OpenFlow.

## Capture

```bash
cd docs/campaign
./capture.sh
```

Requires network once for Google Fonts (or frames fall back to system fonts). Uses Playwright via a temp install when available.

Manual: open a frame in a browser at 100% zoom and screenshot the 1440×900 `#frame` canvas.

## Story

1. **Hero**: one front door, keep the bytes
2. **Why**: every app should not grow its own disk
3. **Tenants**: one gateway process per tenant
4. **Doors**: S3 and SFTP, same bytes
5. **Modes**: write-through and write-back cache
