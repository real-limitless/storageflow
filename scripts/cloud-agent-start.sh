#!/usr/bin/env bash
# Boot hook hygiene, the Docker daemon, and the Compose stack.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
export PATH="/usr/local/bin:$PATH"

bash "$root/scripts/strip-cursor-attribution.sh"

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

bash "$root/scripts/init-secrets.sh"

if ! curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 || ! curl -fsS -o /dev/null http://127.0.0.1:5173/; then
  docker compose up -d --build
fi

for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && curl -fsS -o /dev/null http://127.0.0.1:5173/; then
    exit 0
  fi
  sleep 5
done

docker compose ps || true
exit 1
