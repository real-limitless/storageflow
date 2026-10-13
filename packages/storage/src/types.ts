export interface RemoteEntry {
  key: string;
  name: string;
  kind: "file" | "prefix";
  size?: number;
  modifiedAt?: string;
  etag?: string;
  contentType?: string;
}

export interface StorageAdapter {
  kind: "s3" | "sftp" | "hosted" | "connector";
  health(): Promise<{ ok: boolean; message?: string }>;
  list(prefix: string): Promise<RemoteEntry[]>;
  stat(key: string): Promise<RemoteEntry>;
  mkdir(prefix: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(key: string, recursive: boolean): Promise<void>;
  read(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>>;
  write(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>;
  presignPut?(
    key: string,
    options: { contentType?: string; expiresIn: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet?(key: string, options: { expiresIn: number; filename?: string }): Promise<string>;
}

export interface ObjectBinding {
  kind: "s3" | "hosted";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}
