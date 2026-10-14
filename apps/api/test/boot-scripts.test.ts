import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../../..");

function stage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-boot-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "secrets"), { recursive: true });
  for (const name of ["init-secrets.sh", "cloud-agent-start.sh"]) {
    fs.copyFileSync(path.join(repo, "scripts", name), path.join(dir, "scripts", name));
    fs.chmodSync(path.join(dir, "scripts", name), 0o755);
  }
  for (const name of ["tenants.json.example", "rclone.json.example"]) {
    fs.copyFileSync(path.join(repo, "secrets", name), path.join(dir, "secrets", name));
  }
  return dir;
}

function envValue(text: string, key: string): string {
  const line = text.split("\n").find((item) => item.startsWith(`${key}=`));
  assert.ok(line, key);
  return line.slice(key.length + 1);
}

test("a second init-secrets.sh run keeps generated secrets", () => {
  const dir = stage();
  const script = path.join(dir, "scripts", "init-secrets.sh");
  const first = spawnSync("sh", [script], { cwd: dir, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const before = fs.readFileSync(path.join(dir, ".env"), "utf8");
  const second = spawnSync("sh", [script], { cwd: dir, encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  const after = fs.readFileSync(path.join(dir, ".env"), "utf8");
  for (const key of ["POSTGRES_PASSWORD", "SEED_PASSWORD", "APP_ENCRYPTION_KEY"]) {
    assert.equal(envValue(after, key), envValue(before, key));
    assert.ok(envValue(before, key).length > 8);
  }
});

test("start script does not call docker compose down -v unless STORAGEFLOW_RESET_VOLUMES=1", () => {
  const source = fs.readFileSync(path.join(repo, "scripts", "cloud-agent-start.sh"), "utf8");
  const commands = source.split("\n").filter((line) => line.trim() === "docker compose down -v");
  assert.equal(commands.length, 1);
  const resetAt = source.indexOf('STORAGEFLOW_RESET_VOLUMES:-}" = "1"');
  const commandAt = source.indexOf("docker compose down -v");
  assert.ok(resetAt > 0 && commandAt > resetAt);

  function run(reset: boolean) {
    const dir = stage();
    const stub = path.join(dir, "stub-bin");
    const log = path.join(dir, "commands.log");
    fs.mkdirSync(stub);
    fs.writeFileSync(
      path.join(stub, "docker"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
if [ "$1" = "info" ]; then
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "logs" ]; then
  if [ -f "$STUB_DIR/reset" ]; then
    exit 0
  fi
  echo "password authentication failed"
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "down" ] && [ "$3" = "-v" ]; then
  touch "$STUB_DIR/reset"
  exit 0
fi
exit 0
`,
    );
    fs.writeFileSync(
      path.join(stub, "curl"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
if [ -f "$STUB_DIR/reset" ]; then
  exit 0
fi
exit 1
`,
    );
    fs.chmodSync(path.join(stub, "docker"), 0o755);
    fs.chmodSync(path.join(stub, "curl"), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${stub}:/usr/bin:/bin`, STUB_LOG: log, STUB_DIR: dir, HOME: dir };
    delete env.GIT_DIR;
    if (reset) env.STORAGEFLOW_RESET_VOLUMES = "1";
    else delete env.STORAGEFLOW_RESET_VOLUMES;
    const result = spawnSync("bash", [path.join(dir, "scripts", "cloud-agent-start.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    const called = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
    return { result, called };
  }

  const refused = run(false);
  assert.notEqual(refused.result.status, 0, refused.result.stderr);
  assert.match(refused.result.stderr ?? "", /\.env and the Postgres volume disagree/);
  assert.doesNotMatch(refused.called, /compose down -v/);

  const allowed = run(true);
  assert.equal(allowed.result.status, 0, `${allowed.result.stderr}\n${allowed.called}`);
  assert.match(allowed.called, /compose down -v/);
});
