import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { baseName, isInsidePrefix, normalizePrefix } from "@storageflow/domain";
import type { ObjectBinding, RemoteEntry, StorageAdapter } from "./types.js";

function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// rclone serve s3 maps keys onto filesystem paths. A zero-byte object whose
// key is the folder itself ("Ordering" or "Ordering/") is a file, so every
// child write fails with "file already exists". A placeholder inside the
// folder is a real directory and still lists as a prefix.
const DIRECTORY_PLACEHOLDER = ".sf-directory";

export class S3Adapter implements StorageAdapter {
  readonly kind: "s3" | "hosted";
  readonly prefix: string;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(binding: ObjectBinding) {
    this.kind = binding.kind;
    this.prefix = normalizePrefix(binding.prefix);
    this.bucket = binding.bucket;
    const config: S3ClientConfig = {
      region: binding.region || "us-east-1",
      endpoint: binding.endpoint,
      forcePathStyle: binding.forcePathStyle,
      credentials: {
        accessKeyId: binding.accessKeyId,
        secretAccessKey: binding.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    };
    this.client = new S3Client(config);
  }

  private guard(key: string): void {
    if (!isInsidePrefix(this.prefix, key) && normalizePrefix(key) !== this.prefix) {
      throw new Error("Key is outside the drawer prefix");
    }
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, MaxKeys: 1 }));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unreachable" };
    }
  }

  async list(prefix: string): Promise<RemoteEntry[]> {
    const root = normalizePrefix(prefix || this.prefix);
    this.guard(root || this.prefix);
    const entries: RemoteEntry[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: root,
          Delimiter: "/",
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const folder of page.CommonPrefixes ?? []) {
        if (!folder.Prefix || folder.Prefix === root) continue;
        entries.push({ key: folder.Prefix, name: baseName(folder.Prefix), kind: "prefix" });
      }
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Key === root || object.Key.endsWith("/")) continue;
        if (baseName(object.Key) === DIRECTORY_PLACEHOLDER) continue;
        entries.push({
          key: object.Key,
          name: baseName(object.Key),
          kind: "file",
          size: object.Size,
          modifiedAt: object.LastModified?.toISOString(),
          etag: object.ETag?.replaceAll('"', ""),
        });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return entries;
  }

  async stat(key: string): Promise<RemoteEntry> {
    this.guard(key);
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      key,
      name: baseName(key),
      kind: key.endsWith("/") ? "prefix" : "file",
      size: head.ContentLength,
      modifiedAt: head.LastModified?.toISOString(),
      etag: head.ETag?.replaceAll('"', ""),
      contentType: head.ContentType,
    };
  }

  async mkdir(prefix: string): Promise<void> {
    const key = normalizePrefix(prefix);
    this.guard(key);
    await this.clearStaleDirectoryFiles(key);
    const marker = `${key}${DIRECTORY_PLACEHOLDER}`;
    this.guard(marker);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: marker,
        Body: new Uint8Array(),
        ContentLength: 0,
        ContentType: "application/x-directory",
      }),
    );
  }

  async write(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    this.guard(key);
    await this.clearStaleDirectoryFiles(key);
    const nodeStream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: nodeStream,
        ContentLength: size,
      }),
    );
  }

  async read(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    this.guard(key);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    if (!result.Body) throw new Error("Empty object");
    const web = result.Body.transformToWebStream?.();
    if (!web) throw new Error("Object body is not readable");
    return web as ReadableStream<Uint8Array>;
  }

  private async listAll(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async move(from: string, to: string): Promise<void> {
    this.guard(from);
    this.guard(to);
    await this.clearStaleDirectoryFiles(to);
    if (from.endsWith("/")) {
      const dest = normalizePrefix(to);
      const keys = await this.listAll(from);
      for (const key of keys) {
        const next = dest + key.slice(from.length);
        await this.copyKey(key, next);
      }
      await this.remove(from, true);
      return;
    }
    await this.copyKey(from, to);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: from }));
  }

  private async copyKey(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        CopySource: encodeCopySource(this.bucket, from),
      }),
    );
  }

  async remove(key: string, recursive: boolean): Promise<void> {
    this.guard(key);
    if (!recursive && !key.endsWith("/")) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return;
    }
    const prefix = key.endsWith("/") ? key : `${key}/`;
    const bare = prefix.slice(0, -1);
    if (bare) await this.deleteStaleDirectoryFile(bare);
    const keys = await this.listAll(prefix);
    if (!keys.includes(key) && (await this.exists(key))) keys.push(key);
    for (let index = 0; index < keys.length; index += 1000) {
      const chunk = keys.slice(index, index + 1000);
      if (chunk.length === 0) continue;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((item) => ({ Key: item })) },
        }),
      );
    }
  }

  private async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  private covers(key: string): boolean {
    return isInsidePrefix(this.prefix, key) || normalizePrefix(key) === this.prefix;
  }

  private async deleteStaleDirectoryFile(key: string): Promise<void> {
    if (!this.covers(key) || baseName(key) === DIRECTORY_PLACEHOLDER) return;
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const type = head.ContentType ?? "";
      if ((head.ContentLength ?? 0) === 0 && type.startsWith("application/x-directory")) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      }
    } catch {
      // A missing key is a directory rclone already created, not a stale file.
    }
  }

  private async clearStaleDirectoryFiles(key: string): Promise<void> {
    const directory = key.endsWith("/") ? key.slice(0, -1) : key.slice(0, Math.max(0, key.lastIndexOf("/")));
    if (!directory) return;
    let acc = "";
    for (const part of directory.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      await this.deleteStaleDirectoryFile(acc);
    }
  }

  async presignPut(key: string, options: { contentType?: string; expiresIn: number }): Promise<{ url: string; headers: Record<string, string> }> {
    this.guard(key);
    await this.clearStaleDirectoryFiles(key);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: options.expiresIn });
    return { url, headers: options.contentType ? { "content-type": options.contentType } : {} };
  }

  async presignGet(key: string, options: { expiresIn: number; filename?: string }): Promise<string> {
    this.guard(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: options.filename ? `attachment; filename="${options.filename.replaceAll('"', "")}"` : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresIn });
  }

  async createMultipart(key: string, contentType: string | undefined, partSize: number, size: number, expiresIn: number) {
    this.guard(key);
    await this.clearStaleDirectoryFiles(key);
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!created.UploadId) throw new Error("Multipart upload did not start");
    const partCount = Math.max(1, Math.ceil(size / partSize));
    const parts: { partNumber: number; url: string }[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const url = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: created.UploadId,
          PartNumber: partNumber,
        }),
        { expiresIn },
      );
      parts.push({ partNumber, url });
    }
    return { uploadId: created.UploadId, parts };
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    this.guard(key);
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }
}
