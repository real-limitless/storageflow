#!/usr/bin/env bash
# Idempotent Cloud Agent install: Docker (nested-VM settings) and npm dependencies.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

export DEBIAN_FRONTEND=noninteractive

ensure_node() {
  if [ -x /usr/local/bin/node ] && /usr/local/bin/node -v | grep -q '^v22\.'; then
    return
  fi
  local nvm_node=""
  nvm_node=$(ls -d "$HOME"/.nvm/versions/node/v22*/bin/node 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$nvm_node" ]; then
    local bin
    bin=$(dirname "$nvm_node")
    sudo ln -sfn "$bin/node" /usr/local/bin/node
    sudo ln -sfn "$bin/npm" /usr/local/bin/npm
    sudo ln -sfn "$bin/npx" /usr/local/bin/npx
    return
  fi
  local version=22.23.3
  curl -fsSL "https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz" \
    | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
}

apt_install() {
  sudo apt-get install -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    "$@"
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! command -v fuse-overlayfs >/dev/null 2>&1 || [ ! -x /usr/sbin/iptables-legacy ]; then
    sudo apt-get update
    apt_install ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    local codename
    codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update
    local docker_ce="docker-ce=5:28.5.2-1~ubuntu.24.04~noble"
    local docker_cli="docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble"
    if apt-cache madison docker-ce | grep -q '5:28.5.2-1~ubuntu.24.04~noble'; then
      apt_install --allow-downgrades \
        "$docker_ce" \
        "$docker_cli" \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
        fuse-overlayfs \
        iptables
    else
      apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin fuse-overlayfs iptables
    fi
  fi
  sudo mkdir -p /etc/docker
  printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' | sudo tee /etc/docker/daemon.json >/dev/null
  if [ -x /usr/sbin/iptables-legacy ]; then
    sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
  fi
  if [ -x /usr/sbin/ip6tables-legacy ]; then
    sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
  fi
  sudo groupadd -f docker
  sudo usermod -aG docker "${USER:-ubuntu}"
}

ensure_node
ensure_docker
export PATH="/usr/local/bin:$PATH"
hash -r || true
npm ci
