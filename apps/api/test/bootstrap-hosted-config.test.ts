import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repo, "scripts", "bootstrap-hosted-config.sh");
const examples = path.join(repo, "secrets");

function run(configDir: string, extra: NodeJS.ProcessEnv = {}, encryptedDir?: string) {
  const encrypted = encryptedDir ?? path.join(configDir, ".no-encrypted");
  return spawnSync("sh", [script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      STORAGEFLOW_CONFIG_DIR: configDir,
      STORAGEFLOW_EXAMPLES_DIR: examples,
      STORAGEFLOW_ENCRYPTED_MOUNT: encrypted,
      ...extra,
    },
  });
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

test("empty writable config is created from examples and a second run keeps it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const first = run(dir);
  assert.equal(first.status, 0, `${first.stderr}\n${first.stdout}`);
  assert.match(first.stdout, /created tenants\.json/);
  assert.match(first.stdout, /created rclone\.json/);
  assert.equal(fs.existsSync(path.join(dir, ".env")), false);

  const tenantsPath = path.join(dir, "tenants.json");
  const rclonePath = path.join(dir, "rclone.json");
  const tenants = readJson(tenantsPath) as {
    admin: { access_key: string; secret_key: string; buckets: string[] };
    acme: { access_key: string; secret_key: string; buckets: string[] };
  };
  assert.match(tenants.admin.access_key, /^sf[0-9a-f]{16}$/);
  assert.match(tenants.acme.access_key, /^sf[0-9a-f]{16}$/);
  assert.match(tenants.admin.secret_key, /^[0-9a-f]{40}$/);
  assert.match(tenants.acme.secret_key, /^[0-9a-f]{40}$/);
  assert.notEqual(tenants.admin.access_key, tenants.acme.access_key);
  assert.deepEqual(tenants.admin.buckets, ["*"]);
  assert.deepEqual(tenants.acme.buckets, ["acme-plain"]);
  assert.doesNotMatch(fs.readFileSync(tenantsPath, "utf8"), /CHANGE_ME/);
  const rclone = readJson(rclonePath) as { rclone_conf?: string };
  assert.match(rclone.rclone_conf ?? "", /\[gateway-acme\]/);
  assert.equal(fs.statSync(tenantsPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(rclonePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["rclone.json", "tenants.json"]);

  const tenantsBytes = fs.readFileSync(tenantsPath);
  const rcloneBytes = fs.readFileSync(rclonePath);
  const tenantsMtime = fs.statSync(tenantsPath).mtimeMs;
  const rcloneMtime = fs.statSync(rclonePath).mtimeMs;
  const second = run(dir);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already present/);
  assert.ok(tenantsBytes.equals(fs.readFileSync(tenantsPath)));
  assert.ok(rcloneBytes.equals(fs.readFileSync(rclonePath)));
  assert.equal(fs.statSync(tenantsPath).mtimeMs, tenantsMtime);
  assert.equal(fs.statSync(rclonePath).mtimeMs, rcloneMtime);
});

test("placed config files stay byte for byte, including placeholder keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const tenantsPath = path.join(dir, "tenants.json");
  const rclonePath = path.join(dir, "rclone.json");
  fs.writeFileSync(tenantsPath, "{\"admin\":{\"access_key\":\"CHANGE_ME_KEEP\"}}\n");
  fs.writeFileSync(rclonePath, "{\"rclone_conf\":\"kept\"}\n");
  const tenantsBefore = fs.readFileSync(tenantsPath);
  const rcloneBefore = fs.readFileSync(rclonePath);
  fs.chmodSync(dir, 0o555);
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already present/);
    assert.ok(tenantsBefore.equals(fs.readFileSync(tenantsPath)));
    assert.ok(rcloneBefore.equals(fs.readFileSync(rclonePath)));
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test("a missing file is created and the file already present is not rewritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const tenantsPath = path.join(dir, "tenants.json");
  const placed = "{\"admin\":{\"access_key\":\"placed\"},\"acme\":{\"access_key\":\"placed-acme\"}}\n";
  fs.writeFileSync(tenantsPath, placed);
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(tenantsPath, "utf8"), placed);
  assert.match(fs.readFileSync(path.join(dir, "rclone.json"), "utf8"), /gateway-acme/);
  assert.equal(fs.existsSync(path.join(dir, ".env")), false);
});

test("an empty unwritable directory fails closed without creating files", { skip: process.getuid?.() === 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  fs.chmodSync(dir, 0o555);
  try {
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not writable/);
    assert.match(result.stderr, /tenants\.json/);
    assert.match(result.stderr, /rclone\.json/);
    assert.match(result.stderr, /SOPS_AGE_KEY/);
    assert.match(result.stderr, /refusing to start/);
    assert.equal(fs.readdirSync(dir).length, 0);
    assert.equal(fs.existsSync(path.join(dir, ".env")), false);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test("a missing config directory fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const missing = path.join(dir, "absent");
  const result = run(missing);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
  assert.match(result.stderr, /STORAGEFLOW_SECRETS_DIR/);
  assert.equal(fs.existsSync(missing), false);
});

test("complete encrypted config leaves an empty directory untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const encrypted = path.join(dir, "encrypted");
  fs.mkdirSync(encrypted);
  fs.writeFileSync(path.join(encrypted, "tenants.json.sops"), "{}\n");
  fs.writeFileSync(path.join(encrypted, "rclone.json.sops"), "{}\n");
  const config = path.join(dir, "config");
  fs.mkdirSync(config);
  const result = run(config, { SOPS_AGE_KEY: "present" }, encrypted);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /encrypted config is present/);
  assert.equal(fs.readdirSync(config).length, 0);
});

test("encrypted files without a key do not produce plaintext config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const encrypted = path.join(dir, "encrypted");
  fs.mkdirSync(encrypted);
  fs.writeFileSync(path.join(encrypted, "tenants.json.sops"), "{}\n");
  const config = path.join(dir, "config");
  fs.mkdirSync(config);
  const result = run(config, {}, encrypted);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /encrypted config is incomplete/);
  assert.match(result.stderr, /SOPS_AGE_KEY/);
  assert.equal(fs.readdirSync(config).length, 0);
});

test("a key without encrypted files still creates plaintext config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bootstrap-"));
  const result = run(dir, { SOPS_AGE_KEY: "present" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, "tenants.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "rclone.json")), true);
});
