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

echo "ready: .env and secrets/ stay local"
