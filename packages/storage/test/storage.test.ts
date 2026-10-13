import assert from "node:assert/strict";
import test from "node:test";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MemoryAdapter } from "../src/memory.js";

async function bytes(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

test("memory adapter is the tree: list, move, and delete stay inside the prefix", async () => {
  const adapter = new MemoryAdapter("hosted", "drawers/1/");
  const hello = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello"));
      controller.close();
    },
  });
  await adapter.write("drawers/1/notes.txt", hello, 5);
  await adapter.mkdir("drawers/1/biology/");
  await adapter.write(
    "drawers/1/biology/lab.txt",
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("lab"));
        controller.close();
      },
    }),
    3,
  );
  const root = await adapter.list("drawers/1/");
  assert.deepEqual(
    root.map((entry) => entry.name).sort(),
    ["biology", "notes.txt"],
  );
  const nested = await adapter.list("drawers/1/biology/");
  assert.deepEqual(nested.map((entry) => entry.name), ["lab.txt"]);
  await adapter.move("drawers/1/biology/", "drawers/1/science/");
  assert.equal((await adapter.list("drawers/1/science/")).length, 1);
  await assert.rejects(() => adapter.write("other/secret.txt", hello, 5));
  await adapter.remove("drawers/1/science/", true);
  assert.equal(await bytes(await adapter.read("drawers/1/notes.txt")), "hello");
  const left = await adapter.list("drawers/1/");
  assert.deepEqual(left.map((entry) => entry.name), ["notes.txt"]);
});

test("presigned put is scoped to one key and expires within minutes", async () => {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:8795",
    forcePathStyle: true,
    credentials: { accessKeyId: "example-access", secretAccessKey: "example-secret" },
  });
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: "acme-plain", Key: "drawers/1/notes.txt", ContentType: "text/plain" }),
    { expiresIn: 600 },
  );
  const parsed = new URL(url);
  assert.match(parsed.pathname, /\/acme-plain\/drawers\/1\/notes\.txt$/);
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "600");
  assert.ok(parsed.searchParams.get("X-Amz-Signature"));
  const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: "acme-plain", Key: "drawers/1/notes.txt" }), { expiresIn: 60 });
  assert.match(getUrl, /notes\.txt/);
  assert.match(getUrl, /X-Amz-Expires=60/);
});
