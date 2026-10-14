#!/usr/bin/env bash
# Boot hook hygiene, the Docker daemon, and the Compose stack.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
export PATH="/usr/local/bin:$PATH"

bash "$root/scripts/strip-cursor-attribution.sh"

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

# A snapshotted Postgres volume keeps its old password. A fresh checkout
# generates a new POSTGRES_PASSWORD, and the API then cannot sign in.
recovered=0
for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && curl -fsS -o /dev/null http://127.0.0.1:5173/; then
    exit 0
  fi
  if [ "$recovered" -eq 0 ] && docker compose logs api --tail 80 2>/dev/null | grep -q 'password authentication failed'; then
    recovered=1
    docker compose down -v
    docker compose up -d --build
  fi
  sleep 5
done

docker compose ps || true
exit 1
