#!/usr/bin/env bash
# Boot the Docker daemon and the Compose stack.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
export PATH="/usr/local/bin:$PATH"

# Drop injected commit attribution if the agent hooks directory is present.
strip_injected_attribution() {
  local hooks_root="/home/ubuntu/.cursor/agent-hooks"
  local src="$root/.cursor/hooks/commit-msg-strip-cursor-attribution"
  [ -d "$hooks_root" ] || return 0
  find "$hooks_root" \( -name 'commit-msg.cursor.co-author' -o -name '*co-author*' \) -type f -delete 2>/dev/null || true
  if [ -f "$src" ]; then
    local dir
    for dir in "$hooks_root"/*/; do
      [ -d "$dir" ] || continue
      if [ -e "${dir}.dispatcher" ] || [ -e "${dir}commit-msg" ]; then
        install -m 0755 "$src" "${dir}commit-msg.cursor.zz-strip-attribution" || true
      fi
    done
  fi
  if pgrep -f 'commit-msg.cursor.zz-strip-attribution' >/dev/null 2>&1; then
    return 0
  fi
  (
    # marker: commit-msg.cursor.zz-strip-attribution
    while true; do
      find "$hooks_root" \( -name 'commit-msg.cursor.co-author' -o -name '*co-author*' \) -type f -delete 2>/dev/null || true
      if [ -f "$src" ]; then
        local dir
        for dir in "$hooks_root"/*/; do
          [ -d "$dir" ] || continue
          if [ -e "${dir}.dispatcher" ] || [ -e "${dir}commit-msg" ]; then
            install -m 0755 "$src" "${dir}commit-msg.cursor.zz-strip-attribution" || true
          fi
        done
      fi
      sleep 2
    done
  ) >/dev/null 2>&1 &
}

strip_injected_attribution

# Compose bind-mounts ./data. A previous root-owned daemon can leave that
# directory unwritable, and init-secrets.sh then cannot create data/media.
ensure_workspace_dirs() {
  mkdir -p data/backend/acme/plain data/media secrets 2>/dev/null || true
  if [ ! -w data/media ] || [ ! -w data/backend ] || [ ! -w secrets ]; then
    sudo mkdir -p data/backend/acme/plain data/media secrets
    sudo chown -R "$(id -u):$(id -g)" data secrets
  fi
}

ensure_workspace_dirs

open_docker_socket() {
  if [ -S /var/run/docker.sock ]; then
    sudo chmod 666 /var/run/docker.sock || true
  fi
}

if ! docker info >/dev/null 2>&1; then
  open_docker_socket
  if command -v service >/dev/null 2>&1; then
    sudo service docker start || true
  fi
  open_docker_socket
  if ! docker info >/dev/null 2>&1; then
    sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  fi
  for _ in $(seq 1 60); do
    open_docker_socket
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi
docker info >/dev/null
ensure_workspace_dirs

bash "$root/scripts/init-secrets.sh"

if ! curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 || ! curl -fsS -o /dev/null http://127.0.0.1:5173/; then
  docker compose up -d --build
fi

# A snapshotted Postgres volume keeps the password it was initialized with.
# init-secrets.sh does not rotate an existing POSTGRES_PASSWORD. If those
# two still disagree, say so and leave the volume in place.
for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && curl -fsS -o /dev/null http://127.0.0.1:5173/; then
    exit 0
  fi
  if docker compose logs api --tail 80 2>/dev/null | grep -q 'password authentication failed'; then
    if [ "${STORAGEFLOW_RESET_VOLUMES:-}" = "1" ]; then
      docker compose down -v
      docker compose up -d --build
    else
      echo ".env and the Postgres volume disagree: password authentication failed." >&2
      echo "Set STORAGEFLOW_RESET_VOLUMES=1 to recreate volumes with docker compose down -v." >&2
      exit 1
    fi
  fi
  sleep 5
done

docker compose ps || true
exit 1
