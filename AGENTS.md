# storageflow (CORE)

This checkout is the CORE branch: concept, license, campaign frames, and marketing site. No storage-plane source.

- Runnable plane: branch DEVELOPMENT. Compose is the supported run path. Not shipped yet.
- Campaign frames: `docs/campaign/`. Capture with `./capture.sh` into `docs/images/`.
- Campaign CSS in `docs/campaign/assets/styles.css` uses the same palette as `site/assets/styles.css`.
- Do not add src/, package.json, docker-compose.yml, or gateway images here.
- Do not import private operator inventory, hostnames, credentials, or tailnet addresses from other repos.
- Do not claim DEVELOPMENT is runnable until the plane exists.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
