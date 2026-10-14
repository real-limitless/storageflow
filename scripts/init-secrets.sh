#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
mkdir -p secrets data/backend/acme/plain data/media

if [ ! -f secrets/tenants.json ]; then
  cp secrets/tenants.json.example secrets/tenants.json
  python3 - << 'PY'
import json
import secrets
from pathlib import Path

path = Path("secrets/tenants.json")
data = json.loads(path.read_text())
data["admin"]["access_key"] = "sf" + secrets.token_hex(8)
data["admin"]["secret_key"] = secrets.token_hex(20)
data["acme"]["access_key"] = "sf" + secrets.token_hex(8)
data["acme"]["secret_key"] = secrets.token_hex(20)
path.write_text(json.dumps(data, indent=2) + "\n")
path.chmod(0o600)
PY
fi

if [ ! -f secrets/rclone.json ]; then
  cp secrets/rclone.json.example secrets/rclone.json
  chmod 600 secrets/rclone.json
fi

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
ensure("HOSTED_S3_BUCKET", "acme-plain")
ensure("HOSTED_TENANT", "acme")
path.write_text(text)
path.chmod(0o600)
PY

echo "ready: .env and secrets/ stay local"
