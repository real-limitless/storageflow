#!/bin/sh
# Serve the static campaign site (not the storage plane).
set -eu
cd "$(dirname "$0")/.."
port="${SITE_PREVIEW_PORT:-8768}"
echo "storageflow campaign site → http://127.0.0.1:${port}/"
exec python3 -m http.server "$port" --directory site --bind 127.0.0.1
