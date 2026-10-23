import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../../..");
const dokployFile = path.join(repo, "docker-compose.dokploy.yml");
const localFile = path.join(repo, "docker-compose.yml");

const requiredEnv = {
  POSTGRES_PASSWORD: "dokploy-config-check",
  APP_ENCRYPTION_KEY: "a".repeat(64),
  SFTPGO_ADMIN_PASSWORD: "dokploy-config-check",
  SEED_PASSWORD: "dokploy-config-check",
  PUBLIC_ORIGIN: "https://storageflow-dev.z.srl",
};

function serviceBlocks(text: string): Map<string, string> {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === "services:");
  assert.ok(start >= 0, "services");
  const blocks = new Map<string, string>();
  let name = "";
  let buf: string[] = [];
  const flush = () => {
    if (name) blocks.set(name, buf.join("\n"));
  };
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(line)) break;
    const heading = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (heading) {
      flush();
      name = heading[1] ?? "";
      buf = [];
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function dockerReady(): boolean {
  return spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
}

test("dokploy compose publishes no host ports and requires secrets", () => {
  const text = fs.readFileSync(dokployFile, "utf8");
  assert.doesNotMatch(text, /^\s*ports\s*:/m);
  assert.doesNotMatch(text, /published\s*:/);
  assert.doesNotMatch(text, /\.\/data\/backend/);
  assert.doesNotMatch(text, /\.\/data\/media/);
  assert.doesNotMatch(text, /\.\/secrets:/);
  assert.match(text, /backend-data:\/data/);
  assert.match(text, /media-data:\/mnt\/media/);
  assert.match(text, /pg-data:\/var\/lib\/postgresql\/data/);
  assert.match(text, /\$\{STORAGEFLOW_SECRETS_DIR:-secrets-data\}:\/config:ro/);
  assert.match(text, /\$\{POSTGRES_PASSWORD:\?required\}/);
  assert.match(text, /\$\{APP_ENCRYPTION_KEY:\?required\}/);
  assert.match(text, /\$\{SFTPGO_ADMIN_PASSWORD:\?required\}/);
  assert.match(text, /\$\{SEED_PASSWORD:\?/);
  assert.match(text, /\$\{PUBLIC_ORIGIN:\?/);
  assert.doesNotMatch(text, /POSTGRES_PASSWORD:-/);
  assert.doesNotMatch(text, /0\.0\.0\.0/);
  assert.doesNotMatch(text, /traefik\./i);

  const blocks = serviceBlocks(text);
  for (const name of ["s3-through", "s3-cache", "s3-acme", "sftpgo", "media-mount", "postgres", "api", "web"]) {
    assert.ok(blocks.has(name), name);
  }
  const web = blocks.get("web") ?? "";
  assert.match(web, /dokploy-network/);
  assert.match(web, /"80"/);
  assert.doesNotMatch(web, /^\s*ports\s*:/m);
  for (const name of ["postgres", "sftpgo"]) {
    const block = blocks.get(name) ?? "";
    assert.doesNotMatch(block, /^\s*ports\s*:/m, name);
    assert.doesNotMatch(block, /dokploy-network/, name);
  }
  assert.doesNotMatch(blocks.get("sftpgo") ?? "", /2022/);
  for (const name of ["api", "web", "s3-through", "s3-cache", "s3-acme"]) {
    const block = blocks.get(name) ?? "";
    assert.doesNotMatch(block, /^\s*ports\s*:/m, name);
    assert.doesNotMatch(block, /0\.0\.0\.0/, name);
  }
  for (const [name, block] of blocks) {
    if (name === "web") continue;
    assert.doesNotMatch(block, /dokploy-network/, name);
  }
  assert.match(text, /dokploy-network:\n\s+external:\s+true/);

  const nginx = fs.readFileSync(path.join(repo, "apps/web/nginx.conf"), "utf8");
  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /proxy_pass http:\/\/api:8787\//);
});

test("local compose still publishes workstation ports", () => {
  const text = fs.readFileSync(localFile, "utf8");
  for (const binding of ["5432:5432", "8787:8787", "5173:80", "5179:8080", "2022:2022", "8794:8080", "8795:8080"]) {
    assert.ok(text.includes(binding), binding);
  }
  assert.match(text, /POSTGRES_PASSWORD:-storageflow/);
  assert.match(text, /\.\/data\/backend:\/data/);
  assert.match(text, /\.\/secrets:\/config:ro/);
});

test("rendered dokploy config has no published ports", { skip: !dockerReady() }, () => {
  const emptyEnv = path.join(os.tmpdir(), "storageflow-dokploy-empty.env");
  fs.writeFileSync(emptyEnv, "");
  const base = ["compose", "--env-file", emptyEnv, "-f", dokployFile, "config"];
  const { POSTGRES_PASSWORD: _ignored, ...withoutPostgres } = requiredEnv;
  const missing = spawnSync("docker", base, {
    cwd: repo,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", ...withoutPostgres },
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}\n${missing.stdout}`, /POSTGRES_PASSWORD/);

  const rendered = spawnSync("docker", base, {
    cwd: repo,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", ...requiredEnv },
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.doesNotMatch(rendered.stdout, /^\s*ports\s*:/m);
  assert.doesNotMatch(rendered.stdout, /published\s*:/);
  assert.doesNotMatch(rendered.stdout, /0\.0\.0\.0/);
  assert.doesNotMatch(rendered.stdout, /traefik\./i);
  assert.doesNotMatch(rendered.stdout, /2022/);
  assert.match(rendered.stdout, /backend-data:/);
  assert.match(rendered.stdout, /secrets-data:/);
  assert.match(rendered.stdout, /dokploy-network:/);
  assert.doesNotMatch(rendered.stdout, /\.\/data\/backend/);
  assert.doesNotMatch(rendered.stdout, /\.\/secrets/);

  const bound = spawnSync("docker", base, {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      ...requiredEnv,
      STORAGEFLOW_SECRETS_DIR: "/var/lib/storageflow/secrets",
    },
  });
  assert.equal(bound.status, 0, bound.stderr);
  assert.match(bound.stdout, /source: \/var\/lib\/storageflow\/secrets/);
  assert.match(bound.stdout, /target: \/config/);
  assert.doesNotMatch(bound.stdout, /^\s*ports\s*:/m);
});
