#!/bin/sh
set -eu
MODE="${1:-cache}"
REMOTE="${2:-gateway}"
TENANT="${3:-admin}"
SEC=/run/secrets
mkdir -p "$SEC" "/cache/${TENANT}" /data/acme/plain
umask 077

if [ -n "${SOPS_AGE_KEY:-}" ] && [ -f /encrypted/tenants.json.sops ] && [ -f /encrypted/rclone.json.sops ]; then
  sops -d --output-type json /encrypted/tenants.json.sops > "$SEC/tenants.json"
  sops -d --output-type json /encrypted/rclone.json.sops | python3 -c "import json,sys; print(json.load(sys.stdin)['rclone_conf'], end='')" > "$SEC/rclone.conf"
elif [ -f /config/tenants.json ] && [ -f /config/rclone.json ]; then
  cp /config/tenants.json "$SEC/tenants.json"
  python3 -c "import json,sys; print(json.load(open('/config/rclone.json'))['rclone_conf'], end='')" > "$SEC/rclone.conf"
else
  echo "mount /config/tenants.json and /config/rclone.json, or set SOPS_AGE_KEY and mount /encrypted/*.sops" >&2
  exit 1
fi
chmod 600 "$SEC/rclone.conf" "$SEC/tenants.json"

export RCLONE_AUTH_KEY="$(python3 /auth-proxy/authkeys.py "$SEC/tenants.json" "$TENANT")"

ADDR="${S3_ADDR:-:8080}"

if [ "$MODE" = "mount" ]; then
  mkdir -p /mnt/media
  if awk '$2 == "/mnt/media" && $3 == "fuse.rclone" { found=1 } END { exit !found }' /proc/self/mounts; then
    fusermount -uz /mnt/media 2>/dev/null || umount -l /mnt/media 2>/dev/null || true
  fi
  exec rclone mount "${REMOTE}:" /mnt/media \
    --config "$SEC/rclone.conf" \
    --allow-non-empty \
    --allow-other \
    --vfs-cache-mode full \
    --vfs-write-back "${VFS_WRITE_BACK:-5s}" \
    --vfs-cache-max-size "${VFS_CACHE_MAX_SIZE:-20G}" \
    --cache-dir "/cache/${TENANT}" \
    --uid "${PUID:-1000}" \
    --gid "${PGID:-1000}"
fi

if [ "$MODE" = "through" ]; then
  exec rclone serve s3 "${REMOTE}:" \
    --config "$SEC/rclone.conf" \
    --addr "$ADDR" \
    --force-path-style \
    --etag-hash MD5 \
    --vfs-cache-mode off
fi

exec rclone serve s3 "${REMOTE}:" \
  --config "$SEC/rclone.conf" \
  --addr "$ADDR" \
  --force-path-style \
  --etag-hash MD5 \
  --cache-dir "/cache/${TENANT}" \
  --vfs-cache-mode full \
  --vfs-write-back "${VFS_WRITE_BACK:-5s}" \
  --vfs-cache-max-size "${VFS_CACHE_MAX_SIZE:-20G}"
