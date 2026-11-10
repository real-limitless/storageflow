#!/bin/sh
# Create tenants.json and rclone.json when the hosted config directory is empty.
# Existing files are left untouched. This script does not write .env.
set -eu

CONFIG_DIR=${STORAGEFLOW_CONFIG_DIR:-/config}
EXAMPLES_DIR=${STORAGEFLOW_EXAMPLES_DIR:-/opt/storageflow/examples}
ENCRYPTED_DIR=${STORAGEFLOW_ENCRYPTED_MOUNT:-/encrypted}

TENANTS="$CONFIG_DIR/tenants.json"
RCLONE="$CONFIG_DIR/rclone.json"
EXAMPLE_TENANTS="$EXAMPLES_DIR/tenants.json.example"
EXAMPLE_RCLONE="$EXAMPLES_DIR/rclone.json.example"
ENC_TENANTS="$ENCRYPTED_DIR/tenants.json.sops"
ENC_RCLONE="$ENCRYPTED_DIR/rclone.json.sops"

die() {
  echo "storageflow: $*" >&2
  exit 1
}

if [ -f "$TENANTS" ] && [ -f "$RCLONE" ]; then
  echo "storageflow: tenants.json and rclone.json are already present; leaving them unchanged."
  exit 0
fi

if [ -f "$ENC_TENANTS" ] && [ -f "$ENC_RCLONE" ] && [ -n "${SOPS_AGE_KEY:-}" ]; then
  echo "storageflow: encrypted config is present; leaving the plaintext config directory unchanged."
  exit 0
fi

if [ -f "$ENC_TENANTS" ] || [ -f "$ENC_RCLONE" ]; then
  die "encrypted config is incomplete. Set SOPS_AGE_KEY and mount both tenants.json.sops and rclone.json.sops at /encrypted (STORAGEFLOW_ENCRYPTED_DIR), or remove the encrypted files and provide tenants.json and rclone.json. Refusing to start the S3 gateways."
fi

if [ ! -f "$EXAMPLE_TENANTS" ] || [ ! -f "$EXAMPLE_RCLONE" ]; then
  die "missing config examples (${EXAMPLE_TENANTS} and ${EXAMPLE_RCLONE}). Refusing to invent gateway config."
fi

if [ ! -d "$CONFIG_DIR" ]; then
  die "config directory ${CONFIG_DIR} does not exist. Mount a writable volume at /config (named volume secrets-data, or set STORAGEFLOW_SECRETS_DIR), place tenants.json and rclone.json there, or set SOPS_AGE_KEY and mount tenants.json.sops and rclone.json.sops at /encrypted. Refusing to start the S3 gateways."
fi

missing=""
if [ ! -f "$TENANTS" ]; then
  missing="tenants.json"
fi
if [ ! -f "$RCLONE" ]; then
  if [ -n "$missing" ]; then
    missing="$missing and rclone.json"
  else
    missing="rclone.json"
  fi
fi

probe="$CONFIG_DIR/.storageflow-write-probe.$$"
if ! (umask 077; : > "$probe") 2>/dev/null; then
  die "${CONFIG_DIR} is missing ${missing} and is not writable. Mount a writable config directory, or place both files before start. An empty read-only directory would make the S3 gateways exit and restart continuously; refusing to start them. Encrypted alternative: set SOPS_AGE_KEY and mount tenants.json.sops and rclone.json.sops at /encrypted (STORAGEFLOW_ENCRYPTED_DIR)."
fi
rm -f "$probe"

if [ ! -f "$TENANTS" ]; then
  python3 - "$EXAMPLE_TENANTS" "$TENANTS" << 'PY'
import json
import secrets
import sys
from pathlib import Path

example = Path(sys.argv[1])
target = Path(sys.argv[2])
try:
    data = json.loads(example.read_text())
except json.JSONDecodeError:
    raise SystemExit("storageflow: tenants example is not valid JSON")
for name in ("admin", "acme"):
    tenant = data.get(name)
    if not isinstance(tenant, dict) or "access_key" not in tenant or "secret_key" not in tenant:
        raise SystemExit(f"storageflow: tenants example is missing {name} access_key and secret_key")
    tenant["access_key"] = "sf" + secrets.token_hex(8)
    tenant["secret_key"] = secrets.token_hex(20)
text = json.dumps(data, indent=2) + "\n"
if "CHANGE_ME" in text:
    raise SystemExit("storageflow: refused to write placeholder keys")
tmp = target.with_name(target.name + ".tmp")
tmp.write_text(text)
tmp.chmod(0o600)
tmp.replace(target)
PY
  echo "storageflow: created tenants.json from the example template."
fi

if [ ! -f "$RCLONE" ]; then
  tmp="${RCLONE}.tmp"
  rm -f "$tmp"
  install -m 600 "$EXAMPLE_RCLONE" "$tmp"
  python3 - "$tmp" << 'PY' || { rm -f "$tmp"; exit 1; }
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except json.JSONDecodeError:
    raise SystemExit("storageflow: rclone example is not valid JSON")
conf = data.get("rclone_conf")
if not isinstance(conf, str) or not conf.strip():
    raise SystemExit("storageflow: rclone example is missing rclone_conf")
PY
  mv "$tmp" "$RCLONE"
  echo "storageflow: created rclone.json from the example template."
fi
