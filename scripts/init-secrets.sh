#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
mkdir -p secrets data/backend/acme/plain data/media

# Same file creation as the hosted config-bootstrap service. .env stays local.
enc=$(mktemp -d "${TMPDIR:-/tmp}/sf-enc.XXXXXX")
cleanup() { rm -rf "$enc"; }
trap cleanup EXIT
STORAGEFLOW_CONFIG_DIR="$root/secrets" \
STORAGEFLOW_EXAMPLES_DIR="$root/secrets" \
STORAGEFLOW_ENCRYPTED_MOUNT="$enc" \
  sh "$root/scripts/bootstrap-hosted-config.sh"

if [ ! -f .env ]; then
  python3 - << 'PY'
import secrets
from pathlib import Path

password = secrets.token_urlsafe(18)
Path(".env").write_text(
    "SFTPGO_ADMIN_USERNAME=admin\n"
    f"SFTPGO_ADMIN_PASSWORD={password}\n"
    "VFS_CACHE_MAX_SIZE=20G\n"
    "VFS_WRITE_BACK=5s\n"
)
Path(".env").chmod(0o600)
PY
fi

python3 - << 'PY'
import secrets
import socket
from pathlib import Path

path = Path(".env")
text = path.read_text() if path.exists() else ""

def ensure(key, value):
    global text
    if any(line.startswith(f"{key}=") for line in text.splitlines()):
        return
    if text and not text.endswith("\n"):
        text += "\n"
    text += f"{key}={value}\n"

ensure("APP_ENCRYPTION_KEY", secrets.token_hex(32))
ensure("POSTGRES_PASSWORD", secrets.token_urlsafe(18))
ensure("SEED_EMAIL", "ada@acme.test")
ensure("SEED_PASSWORD", secrets.token_urlsafe(12))
ensure("SEED_NAME", "Ada")
ensure("ALLOW_PLAN_FLAG", "1")
ensure("PUBLIC_ORIGIN", "http://127.0.0.1:5173")
loopback = socket.getaddrinfo("localhost", None, socket.AF_INET)[0][4][0]
ensure("SF_PUBLISH_HOST", loopback)
ensure("HOSTED_S3_BUCKET", "acme-plain")
ensure("HOSTED_TENANT", "acme")
path.write_text(text)
path.chmod(0o600)
PY

echo "ready: .env and secrets/ stay local"
