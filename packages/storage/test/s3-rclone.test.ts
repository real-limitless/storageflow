import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { S3Adapter } from "../src/s3.js";

const ACCESS_KEY = "testaccess";
const SECRET_KEY = "testsecret";
const BUCKET = "acme-plain";

function textStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function rcloneBin(): string | null {
  const candidate = process.env.RCLONE_BIN || "rclone";
  const found = spawnSync(candidate, ["version"], { encoding: "utf8" });
  return found.status === 0 ? candidate : null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startRclone(): Promise<{ endpoint: string; logs: () => string; stop: () => Promise<void> }> {
  const bin = rcloneBin();
  if (!bin) {
    if (process.env.REQUIRE_S3_RCLONE === "1") {
      throw new Error("REQUIRE_S3_RCLONE=1 but rclone is not on PATH");
    }
    throw new SkipRclone();
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "sf-rclone-"));
  const data = path.join(root, "data");
  const cache = path.join(root, "cache");
  await mkdir(path.join(data, BUCKET), { recursive: true });
  await mkdir(cache, { recursive: true });
  const port = await freePort();
  const child: ChildProcess = spawn(
    bin,
    [
      "serve",
      "s3",
      data,
      "--addr",
      `127.0.0.1:${port}`,
      "--force-path-style",
      "--auth-key",
      `${ACCESS_KEY},${SECRET_KEY}`,
      "--etag-hash",
      "MD5",
      "--vfs-cache-mode",
      "full",
      "--vfs-write-back",
      "0s",
      "--cache-dir",
      cache,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const adapter = hosted(endpoint, "drawers/ready/");
  const started = Date.now();
  let ready = false;
  let last = "";
  while (Date.now() - started < 15000) {
    if (child.exitCode != null) break;
    const health = await adapter.health();
    if (health.ok) {
      ready = true;
      break;
    }
    last = health.message ?? "";
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) {
    child.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
    throw new Error(`rclone serve s3 did not start: ${last}\n${output}`);
  }
  return {
    endpoint,
    logs: () => output,
    stop: async () => {
      if (child.exitCode == null) child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        if (child.exitCode != null) resolve();
        else child.once("exit", () => resolve());
      });
      await rm(root, { recursive: true, force: true });
    },
  };
}

class SkipRclone extends Error {
  constructor() {
    super("rclone is not installed");
  }
}

function hosted(endpoint: string, prefix: string): S3Adapter {
  return new S3Adapter({
    kind: "hosted",
    endpoint,
    region: "us-east-1",
    bucket: BUCKET,
    prefix,
    forcePathStyle: true,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  });
}

test("hosted folder and file writes succeed on rclone serve s3", async (t) => {
  let server: Awaited<ReturnType<typeof startRclone>>;
  try {
    server = await startRclone();
  } catch (error) {
    if (error instanceof SkipRclone) {
      t.skip(error.message);
      return;
    }
    throw error;
  }
  t.after(() => server.stop());

  const drawer = hosted(server.endpoint, "drawers/1/");
  await drawer.mkdir("drawers/1/");
  await drawer.mkdir("drawers/1/Ordering/");
  await drawer.mkdir("drawers/1/Ordering/");
  assert.deepEqual(
    (await drawer.list("drawers/1/")).map((entry) => entry.name).sort(),
    ["Ordering"],
  );
  assert.deepEqual(await drawer.list("drawers/1/Ordering/"), []);

  await drawer.write("drawers/1/Ordering/notes.txt", textStream("notes"), 5);
  await drawer.write("drawers/1/brief.txt", textStream("\n"), 1);
  assert.deepEqual(
    (await drawer.list("drawers/1/")).map((entry) => entry.name).sort(),
    ["Ordering", "brief.txt"],
  );
  assert.deepEqual(
    (await drawer.list("drawers/1/Ordering/")).map((entry) => entry.name),
    ["notes.txt"],
  );
  assert.equal(await readText(drawer, "drawers/1/Ordering/notes.txt"), "notes");

  await drawer.remove("drawers/1/Ordering/", true);
  assert.deepEqual(
    (await drawer.list("drawers/1/")).map((entry) => entry.name),
    ["brief.txt"],
  );

  const legacy = new S3Client({
    region: "us-east-1",
    endpoint: server.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  await legacy.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: "drawers/legacy/",
      Body: new Uint8Array(),
      ContentLength: 0,
      ContentType: "application/x-directory",
    }),
  );
  const healed = hosted(server.endpoint, "drawers/legacy/");
  await healed.mkdir("drawers/legacy/Ordering/");
  await healed.write("drawers/legacy/brief.txt", textStream("ok"), 2);
  assert.deepEqual(
    (await healed.list("drawers/legacy/")).map((entry) => entry.name).sort(),
    ["Ordering", "brief.txt"],
  );
  assert.equal(server.logs().includes("file already exists"), false, server.logs());
});

async function readText(adapter: S3Adapter, key: string): Promise<string> {
  const reader = (await adapter.read(key)).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
