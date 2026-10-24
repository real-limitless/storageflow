import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../../..");

test("dependabot checks npm, docker, compose, and actions every week", () => {
  const text = fs.readFileSync(path.join(repo, ".github/dependabot.yml"), "utf8");
  for (const ecosystem of ["npm", "docker", "docker-compose", "github-actions"]) {
    assert.match(text, new RegExp(`package-ecosystem:\\s*${ecosystem}\\b`));
  }
  assert.match(text, /directory:\s*"\/apps\/api"/);
  assert.match(text, /directory:\s*"\/apps\/web"/);
  assert.equal(text.match(/interval:\s*weekly/g)?.length, 6);
});

test("ci keeps read-only contents and a non-blocking high audit", () => {
  const text = fs.readFileSync(path.join(repo, ".github/workflows/ci.yml"), "utf8");
  assert.match(text, /contents:\s*read/);
  assert.doesNotMatch(text, /contents:\s*write/);
  assert.match(text, /continue-on-error:\s*true/);
  assert.match(text, /npm audit --audit-level=high/);
});
